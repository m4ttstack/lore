import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveSource, writeReviews, type ReviewRecord, type Source } from "@lore/parser";
import { parseCommand } from "../src/args";
import { run } from "../src/main";

const TODAY = "2026-11-12";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-review-")));
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
const MONEY: Source = { file: "docs/checkout-review.md", heading: HEADING, phrase: null };
const DATES: Source = { file: "docs/checkout-review.md", heading: "Dates", phrase: null };

const ruleCiting = (id: string, file: string, heading: string | null = HEADING) =>
  `<rule id="${id}" category="functional_correctness" severity="blocking">\n<source>\nfile: ${file}\n${heading === null ? "" : `heading: ${heading}\n`}</source>\nFollow the review.\n</rule>\n`;
const RULE = ruleCiting("money-in-minor-units", MONEY.file);
const DATES_RULE = ruleCiting("dates-are-iso", DATES.file, "Dates");
const PLAIN = '<rule id="price-from-quote" category="functional_correctness">\nTake the price from the quote.\n</rule>\n';

function record(rule: string, source: Source, text = DOC, reviewed = "2026-11-01"): ReviewRecord {
  const resolved = resolveSource(source, text);
  if (!resolved.ok) throw new Error("the source does not resolve");
  return { rule, ...source, reviewed, hash: resolved.hash };
}

function shop(extra: Record<string, string> = {}): string {
  return repoWith({ ".lore/checkout.lore": `${RULE}\n${PLAIN}`, "docs/checkout-review.md": DOC, ...extra });
}

const lockOf = (root: string, path = "lore-reviews.lock"): string => readFileSync(join(root, path), "utf8");
const untracked = (lock: string): string => `lore: ${lock} is not tracked by git; lore audit reads it once it is tracked (for example after git add)\n`;
const notPruning = (lock: string, reason: string): string => `lore: not pruning ${lock}: its Lore root is not wholly collected (${reason})\n`;

describe("parsing lore review", () => {
  test("reads rule ids, --date, --repo and --given", () => {
    expect(parseCommand(["review", "a", "b", "--date", "2026-01-02", "--repo", "x", "--given", "g", "--given=h"])).toEqual({
      name: "review", ids: ["a", "b"], files: [], prune: false, date: "2026-01-02", repo: "x", given: ["g", "h"],
    });
  });

  test("reads repeated --file, and --prune", () => {
    expect(parseCommand(["review", "--file", ".lore/a.lore", "--file=.lore/b.lore"])).toEqual({
      name: "review", ids: [], files: [".lore/a.lore", ".lore/b.lore"], prune: false, date: null, repo: null, given: [],
    });
    expect(parseCommand(["review", "--prune"])).toEqual({ name: "review", ids: [], files: [], prune: true, date: null, repo: null, given: [] });
  });

  test("--help prints the help", () => {
    expect(parseCommand(["review", "--help"])).toEqual({ name: "help" });
  });
});

