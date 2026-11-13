import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Ajv from "ajv/dist/2020";
import { resolveSource, writeReviews, type AuditResult, type ReviewRecord, type Source } from "@lore/parser";
import { parseCommand } from "../src/args";
import { renderAudit } from "../src/audit";
import { run } from "../src/main";

const TODAY = "2026-11-12";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-audit-")));
  made.push(dir);
  return dir;
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "ignore" });
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function commit(root: string, files: Record<string, string>, message = "change"): void {
  write(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

function repoWith(files: Record<string, string>): string {
  const root = tempDir();
  git(root, "init", "-q", "-b", "main");
  commit(root, files, "first");
  return root;
}

interface Ran { code: number; out: string; err: string }

async function lore(argv: string[]): Promise<Ran> {
  let out = "";
  let err = "";
  const code = await run(argv, {
    stdin: async () => "",
    stdout: (text) => { out += text; },
    stderr: (text) => { err += text; },
    isTTY: false,
    today: () => TODAY,
  });
  return { code, out, err };
}

const DOC = "# Checkout review\n\n## Money is integer minor units\n\nAmounts are integers in minor units (cents).\n\n## Dates\n\nUse ISO dates.\n";
const HEADING = "Money is integer minor units";
const SOURCE: Source = { file: "docs/checkout-review.md", heading: HEADING, phrase: null };

const ruleCiting = (id: string, file: string, heading: string | null = HEADING) =>
  `<rule id="${id}" category="functional_correctness" severity="blocking">\n<source>\nfile: ${file}\n${heading === null ? "" : `heading: ${heading}\n`}</source>\nAmounts are integers in minor units (cents).\n</rule>\n`;
const RULE = ruleCiting("money-in-minor-units", SOURCE.file);
const PLAIN = '<rule id="price-from-quote" category="functional_correctness">\nTake the price from the quote.\n</rule>\n';
const BROKEN = '<rule id="broken" src="README.md">\nProse.\n</rule>\n';

function lockFor(rule: string, source: Source, text: string, reviewed = "2026-11-01"): string {
  const resolved = resolveSource(source, text);
  if (!resolved.ok) throw new Error("the source does not resolve");
  const record: ReviewRecord = { rule, ...source, reviewed, hash: resolved.hash };
  return writeReviews([record]);
}

const LOCK = lockFor("money-in-minor-units", SOURCE, DOC);
const notChecked = (lock: string, reason: string): string =>
  `lore: orphan-review not checked in ${lock}: it may cover a rule this run did not collect (${reason})\n`;

function shop(extra: Record<string, string> = {}): string {
  return repoWith({ ".lore/a.lore": `${RULE}\n${PLAIN}`, "docs/checkout-review.md": DOC, "lore-reviews.lock": LOCK, ...extra });
}

describe("parsing lore audit", () => {
  test("reads --max-age and repeated --level", () => {
    expect(parseCommand(["audit", "--max-age", "90", "--level", "source-changed=error", "--level", "never-reviewed=off"])).toEqual({
      name: "audit", repo: null, noRepo: false, rulesRef: null, given: [], remotes: [], format: null, strict: false,
      maxAge: 90, levels: { "source-changed": "error", "never-reviewed": "off" },
    });
  });

  test("takes the rules options, --format and --strict", () => {
    expect(parseCommand(["audit", "--repo", "x", "--rules-ref", "main", "--given", "g", "--remote", "r", "--format=json", "--strict"])).toEqual({
      name: "audit", repo: "x", noRepo: false, rulesRef: "main", given: ["g"], remotes: ["r"], format: "json", strict: true,
      maxAge: null, levels: {},
    });
  });
});

describe("lore audit", () => {
  test("a clean repo prints only the summary and exits 0", async () => {
    const root = shop();
    expect(await lore(["audit", "--repo", root])).toEqual({ code: 0, out: "rules with a source: 1, without: 1\n", err: "" });
  });

  test("a renamed heading is source-missing and exits 1", async () => {
    const root = shop();
    commit(root, { "docs/checkout-review.md": DOC.replace(HEADING, "Money is stored in cents") });
    const { code, out, err } = await lore(["audit", "--repo", root]);
    expect(err).toBe("");
    expect(code).toBe(1);
    expect(out).toBe(
      ".lore/a.lore\n" +
      `  error  source-missing  money-in-minor-units  docs/checkout-review.md#${HEADING}  heading not found: "${HEADING}"\n` +
      "\n" +
      "source-missing: 1\n" +
      "rules with a source: 1, without: 1\n",
    );
  });

  test("a changed section is source-changed: a warning, or an error with --level", async () => {
    const root = shop();
    commit(root, { "docs/checkout-review.md": DOC.replace("(cents).", "(cents), never floats.") });
    const warned = await lore(["audit", "--repo", root]);
    expect(warned.code).toBe(0);
    expect(warned.out).toContain(`  warn  source-changed  money-in-minor-units  docs/checkout-review.md#${HEADING}\n`);
    expect(warned.out).toContain("\nsource-changed: 1\n");
    const failed = await lore(["audit", "--repo", root, "--level", "source-changed=error"]);
    expect(failed.code).toBe(1);
    expect(failed.out).toContain(`  error  source-changed  money-in-minor-units  docs/checkout-review.md#${HEADING}\n`);
  });

  test("a cited file that git does not track is source-missing", async () => {
    const root = shop({ ".lore/b.lore": ruleCiting("notes-rule", "docs/notes.md", null) });
    write(root, { "docs/notes.md": "Notes.\n" });
    const { code, out } = await lore(["audit", "--repo", root]);
    expect(code).toBe(1);
    expect(out).toContain(".lore/b.lore\n  error  source-missing  notes-rule  docs/notes.md  file not found: docs/notes.md\n");
  });

  test("a cited file that starts with a byte order mark keeps the fingerprint it has without one", async () => {
    const whole: Source = { ...SOURCE, heading: null };
    const root = shop({
      ".lore/a.lore": `${ruleCiting("money-in-minor-units", SOURCE.file, null)}\n${PLAIN}`,
      "docs/checkout-review.md": `\uFEFF${DOC}`,
      "lore-reviews.lock": lockFor("money-in-minor-units", whole, DOC),
    });
    expect(await lore(["audit", "--repo", root])).toEqual({ code: 0, out: "rules with a source: 1, without: 1\n", err: "" });
  });

  test("a phrase is printed in quotes after the file", async () => {
    const rule = '<rule id="cents" category="functional_correctness">\n<source>\nfile: docs/checkout-review.md\nphrase: "minor units (cents)"\n</source>\nCents.\n</rule>\n';
    const root = shop({ ".lore/b.lore": rule });
    const { out } = await lore(["audit", "--repo", root]);
    expect(out).toContain('.lore/b.lore\n  warn  never-reviewed  cents  docs/checkout-review.md "minor units (cents)"\n');
  });

  test("--max-age reports a record older than the limit", async () => {
    const root = shop({ "lore-reviews.lock": lockFor("money-in-minor-units", SOURCE, DOC, "2026-01-01") });
    const { code, out } = await lore(["audit", "--repo", root, "--max-age", "90"]);
    expect(code).toBe(0);
    expect(out).toContain(`  warn  review-overdue  money-in-minor-units  docs/checkout-review.md#${HEADING}\n`);
    expect((await lore(["audit", "--repo", root])).out).not.toContain("review-overdue");
  });

  describe("with --no-repo and a given folder", () => {
    const guided = '<rule id="guide-rule" category="functional_correctness">\n<source>\n- file: docs/checkout-review.md\n  heading: Money is integer minor units\n- file: ./guide.md\n</source>\nFollow the guide.\n</rule>\n';
    const rules = () =>
      repoWith({ "rules/.loreconfig": "lore: 1\nrepo: github.com/acme/shop\n", "rules/.lore/a.lore": guided, "rules/.lore/guide.md": "# Guide\n" });
    const args = (folder: string) => ["audit", "--no-repo", "--remote", "github.com/acme/shop", "--given", join(folder, "rules")];

    test("a governed-repo source is source-unchecked and exits 1, while a ./ source in the folder is checked", async () => {
      const { code, out, err } = await lore(args(rules()));
      expect(err).toBe("");
      expect(code).toBe(1);
      expect(out).toBe(
        "external:rules/.lore/a.lore\n" +
        `  error  source-unchecked  guide-rule  docs/checkout-review.md#${HEADING}\n` +
        "  warn  never-reviewed  guide-rule  external:rules/.lore/guide.md\n" +
        "\n" +
        "source-unchecked: 1\n" +
        "never-reviewed: 1\n" +
        "rules with a source: 1, without: 0\n",
      );
    });

    test("--level source-unchecked=off exits 0", async () => {
      const { code, out } = await lore([...args(rules()), "--level", "source-unchecked=off"]);
      expect(code).toBe(0);
      expect(out).not.toContain("source-unchecked");
      expect(out).toContain("never-reviewed  guide-rule  external:rules/.lore/guide.md");
    });
  });

  test("a malformed lock file exits 2 naming the file and line", async () => {
    const root = shop({ "lore-reviews.lock": '{"lore-reviews":1}\nnot json\n' });
    const { code, out, err } = await lore(["audit", "--repo", root]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toBe("lore: malformed lock file lore-reviews.lock line 2: the line is not valid JSON\n");
  });

  test("an excluded entry is listed on stderr, and --strict makes it exit 1", async () => {
    const root = shop({ ".lore/bad.lore": BROKEN });
    const plain = await lore(["audit", "--repo", root]);
    expect(plain.code).toBe(0);
    expect(plain.err).toBe("lore: excluded unknown-attribute in .lore/bad.lore line 1 (entry broken)\n");
    expect((await lore(["audit", "--repo", root, "--strict"])).code).toBe(1);
  });

  test("a directory repo-inside-repo excludes covers its own rules, so a record of one in the outer lock file is an orphan", async () => {
    const root = shop({
      "apps/web/.loreconfig": "repo: github.com/acme/shop\n",
      "apps/web/.lore/web.lore": ruleCiting("web-rule", `/${SOURCE.file}`),
      "lore-reviews.lock": LOCK + lockFor("web-rule", SOURCE, DOC).split("\n")[1] + "\n",
    });
    expect(await lore(["audit", "--repo", root])).toEqual({
      code: 0, out: `lore-reviews.lock\n  warn  orphan-review  web-rule  docs/checkout-review.md#${HEADING}\n\norphan-review: 1\nrules with a source: 1, without: 1\n`,
      err: "lore: excluded repo-inside-repo in apps/web/.loreconfig line 1\n",
    });
  });

  test("--format json is an audit result plus the excluded entries", async () => {
    const root = shop({ ".lore/bad.lore": BROKEN, ".lore/b.lore": ruleCiting("notes-rule", "docs/notes.md", null) });
    const { code, out, err } = await lore(["audit", "--repo", root, "--format", "json"]);
    expect(code).toBe(1);
    expect(err).toBe("");
    const result = JSON.parse(out);
    expect(Object.keys(result)).toEqual(["findings", "summary", "excluded", "unjudged", "warnings"]);
    const ajv = new Ajv({ allErrors: true, strict: true });
    const schemas = join(import.meta.dir, "../../../spec/schemas");
    for (const name of readdirSync(schemas)) ajv.addSchema(JSON.parse(readFileSync(join(schemas, name), "utf8")));
    const validate = ajv.getSchema("https://lore.dev/schemas/v1/audit.schema.json")!;
    expect(validate({ findings: result.findings, summary: result.summary })).toBe(true);
    expect(result.findings).toEqual([
      { name: "source-missing", level: "error", rule: "notes-rule", file: ".lore/b.lore", source: { file: "docs/notes.md", heading: null, phrase: null }, reason: "file not found: docs/notes.md" },
    ]);
    expect(result.excluded).toEqual([{ name: "unknown-attribute", file: ".lore/bad.lore", entry: "broken", line: 1, range: expect.any(Object) }]);
  });

  test("--rules-ref reads the rules, the lock file and the cited files at that revision", async () => {
    const root = shop();
    write(root, { ".lore/a.lore": `${ruleCiting("money-in-cents", SOURCE.file)}\n${PLAIN}`, "docs/checkout-review.md": DOC.replace("(cents).", "(cents), never floats.") });
    rmSync(join(root, "lore-reviews.lock"));
    commit(root, {});
    expect(await lore(["audit", "--repo", root, "--rules-ref", "HEAD~1"])).toEqual({ code: 0, out: "rules with a source: 1, without: 1\n", err: "" });
    const head = await lore(["audit", "--repo", root]);
    expect(head.out).toContain(".lore/a.lore\n  warn  never-reviewed  money-in-cents  docs/checkout-review.md#");
  });
});

describe("files the command could not read", () => {
  const linkOut = (root: string, path: string, content: string | null): void => {
    const outside = tempDir();
    if (content !== null) write(outside, { "target": content });
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(join(outside, "target"), join(root, path));
  };
  const linked = (extra: Record<string, string>): string => {
    const root = repoWith({ "docs/checkout-review.md": DOC, "lore-reviews.lock": LOCK, ...extra });
    linkOut(root, ".lore/a.lore", RULE);
    commit(root, {});
    return root;
  };
  const WARNING = "lore: warning lore-file-not-read in .lore/a.lore line 1\n";
  const UNREAD = notChecked("lore-reviews.lock", ".lore/a.lore could not be read");

  test("a tracked Lore file that links out of the repo is warned on stderr, and its record is no orphan", async () => {
    expect(await lore(["audit", "--repo", linked({})])).toEqual({ code: 0, out: "rules with a source: 0, without: 0\n", err: WARNING });
  });

  test("its record is no orphan beside a readable Lore file of the same Lore root either", async () => {
    const { code, out, err } = await lore(["audit", "--repo", linked({ ".lore/b.lore": PLAIN })]);
    expect(code).toBe(0);
    expect(err).toBe(WARNING + UNREAD);
    expect(out).toBe("rules with a source: 0, without: 1\n");
  });

  test("a record under another Lore root is still an orphan", async () => {
    const other = lockFor("gone-rule", SOURCE, DOC);
    const { out } = await lore(["audit", "--repo", linked({ "apps/web/.loreconfig": "root: true\n", "apps/web/.lore/b.lore": PLAIN, "apps/web/lore-reviews.lock": other })]);
    expect(out).toContain(`apps/web/lore-reviews.lock\n  warn  orphan-review  gone-rule  docs/checkout-review.md#${HEADING}\n`);
  });

  test("an unreadable .loreconfig is warned", async () => {
    const root = shop();
    linkOut(root, ".loreconfig", null);
    commit(root, {});
    const { code, err } = await lore(["audit", "--repo", root]);
    expect(code).toBe(0);
    expect(err).toBe("lore: warning lore-file-not-read in .loreconfig line 1\n");
  });

  test("the model's warnings are on stderr too, and none of them makes --strict exit 1", async () => {
    const root = shop({ ".lore/b.lore": '<rule id="no-category">\nProse.\n</rule>\n' });
    const { code, err } = await lore(["audit", "--repo", root, "--strict"]);
    expect(code).toBe(0);
    expect(err).toBe("lore: warning missing-category in .lore/b.lore line 1 (entry no-category)\n");
  });

  test("the warnings are those lore select gives for the same rules", async () => {
    const root = linked({ ".lore/b.lore": '<context id="guide" src="docs/missing.md">\nRead it.\n</context>\n<rule id="no-category">\nProse.\n</rule>\n' });
    const audited = JSON.parse((await lore(["audit", "--repo", root, "--format", "json"])).out).warnings;
    const selected = JSON.parse((await lore(["select", "--repo", root, "--diff", "-", "--format", "json"])).out).warnings;
    expect(audited.map((warning: { name: string }) => warning.name).sort()).toEqual(["lore-file-not-read", "missing-category", "missing-src-target"]);
    expect(audited).toEqual(selected);
  });

  test("--format json carries the warnings beside excluded", async () => {
    const { code, out, err } = await lore(["audit", "--repo", linked({ ".lore/b.lore": PLAIN }), "--format", "json"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    const result = JSON.parse(out);
    expect(Object.keys(result)).toEqual(["findings", "summary", "excluded", "unjudged", "warnings"]);
    expect(result.findings).toEqual([]);
    expect(result.warnings).toEqual([{ name: "lore-file-not-read", file: ".lore/a.lore", entry: null, line: 1 }]);
    expect(result.unjudged).toEqual([{ file: "lore-reviews.lock", reason: ".lore/a.lore could not be read" }]);
  });
});

describe("a lock file that may cover a rule the run did not collect", () => {
  const team = () => repoWith({
    "lore/.loreconfig": "root: true\n",
    "lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
    "lore/shop/.lore/a.lore": ruleCiting("shop-rule", `/${SOURCE.file}`),
    "lore/shop/.lore/bad.lore": "<rule id=\"x\">\n",
    "lore/shop/lore-reviews.lock": lockFor("gone-rule", SOURCE, DOC) + lockFor("shop-rule", SOURCE, DOC).split("\n")[1] + "\n",
  });
  const governed = () => {
    const root = repoWith({ "docs/checkout-review.md": DOC });
    git(root, "remote", "add", "origin", "https://github.com/acme/shop.git");
    return root;
  };
  const LOCKED = "external:lore/shop/lore-reviews.lock";
  const REASON = "an error in external:lore/shop/.lore/bad.lore may hide rules";
  const EXCLUDED = "lore: excluded unreadable-structure in external:lore/shop/.lore/bad.lore line 1\n";

  test("reports no orphan-review there and says on stderr that it did not check", async () => {
    expect(await lore(["audit", "--repo", governed(), "--given", join(team(), "lore")])).toEqual({
      code: 0, out: "rules with a source: 1, without: 0\n", err: EXCLUDED + notChecked(LOCKED, REASON),
    });
  });

  test("--format json lists the lock file under unjudged with the reason", async () => {
    const { code, out, err } = await lore(["audit", "--repo", governed(), "--given", join(team(), "lore"), "--format", "json"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    const result = JSON.parse(out);
    expect(result.findings).toEqual([]);
    expect(result.unjudged).toEqual([{ file: LOCKED, reason: REASON }]);
  });

  test("a lock file the run collected every rule of reports its orphans and lists nothing under unjudged", async () => {
    const root = shop({ "lore-reviews.lock": LOCK + lockFor("gone-rule", SOURCE, DOC).split("\n")[1] + "\n" });
    const { code, out, err } = await lore(["audit", "--repo", root]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain(`lore-reviews.lock\n  warn  orphan-review  gone-rule  docs/checkout-review.md#${HEADING}\n`);
    expect(JSON.parse((await lore(["audit", "--repo", root, "--format", "json"])).out).unjudged).toEqual([]);
  });

  test("an untracked Lore file that lore review recorded is no orphan until git tracks it", async () => {
    const root = shop({ "lore-reviews.lock": LOCK + lockFor("gone-rule", SOURCE, DOC).split("\n")[1] + "\n" });
    write(root, { ".lore/new.lore": ruleCiting("fresh", SOURCE.file) });
    expect((await lore(["review", "fresh", "--repo", root])).code).toBe(0);
    git(root, "add", "lore-reviews.lock");
    git(root, "commit", "-q", "-m", "review");
    const note = notChecked("lore-reviews.lock", ".lore/new.lore is not tracked by git");
    expect(await lore(["audit", "--repo", root])).toEqual({ code: 0, out: "rules with a source: 1, without: 1\n", err: note });
    const json = JSON.parse((await lore(["audit", "--repo", root, "--format", "json"])).out);
    expect(json.unjudged).toEqual([{ file: "lore-reviews.lock", reason: ".lore/new.lore is not tracked by git" }]);
    git(root, "add", ".lore/new.lore");
    const tracked = await lore(["audit", "--repo", root]);
    expect(tracked.err).toBe("");
    expect(tracked.out).toContain(`lore-reviews.lock\n  warn  orphan-review  gone-rule  docs/checkout-review.md#${HEADING}\n`);
    expect(tracked.out).not.toContain("orphan-review  fresh");
  });
});

describe("a shared rules repository: each governed repo reads the lock files of its own marked directories", () => {
  const line = (rule: string, source: Source = SOURCE): string => `${lockFor(rule, source, DOC).split("\n")[1]}\n`;
  const DATES: Source = { file: "docs/checkout-review.md", heading: "Dates", phrase: null };
  const governed = (repository: string) => {
    const root = repoWith({ "docs/checkout-review.md": DOC });
    git(root, "remote", "add", "origin", `https://github.com/acme/${repository}.git`);
    return root;
  };
  const team = (extra: Record<string, string> = {}) => repoWith({
    "docs/checkout-review.md": DOC,
    "lore/.loreconfig": "root: true\n",
    "lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
    "lore/shop/.lore/a.lore": ruleCiting("shop-rule", `/${SOURCE.file}`),
    "lore/web/.loreconfig": "repo: github.com/acme/shop\n",
    "lore/web/.lore/b.lore": ruleCiting("web-rule", `/${SOURCE.file}`),
    "lore/blog/.loreconfig": "repo: github.com/acme/blog\n",
    "lore/blog/.lore/c.lore": ruleCiting("blog-rule", `/${SOURCE.file}`),
    "lore/own/.lore/t.lore": ruleCiting("team-rule", `/${SOURCE.file}`),
    "lore/shop/lore-reviews.lock": lockFor("shop-rule", SOURCE, DOC) + line("shop-gone"),
    "lore/web/lore-reviews.lock": lockFor("web-rule", SOURCE, DOC),
    "lore/blog/lore-reviews.lock": lockFor("blog-rule", SOURCE, DOC) + line("blog-gone"),
    "lore/lore-reviews.lock": lockFor("team-rule", SOURCE, DOC) + line("team-gone"),
    ...extra,
  });
  const orphanLine = (lock: string, rule: string) => `${lock}\n  warn  orphan-review  ${rule}  docs/checkout-review.md#${HEADING}\n`;

  test("the shop, the blog and the rules repository itself each judge only their own lock files", async () => {
    const folder = team();
    const fromShop = await lore(["audit", "--repo", governed("shop"), "--given", join(folder, "lore")]);
    expect(fromShop).toEqual({
      code: 0, out: `${orphanLine("external:lore/shop/lore-reviews.lock", "shop-gone")}\norphan-review: 1\nrules with a source: 2, without: 0\n`, err: "",
    });
    const fromBlog = await lore(["audit", "--repo", governed("blog"), "--given", join(folder, "lore")]);
    expect(fromBlog).toEqual({
      code: 0, out: `${orphanLine("external:lore/blog/lore-reviews.lock", "blog-gone")}\norphan-review: 1\nrules with a source: 1, without: 0\n`, err: "",
    });
    const own = await lore(["audit", "--repo", folder]);
    expect(own.out).toBe(`${orphanLine("lore/lore-reviews.lock", "team-gone")}\norphan-review: 1\nrules with a source: 1, without: 0\n`);
    expect(own.err).not.toContain("orphan-review not checked");
  });

  test("the same id in the shop's and the blog's folders is judged against each folder's own record", async () => {
    const folder = team({
      "lore/shop/.lore/a.lore": ruleCiting("dup", `/${SOURCE.file}`),
      "lore/blog/.lore/c.lore": ruleCiting("dup", `/${DATES.file}`, "Dates"),
      "lore/shop/lore-reviews.lock": lockFor("dup", SOURCE, DOC),
      "lore/blog/lore-reviews.lock": lockFor("dup", DATES, DOC),
    });
    for (const repository of ["shop", "blog"]) {
      const { code, out, err } = await lore(["audit", "--repo", governed(repository), "--given", join(folder, "lore")]);
      expect({ code, err }).toEqual({ code: 0, err: "" });
      expect(out).not.toContain("never-reviewed");
      expect(out).not.toContain("orphan-review");
    }
  });

  test("an untracked Lore file in the rules repository is noted in its own audit and never in the shop's", async () => {
    const folder = team();
    write(folder, {
      "lore/own/.lore/n.lore": ruleCiting("team-new", `/${DATES.file}`, "Dates"),
      "lore/shop/.lore/n.lore": ruleCiting("shop-new", `/${DATES.file}`, "Dates"),
    });
    const own = await lore(["audit", "--repo", folder]);
    expect(own.out).not.toContain("orphan-review");
    expect(own.err).toEndWith(notChecked("lore/lore-reviews.lock", "lore/own/.lore/n.lore is not tracked by git"));
    expect(own.err).not.toContain("lore/shop/.lore/n.lore");
    const fromShop = await lore(["audit", "--repo", governed("shop"), "--given", join(folder, "lore")]);
    expect(fromShop.err).toBe("");
    expect(fromShop.out).not.toContain("team-");
  });

  test("the governed repo given as a folder judges each of its two lock files against its own rules", async () => {
    const root = repoWith({
      "docs/checkout-review.md": DOC,
      "lore/.loreconfig": "root: true\n",
      "lore/a/.loreconfig": "repo: github.com/acme/shop\n",
      "lore/a/.lore/r.lore": ruleCiting("a-rule", `/${SOURCE.file}`),
      "lore/b/.lore/r.lore": ruleCiting("b-rule", `/${SOURCE.file}`),
      "lore/a/lore-reviews.lock": lockFor("a-rule", SOURCE, DOC),
      "lore/lore-reviews.lock": lockFor("b-rule", SOURCE, DOC) + line("gone-rule"),
    });
    git(root, "remote", "add", "origin", "https://github.com/acme/shop.git");
    const json = JSON.parse((await lore(["audit", "--repo", root, "--given", join(root, "lore"), "--format", "json"])).out);
    expect(json.unjudged).toEqual([]);
    expect(json.findings.map((finding: { name: string; rule: string; file: string }) => [finding.name, finding.rule, finding.file])).toEqual([
      ["orphan-review", "gone-rule", "lore/lore-reviews.lock"],
    ]);
  });
});

describe("renderAudit", () => {
  test("groups findings under each file, then counts each finding and the rules", () => {
    const result: AuditResult = {
      findings: [
        { name: "meta-source", level: "warn", rule: "old-style", file: ".lore/a.lore", source: null, reason: null },
        { name: "ambiguous-heading", level: "warn", rule: "two", file: ".lore/a.lore", source: { file: "docs/x.md", heading: "Dates", phrase: "ISO" }, reason: null },
        { name: "never-reviewed", level: "warn", rule: "two", file: ".lore/a.lore", source: { file: "docs/x.md", heading: "Dates", phrase: "ISO" }, reason: null },
        { name: "orphan-review", level: "warn", rule: "gone", file: "lore-reviews.lock", source: { file: "docs/x.md", heading: null, phrase: null }, reason: null },
      ],
      summary: { counts: { "ambiguous-heading": 1, "never-reviewed": 1, "orphan-review": 1, "meta-source": 1 }, rulesWithSource: 1, rulesWithoutSource: 1 },
      excluded: [],
      unjudged: [],
    };
    expect(renderAudit(result)).toBe(
      ".lore/a.lore\n" +
      "  warn  meta-source  old-style\n" +
      '  warn  ambiguous-heading  two  docs/x.md#Dates "ISO"\n' +
      '  warn  never-reviewed  two  docs/x.md#Dates "ISO"\n' +
      "\n" +
      "lore-reviews.lock\n" +
      "  warn  orphan-review  gone  docs/x.md\n" +
      "\n" +
      "ambiguous-heading: 1\n" +
      "never-reviewed: 1\n" +
      "orphan-review: 1\n" +
      "meta-source: 1\n" +
      "rules with a source: 1, without: 1\n",
    );
  });
});