describe("lore review", () => {
  test("writes the rule's record with today's date and the fingerprint, and creates the lock file", async () => {
    const root = shop();
    expect(await lore(["review", "money-in-minor-units", "--repo", root])).toEqual({
      code: 0, out: "reviewed money-in-minor-units (1 source)\n", err: untracked("lore-reviews.lock"),
    });
    expect(lockOf(root)).toBe(writeReviews([record("money-in-minor-units", MONEY, DOC, TODAY)]));
    expect(readdirSync(root).filter((name) => name.startsWith("lore-reviews"))).toEqual(["lore-reviews.lock"]);
  });

  test("--date is written as given", async () => {
    const root = shop();
    expect((await lore(["review", "money-in-minor-units", "--date", "2026-01-02", "--repo", root])).code).toBe(0);
    expect(lockOf(root)).toBe(writeReviews([record("money-in-minor-units", MONEY, DOC, "2026-01-02")]));
  });

  test("reviewing again replaces the rule's records and leaves the other rules' lines as they were", async () => {
    const root = shop({ ".lore/dates.lore": DATES_RULE });
    const other = JSON.stringify(record("dates-are-iso", DATES));
    write(root, { "lore-reviews.lock": writeReviews([record("money-in-minor-units", MONEY), record("dates-are-iso", DATES)]) });
    commit(root, { "docs/checkout-review.md": DOC.replace("(cents).", "(cents), never floats.") });
    expect((await lore(["review", "money-in-minor-units", "--repo", root])).code).toBe(0);
    const lines = lockOf(root).split("\n");
    expect(lines[1]).toBe(other);
    expect(lines[2]).toBe(JSON.stringify(record("money-in-minor-units", MONEY, DOC.replace("(cents).", "(cents), never floats."), TODAY)));
  });

  test("a rule's records for a source it no longer has are replaced too", async () => {
    const root = shop({ "lore-reviews.lock": writeReviews([record("money-in-minor-units", DATES)]) });
    expect((await lore(["review", "money-in-minor-units", "--repo", root])).code).toBe(0);
    expect(lockOf(root)).toBe(writeReviews([record("money-in-minor-units", MONEY, DOC, TODAY)]));
  });

  test("--file reviews every rule of that file that has a source, and skips the others", async () => {
    const root = shop({ ".lore/checkout.lore": `${RULE}\n${PLAIN}\n${DATES_RULE}` });
    expect(await lore(["review", "--file", ".lore/checkout.lore", "--repo", root])).toEqual({
      code: 0, out: "reviewed money-in-minor-units (1 source)\nreviewed dates-are-iso (1 source)\n", err: untracked("lore-reviews.lock"),
    });
    expect(lockOf(root)).toBe(writeReviews([record("money-in-minor-units", MONEY, DOC, TODAY), record("dates-are-iso", DATES, DOC, TODAY)]));
  });

  test("a rule whose source does not resolve is refused and keeps its record, while the other rule is written", async () => {
    const earlier = record("dates-are-iso", DATES);
    const root = shop({ ".lore/dates.lore": DATES_RULE, "lore-reviews.lock": writeReviews([earlier]) });
    commit(root, { "docs/checkout-review.md": DOC.replace("## Dates", "## Times") });
    const { code, out, err } = await lore(["review", "money-in-minor-units", "dates-are-iso", "--repo", root]);
    expect(code).toBe(1);
    expect(out).toBe("reviewed money-in-minor-units (1 source)\nrefused dates-are-iso (1 source does not resolve)\n");
    expect(err).toBe('lore: error  source-missing  dates-are-iso  docs/checkout-review.md#Dates  heading not found: "Dates"\n');
    const changed = DOC.replace("## Dates", "## Times");
    expect(lockOf(root)).toBe(writeReviews([earlier, record("money-in-minor-units", MONEY, changed, TODAY)]));
  });

  test("a cited file git does not track is refused, as lore audit reads it", async () => {
    const root = shop({ ".lore/notes.lore": ruleCiting("notes-rule", "docs/notes.md", null) });
    write(root, { "docs/notes.md": "Notes.\n" });
    const { code, out, err } = await lore(["review", "notes-rule", "--repo", root]);
    expect(code).toBe(1);
    expect(out).toBe("refused notes-rule (1 source does not resolve)\n");
    expect(err).toBe("lore: error  source-missing  notes-rule  docs/notes.md  file not found: docs/notes.md\n");
    expect(existsSync(join(root, "lore-reviews.lock"))).toBe(false);
  });

  test("a rule with an ambiguous heading is written, with the warning", async () => {
    const twice = `${DOC}\n## Dates\n\nAgain.\n`;
    const root = shop({ ".lore/dates.lore": DATES_RULE, "docs/checkout-review.md": twice });
    const { code, out, err } = await lore(["review", "dates-are-iso", "--repo", root]);
    expect(code).toBe(0);
    expect(out).toBe("reviewed dates-are-iso (1 source)\n");
    expect(err).toBe(`lore: warn  ambiguous-heading  dates-are-iso  docs/checkout-review.md#Dates\n${untracked("lore-reviews.lock")}`);
    expect(lockOf(root)).toBe(writeReviews([record("dates-are-iso", DATES, twice, TODAY)]));
  });

  test("a rule in an untracked Lore file can be reviewed", async () => {
    const root = shop();
    write(root, { ".lore/new.lore": DATES_RULE });
    expect(await lore(["review", "dates-are-iso", "--repo", root])).toEqual({
      code: 0, out: "reviewed dates-are-iso (1 source)\n", err: untracked("lore-reviews.lock"),
    });
    expect(lockOf(root)).toBe(writeReviews([record("dates-are-iso", DATES, DOC, TODAY)]));
  });

  test("a second run before the lock file is staged keeps the first run's records", async () => {
    const root = shop({ ".lore/dates.lore": DATES_RULE });
    expect((await lore(["review", "money-in-minor-units", "--repo", root])).code).toBe(0);
    expect((await lore(["review", "dates-are-iso", "--repo", root])).code).toBe(0);
    expect(lockOf(root)).toBe(writeReviews([record("money-in-minor-units", MONEY, DOC, TODAY), record("dates-are-iso", DATES, DOC, TODAY)]));
  });

  test("a lock file git does not track is named each time it is written, and a staged one is not", async () => {
    const root = shop({ ".lore/dates.lore": DATES_RULE });
    expect((await lore(["review", "money-in-minor-units", "--repo", root])).err).toBe(untracked("lore-reviews.lock"));
    expect((await lore(["review", "dates-are-iso", "--repo", root])).err).toBe(untracked("lore-reviews.lock"));
    expect((await lore(["audit", "--repo", root])).out).toContain("never-reviewed  dates-are-iso");
    git(root, "add", "lore-reviews.lock");
    expect(await lore(["review", "dates-are-iso", "--date", "2026-11-13", "--repo", root])).toEqual({
      code: 0, out: "reviewed dates-are-iso (1 source)\n", err: "",
    });
    expect((await lore(["audit", "--repo", root])).out).not.toContain("never-reviewed");
  });

  test("a run that writes nothing names no lock file, tracked or not", async () => {
    const root = shop();
    expect((await lore(["review", "money-in-minor-units", "--repo", root])).code).toBe(0);
    expect(await lore(["review", "--prune", "--repo", root])).toEqual({ code: 0, out: "", err: "" });
  });

  test("a rule in a given folder with a ./ source writes that folder's lock file", async () => {
    const root = shop();
    git(root, "remote", "add", "origin", "https://github.com/acme/shop.git");
    const guided = '<rule id="guide-rule" category="functional_correctness">\n<source>\nfile: ./guide.md\n</source>\nFollow the guide.\n</rule>\n';
    const folder = repoWith({ "rules/.loreconfig": "lore: 1\nrepo: github.com/acme/shop\n", "rules/.lore/a.lore": guided, "rules/.lore/guide.md": "# Guide\n" });
    const { code, out, err } = await lore(["review", "guide-rule", "--repo", root, "--given", join(folder, "rules")]);
    expect(err).toBe(untracked("external:rules/lore-reviews.lock"));
    expect(out).toBe("reviewed guide-rule (1 source)\n");
    expect(code).toBe(0);
    const guide: Source = { file: "external:rules/.lore/guide.md", heading: null, phrase: null };
    expect(lockOf(folder, "rules/lore-reviews.lock")).toBe(writeReviews([record("guide-rule", guide, "# Guide\n", TODAY)]));
    expect(existsSync(join(root, "lore-reviews.lock"))).toBe(false);
    expect((await lore(["review", "--prune", "--repo", root, "--given", join(folder, "rules")])).out).toBe("");
    expect(lockOf(folder, "rules/lore-reviews.lock")).toBe(writeReviews([record("guide-rule", guide, "# Guide\n", TODAY)]));
  });

  test("a rule in a loose given folder writes the lock file at the folder's root", async () => {
    const root = shop();
    git(root, "remote", "add", "origin", "https://github.com/acme/shop.git");
    const folder = tempDir();
    const guided = '<rule id="guide-rule" category="functional_correctness">\n<source>\nfile: ./guide.md\n</source>\nFollow the guide.\n</rule>\n';
    write(folder, { ".loreconfig": "lore: 1\nrepo: github.com/acme/shop\n", ".lore/a.lore": guided, ".lore/guide.md": "# Guide\n" });
    expect(await lore(["review", "guide-rule", "--repo", root, "--given", folder])).toEqual({
      code: 0, out: "reviewed guide-rule (1 source)\n", err: "lore: warning untracked-given-folder in loose:. line 1\n",
    });
    const guide: Source = { file: "loose:.lore/guide.md", heading: null, phrase: null };
    expect(lockOf(folder)).toBe(writeReviews([record("guide-rule", guide, "# Guide\n", TODAY)]));
  });

  test("a review of one rule keeps a deleted rule's record, and --prune removes it", async () => {
    const gone = record("gone-rule", MONEY);
    const root = shop({ "lore-reviews.lock": writeReviews([gone]) });
    expect(await lore(["review", "money-in-minor-units", "--repo", root])).toEqual({
      code: 0, out: "reviewed money-in-minor-units (1 source)\n", err: "",
    });
    expect(lockOf(root)).toBe(writeReviews([gone, record("money-in-minor-units", MONEY, DOC, TODAY)]));
    expect(await lore(["review", "--file", ".lore/checkout.lore", "--repo", root])).toEqual({
      code: 0, out: "reviewed money-in-minor-units (1 source)\n", err: "",
    });
    expect(lockOf(root).split("\n")).toContain(JSON.stringify(gone));
    expect(await lore(["review", "--prune", "--repo", root])).toEqual({ code: 0, out: "pruned 1 record from lore-reviews.lock\n", err: "" });
    expect(lockOf(root)).toBe(writeReviews([record("money-in-minor-units", MONEY, DOC, TODAY)]));
  });

  test("--prune alone removes the orphans and changes nothing else", async () => {
    const stale = record("money-in-minor-units", MONEY, "# Old\n\n## Money is integer minor units\n\nOld text.\n");
    const root = shop({
      ".lore/dates.lore": DATES_RULE,
      "lore-reviews.lock": writeReviews([stale, record("gone-rule", MONEY), record("money-in-minor-units", DATES)]),
    });
    expect(await lore(["review", "--prune", "--repo", root])).toEqual({ code: 0, out: "pruned 2 records from lore-reviews.lock\n", err: "" });
    expect(lockOf(root)).toBe(writeReviews([stale]));
  });

  test("when nothing changes the lock file is not rewritten", async () => {
    const crlf = writeReviews([record("money-in-minor-units", MONEY, DOC, TODAY)]).replaceAll("\n", "\r\n");
    const root = shop({ "lore-reviews.lock": crlf });
    expect(await lore(["review", "--prune", "--repo", root])).toEqual({ code: 0, out: "", err: "" });
    expect(lockOf(root)).toBe(crlf);
    expect(await lore(["review", "money-in-minor-units", "--repo", root])).toEqual({ code: 0, out: "reviewed money-in-minor-units (1 source)\n", err: "" });
    expect(lockOf(root)).toBe(crlf);
  });

  test("a malformed lock file exits 2 and is not overwritten", async () => {
    const root = shop({ "lore-reviews.lock": '{"lore-reviews":1}\nnot json\n' });
    expect(await lore(["review", "money-in-minor-units", "--repo", root])).toEqual({
      code: 2, out: "", err: "lore: malformed lock file lore-reviews.lock line 2: the line is not valid JSON\n",
    });
    expect(lockOf(root)).toBe('{"lore-reviews":1}\nnot json\n');
  });

  describe("usage errors exit 2 and leave the lock file untouched", () => {
    const LOCK = writeReviews([record("money-in-minor-units", MONEY), record("gone-rule", MONEY)]);
    test.each([
      ["--date that is not a real date", ["money-in-minor-units", "--date", "2026-02-30"], "--date"],
      ["no ids, no --file and no --prune", [], "give rule ids, --file or --prune"],
      ["--rules-ref", ["money-in-minor-units", "--rules-ref", "main"], "--rules-ref"],
      ["--remote", ["money-in-minor-units", "--remote", "github.com/acme/shop"], "--remote"],
      ["--no-repo", ["money-in-minor-units", "--no-repo"], "--no-repo"],
      ["--format", ["money-in-minor-units", "--format", "json"], "--format"],
      ["ids with --prune", ["money-in-minor-units", "--prune"], "--prune"],
      ["ids with --file", ["money-in-minor-units", "--file", ".lore/checkout.lore"], "--file"],
      ["an id that names no rule, beside one that does", ["money-in-minor-units", "no-such-rule"], "no rule with id no-such-rule"],
      ["a rule with no <source>", ["price-from-quote"], "rule price-from-quote has no <source>"],
      ["a --file that is not a collected Lore file", ["--file", "docs/checkout-review.md"], "not a collected Lore file: docs/checkout-review.md"],
    ])("%s", async (_name, args, mention) => {
      const root = shop({ "lore-reviews.lock": LOCK });
      const { code, out, err } = await lore(["review", ...args, "--repo", root]);
      expect(code).toBe(2);
      expect(out).toBe("");
      expect(err).toContain(mention);
      expect(err.split("\n").length).toBe(2);
      expect(lockOf(root)).toBe(LOCK);
    });

    test("an id whose entry was excluded names the error", async () => {
      const root = shop({ ".lore/bad.lore": '<rule id="broken" src="README.md">\nProse.\n</rule>\n', "lore-reviews.lock": LOCK });
      const { code, err } = await lore(["review", "broken", "--repo", root]);
      expect(code).toBe(2);
      expect(err).toEndWith("lore: rule broken was excluded: unknown-attribute in .lore/bad.lore line 1\n");
      expect(lockOf(root)).toBe(LOCK);
    });
  });
});

describe("records that are not provably orphans are kept", () => {
  const KEPT = record("broken-rule", DATES);
  const GONE = record("gone-rule", MONEY);
  const LOCK = writeReviews([GONE, KEPT, record("money-in-minor-units", MONEY)]);
  const EXCLUDED = "lore: excluded unknown-attribute in .lore/bad.lore line 1 (entry broken-rule)\n";

  test("an excluded rule's records survive a review of another rule and --prune, while --prune removes a true orphan", async () => {
    const bad = '<rule id="broken-rule" src="README.md">\n<source>\nfile: docs/checkout-review.md\nheading: Dates\n</source>\nProse.\n</rule>\n';
    const root = shop({ ".lore/bad.lore": bad, "lore-reviews.lock": LOCK });
    const reviewed = await lore(["review", "money-in-minor-units", "--repo", root]);
    expect(reviewed).toEqual({ code: 0, out: "reviewed money-in-minor-units (1 source)\n", err: EXCLUDED });
    expect(lockOf(root)).toBe(writeReviews([GONE, KEPT, record("money-in-minor-units", MONEY, DOC, TODAY)]));
    expect(await lore(["review", "--prune", "--repo", root])).toEqual({ code: 0, out: "pruned 1 record from lore-reviews.lock\n", err: EXCLUDED });
    expect(lockOf(root)).toBe(writeReviews([KEPT, record("money-in-minor-units", MONEY, DOC, TODAY)]));
  });

  test("a Lore file with a parse error keeps every record of its Lore root", async () => {
    const root = shop({ ".lore/bad.lore": '<rule id="broken-rule" category="functional_correctness">\nProse.\n', "lore-reviews.lock": LOCK });
    const excluded = "lore: excluded unreadable-structure in .lore/bad.lore line 1\n";
    const reviewed = await lore(["review", "money-in-minor-units", "--repo", root]);
    expect(reviewed).toEqual({ code: 0, out: "reviewed money-in-minor-units (1 source)\n", err: excluded });
    expect(lockOf(root)).toBe(writeReviews([GONE, KEPT, record("money-in-minor-units", MONEY, DOC, TODAY)]));
    expect(await lore(["review", "--prune", "--repo", root])).toEqual({
      code: 0, out: "", err: excluded + notPruning("lore-reviews.lock", "an error in .lore/bad.lore may hide rules"),
    });
    expect(lockOf(root)).toBe(writeReviews([GONE, KEPT, record("money-in-minor-units", MONEY, DOC, TODAY)]));
  });

  test("a Lore file that could not be read keeps every record of its Lore root, with the warning", async () => {
    const root = shop({ "lore-reviews.lock": LOCK });
    const outside = tempDir();
    write(outside, { target: DATES_RULE });
    symlinkSync(join(outside, "target"), join(root, ".lore/linked.lore"));
    commit(root, {});
    const warning = "lore: warning lore-file-not-read in .lore/linked.lore line 1\n";
    const reviewed = await lore(["review", "money-in-minor-units", "--repo", root]);
    expect(reviewed).toEqual({ code: 0, out: "reviewed money-in-minor-units (1 source)\n", err: warning });
    expect(lockOf(root)).toBe(writeReviews([GONE, KEPT, record("money-in-minor-units", MONEY, DOC, TODAY)]));
    expect(await lore(["review", "--prune", "--repo", root])).toEqual({
      code: 0, out: "", err: warning + notPruning("lore-reviews.lock", ".lore/linked.lore could not be read"),
    });
    expect(lockOf(root)).toBe(writeReviews([GONE, KEPT, record("money-in-minor-units", MONEY, DOC, TODAY)]));
  });

  test("rules under a directory repo-inside-repo excludes keep their records through a review of another rule and --prune", async () => {
    const web = record("web-rule", MONEY);
    const lock = writeReviews([GONE, record("money-in-minor-units", MONEY), web]);
    const root = shop({
      "apps/web/.loreconfig": "repo: github.com/acme/shop\n",
      "apps/web/.lore/web.lore": ruleCiting("web-rule", `/${MONEY.file}`),
      "lore-reviews.lock": lock,
    });
    const excluded = "lore: excluded repo-inside-repo in apps/web/.loreconfig line 1\n";
    expect(await lore(["review", "money-in-minor-units", "--repo", root])).toEqual({
      code: 0, out: "reviewed money-in-minor-units (1 source)\n", err: excluded,
    });
    const after = writeReviews([GONE, record("money-in-minor-units", MONEY, DOC, TODAY), web]);
    expect(lockOf(root)).toBe(after);
    expect(lockOf(root).split("\n")).toContain(JSON.stringify(web));
    expect(await lore(["review", "--prune", "--repo", root])).toEqual({
      code: 0, out: "", err: excluded + notPruning("lore-reviews.lock", "an error in apps/web/.loreconfig may hide rules"),
    });
    expect(lockOf(root)).toBe(after);
  });

  test("rules under a directory nested-repo excludes in a given folder keep their records through --prune and a review", async () => {
    const root = shop();
    git(root, "remote", "add", "origin", "https://github.com/acme/shop.git");
    const web = record("web-rule", MONEY);
    const lock = writeReviews([GONE, record("shared-rule", MONEY), web]);
    const folder = repoWith({
      "lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "lore/shop/.lore/a.lore": ruleCiting("shared-rule", `/${MONEY.file}`),
      "lore/shop/apps/web/.loreconfig": "repo: github.com/acme/web\n",
      "lore/shop/apps/web/.lore/web.lore": ruleCiting("web-rule", `/${MONEY.file}`),
      "lore/shop/lore-reviews.lock": lock,
    });
    const args = ["--repo", root, "--given", join(folder, "lore")];
    const excluded = "lore: excluded nested-repo in external:lore/shop/apps/web/.loreconfig line 1\n";
    expect(await lore(["review", "--prune", ...args])).toEqual({
      code: 0, out: "", err: excluded + notPruning("external:lore/shop/lore-reviews.lock", "external:lore/shop/apps/web/.loreconfig names another repository"),
    });
    expect(lockOf(folder, "lore/shop/lore-reviews.lock")).toBe(lock);
    expect(await lore(["review", "shared-rule", ...args])).toEqual({ code: 0, out: "reviewed shared-rule (1 source)\n", err: excluded });
    expect(lockOf(folder, "lore/shop/lore-reviews.lock")).toBe(writeReviews([GONE, record("shared-rule", MONEY, DOC, TODAY), web]));
  });

  test("two external folders of one repository under one Lore root share its lock file, and neither prunes the other's records", async () => {
    const root = repoWith({ "docs/checkout-review.md": DOC });
    git(root, "remote", "add", "origin", "https://github.com/acme/shop.git");
    const web = record("web-rule", MONEY);
    const lock = writeReviews([record("shop-rule", MONEY), web]);
    const folder = repoWith({
      "lore/.loreconfig": "root: true\n",
      "lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "lore/shop/.lore/a.lore": ruleCiting("shop-rule", `/${MONEY.file}`),
      "lore/web/.loreconfig": "repo: github.com/acme/shop\n",
      "lore/web/.lore/b.lore": ruleCiting("web-rule", `/${MONEY.file}`),
      "lore/lore-reviews.lock": lock,
    });
    const args = ["--repo", root, "--given", join(folder, "lore")];
    expect(await lore(["review", "--prune", ...args])).toEqual({ code: 0, out: "", err: "" });
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(lock);
    expect(await lore(["review", "shop-rule", ...args])).toEqual({ code: 0, out: "reviewed shop-rule (1 source)\n", err: "" });
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(writeReviews([record("shop-rule", MONEY, DOC, TODAY), web]));
    expect(lockOf(folder, "lore/lore-reviews.lock").split("\n")).toContain(JSON.stringify(web));
    expect((await lore(["audit", ...args])).out).toBe("rules with a source: 2, without: 0\n");
  });

  test("a refused rule's records for a source it no longer has are left as they were", async () => {
    const root = shop({ ".lore/dates.lore": ruleCiting("dates-are-iso", DATES.file, "Times"), "lore-reviews.lock": writeReviews([record("dates-are-iso", DATES)]) });
    const { code } = await lore(["review", "dates-are-iso", "--repo", root]);
    expect(code).toBe(1);
    expect(lockOf(root)).toBe(writeReviews([record("dates-are-iso", DATES)]));
  });
});

describe("a Lore root the run did not wholly collect keeps every other rule's record", () => {
  const governed = (repository: string): string => {
    const root = repoWith({ "docs/checkout-review.md": DOC });
    git(root, "remote", "add", "origin", `https://github.com/acme/${repository}.git`);
    return root;
  };
  const SHOP = record("shop-rule", MONEY);
  const WEB = record("web-rule", MONEY);
  const BLOG = record("blog-rule", MONEY);
  const GONE = record("gone-rule", MONEY);
  const SHARED = "external:lore/lore-reviews.lock";
  const linesOf = (text: string): string[] => text.split("\n");
  const team = (extra: Record<string, string>, records: ReviewRecord[]): string => repoWith({
    "lore/.loreconfig": "root: true\n",
    "lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
    "lore/shop/.lore/a.lore": ruleCiting("shop-rule", `/${MONEY.file}`),
    "lore/lore-reviews.lock": writeReviews(records),
    ...extra,
  });

  test("folders for different repositories under one Lore root: a review from either side and --prune delete nothing", async () => {
    const folder = team({
      "lore/web/.loreconfig": "repo: github.com/acme/shop\n",
      "lore/web/.lore/b.lore": ruleCiting("web-rule", `/${MONEY.file}`),
      "lore/blog/.loreconfig": "repo: github.com/acme/blog\n",
      "lore/blog/.lore/c.lore": ruleCiting("blog-rule", `/${MONEY.file}`),
    }, [SHOP, WEB, BLOG, GONE]);
    const fromShop = ["--repo", governed("shop"), "--given", join(folder, "lore")];
    expect(await lore(["review", "shop-rule", ...fromShop])).toEqual({ code: 0, out: "reviewed shop-rule (1 source)\n", err: "" });
    const afterShop = writeReviews([BLOG, GONE, record("shop-rule", MONEY, DOC, TODAY), WEB]);
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(afterShop);
    for (const kept of [BLOG, GONE, WEB]) expect(linesOf(lockOf(folder, "lore/lore-reviews.lock"))).toContain(JSON.stringify(kept));
    expect(await lore(["review", "--prune", ...fromShop])).toEqual({
      code: 0, out: "", err: notPruning(SHARED, "external:lore/blog/.loreconfig names another repository"),
    });
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(afterShop);

    const fromBlog = ["--repo", governed("blog"), "--given", join(folder, "lore")];
    expect(await lore(["review", "blog-rule", ...fromBlog])).toEqual({ code: 0, out: "reviewed blog-rule (1 source)\n", err: "" });
    const afterBlog = writeReviews([record("blog-rule", MONEY, DOC, TODAY), GONE, record("shop-rule", MONEY, DOC, TODAY), WEB]);
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(afterBlog);
    expect(await lore(["review", "--prune", ...fromBlog])).toEqual({
      code: 0, out: "", err: notPruning(SHARED, "external:lore/shop/.loreconfig names another repository"),
    });
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(afterBlog);
  });

  test("only part of a shared Lore root given: a review and --prune delete nothing, and --prune with the whole root does", async () => {
    const folder = team({
      "lore/web/.loreconfig": "repo: github.com/acme/shop\n",
      "lore/web/.lore/b.lore": ruleCiting("web-rule", `/${MONEY.file}`),
    }, [SHOP, WEB, GONE]);
    const root = governed("shop");
    const part = ["--repo", root, "--given", join(folder, "lore/shop")];
    expect(await lore(["review", "shop-rule", ...part])).toEqual({ code: 0, out: "reviewed shop-rule (1 source)\n", err: "" });
    const after = writeReviews([GONE, record("shop-rule", MONEY, DOC, TODAY), WEB]);
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(after);
    expect(await lore(["review", "--prune", ...part])).toEqual({
      code: 0, out: "", err: notPruning(SHARED, "the given folders hold only part of its Lore root"),
    });
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(after);
    expect(await lore(["review", "--prune", "--repo", root, "--given", join(folder, "lore")])).toEqual({
      code: 0, out: `pruned 1 record from ${SHARED}\n`, err: "",
    });
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(writeReviews([record("shop-rule", MONEY, DOC, TODAY), WEB]));
  });

  test("nested-repo below a directory marked for another repository: a review and --prune delete nothing", async () => {
    const dates = record("shop-dates", DATES);
    const folder = repoWith({
      "lore/.loreconfig": "root: true\n",
      "lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "lore/shop/.lore/a.lore": ruleCiting("shop-dates", `/${DATES.file}`, "Dates"),
      "lore/apps/web/.loreconfig": "repo: github.com/acme/shop\n",
      "lore/apps/web/.lore/b.lore": ruleCiting("web-rule", `/${MONEY.file}`),
      "lore/lore-reviews.lock": writeReviews([dates, WEB]),
    });
    commit(folder, { "lore/apps/.loreconfig": "repo: github.com/acme/blog\n" });
    const args = ["--repo", governed("shop"), "--given", join(folder, "lore")];
    const excluded = "lore: excluded nested-repo in external:lore/apps/web/.loreconfig line 1\n";
    expect(await lore(["review", "shop-dates", ...args])).toEqual({ code: 0, out: "reviewed shop-dates (1 source)\n", err: excluded });
    const after = writeReviews([record("shop-dates", DATES, DOC, TODAY), WEB]);
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(after);
    expect(await lore(["review", "--prune", ...args])).toEqual({
      code: 0, out: "", err: excluded + notPruning(SHARED, "external:lore/apps/.loreconfig names another repository"),
    });
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(after);
  });
  test("a Lore file in no directory marked for the shop under the Lore root: a review and --prune delete nothing", async () => {
    const TEAM = record("team-rule", MONEY);
    const folder = team({ "lore/own/.lore/t.lore": ruleCiting("team-rule", `/${MONEY.file}`) }, [SHOP, TEAM, GONE]);
    const args = ["--repo", governed("shop"), "--given", join(folder, "lore")];
    expect(await lore(["review", "shop-rule", ...args])).toEqual({ code: 0, out: "reviewed shop-rule (1 source)\n", err: "" });
    const after = writeReviews([GONE, record("shop-rule", MONEY, DOC, TODAY), TEAM]);
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(after);
    expect(await lore(["review", "--prune", ...args])).toEqual({
      code: 0, out: "", err: notPruning(SHARED, "external:lore/own/.lore/t.lore is in no directory marked for this repository"),
    });
    expect(lockOf(folder, "lore/lore-reviews.lock")).toBe(after);
  });

  test("the governed repo given as a folder reaches one lock file twice, so the run is refused and the file left as it was", async () => {
    const A = record("a-rule", MONEY);
    const B = record("b-rule", MONEY);
    const root = repoWith({
      "docs/checkout-review.md": DOC,
      "lore/.loreconfig": "root: true\n",
      "lore/a/.loreconfig": "repo: github.com/acme/shop\n",
      "lore/a/.lore/r.lore": ruleCiting("a-rule", `/${MONEY.file}`),
      "lore/b/.lore/r.lore": ruleCiting("b-rule", `/${MONEY.file}`),
      "lore/lore-reviews.lock": writeReviews([A, B, GONE]),
    });
    git(root, "remote", "add", "origin", "https://github.com/acme/shop.git");
    const lock = lockOf(root, "lore/lore-reviews.lock");
    const refused = "lore: lock file lore/lore-reviews.lock is also external:lore/lore-reviews.lock: the governed repo is also given as a folder\n";
    for (const run of [["a-rule", "b-rule"], ["--prune"]]) {
      const { code, out, err } = await lore(["review", ...run, "--repo", root, "--given", join(root, "lore")]);
      expect(code).toBe(2);
      expect(out).toBe("");
      expect(err).toEndWith(refused);
      expect(lockOf(root, "lore/lore-reviews.lock")).toBe(lock);
    }
    expect(await lore(["review", "b-rule", "--repo", root])).toMatchObject({ code: 0, out: "reviewed b-rule (1 source)\n" });
    expect(lockOf(root, "lore/lore-reviews.lock")).toBe(writeReviews([A, record("b-rule", MONEY, DOC, TODAY), GONE]));
  });
});

