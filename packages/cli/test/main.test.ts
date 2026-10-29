import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main, run } from "../src/main";
import pkg from "../package.json";

const version = pkg.version;

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-main-")));
  made.push(dir);
  return dir;
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function repoWith(files: Record<string, string>): string {
  const root = tempDir();
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  write(root, files);
  git("add", ".");
  git("commit", "-q", "-m", "first");
  return root;
}

const RULE = '<rule id="no-usd" category="security" severity="blocking">\n<when>\naddedContains: ["USD"]\n</when>\nDo not hardcode USD.\n</rule>\n';
const DIFF = 'diff --git a/src/p.ts b/src/p.ts\n--- a/src/p.ts\n+++ b/src/p.ts\n@@ -1 +1,2 @@\n a\n+const c = "USD";\n';
const BROKEN = '<rule id="broken" src="README.md">\nProse.\n</rule>\n';

interface Ran { code: number; out: string; err: string }

async function lore(argv: string[], options: { stdin?: string; isTTY?: boolean } = {}): Promise<Ran> {
  let out = "";
  let err = "";
  const code = await run(argv, {
    stdin: async () => options.stdin ?? "",
    stdout: (text) => { out += text; },
    stderr: (text) => { err += text; },
    isTTY: options.isTTY ?? false,
  });
  return { code, out, err };
}

function project(extra: Record<string, string> = {}): { root: string; diff: string } {
  const root = repoWith({ ".lore/a.lore": RULE, ...extra });
  const diff = join(root, "change.diff");
  writeFileSync(diff, DIFF);
  return { root, diff };
}

describe("lore select", () => {
  test("prints the selection as JSON for a diff file", async () => {
    const { root, diff } = project();
    const { code, out, err } = await lore(["select", "--repo", root, "--diff", diff, "--format", "json", "--capabilities", "regex"]);
    expect(err).toBe("");
    expect(code).toBe(0);
    const selection = JSON.parse(out);
    expect(selection.lore).toBe("1");
    expect(selection.rules[0]).toMatchObject({
      id: "no-usd", severity: "blocking", category: "security", hits: [{ file: "src/p.ts", line: 2, text: 'const c = "USD";' }],
    });
    expect(selection.change).toEqual([{ kind: "M", path: "src/p.ts", oldPath: null, added: [2] }]);
  });

  test("--diff - reads the diff from stdin", async () => {
    const { root } = project();
    const { code, out } = await lore(["select", "--repo", root, "--diff", "-", "--format", "json"], { stdin: DIFF });
    expect(code).toBe(0);
    expect(JSON.parse(out).rules.map((rule: { id: string }) => rule.id)).toEqual(["no-usd"]);
  });

  test("an empty diff selects nothing and exits 0", async () => {
    const { root } = project();
    const { code, out } = await lore(["select", "--repo", root, "--diff", "-", "--format", "json"], { stdin: "" });
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ rules: [], context: [], change: [] });
  });

  test("the format defaults to JSON when stdout is not a terminal and to text when it is", async () => {
    const { root, diff } = project();
    const piped = await lore(["select", "--repo", root, "--diff", diff]);
    expect(JSON.parse(piped.out).lore).toBe("1");
    const terminal = await lore(["select", "--repo", root, "--diff", diff], { isTTY: true });
    expect(terminal.out.startsWith("# Lore rules for this change\n")).toBe(true);
    expect(terminal.out).toContain("## Rule `no-usd` (blocking, security)");
  });

  test("--strict exits 1 when entries are excluded, and without it the error is in excluded", async () => {
    const { root, diff } = project({ ".lore/bad.lore": BROKEN });
    const strict = await lore(["select", "--repo", root, "--diff", diff, "--format", "json", "--strict"]);
    expect(strict.code).toBe(1);
    expect(JSON.parse(strict.out).excluded).toHaveLength(1);
    const lax = await lore(["select", "--repo", root, "--diff", diff, "--format", "json"]);
    expect(lax.code).toBe(0);
    expect(JSON.parse(lax.out).excluded[0]).toMatchObject({ name: "unknown-attribute", entry: "broken" });
  });

  test("text output writes each excluded entry to stderr, one line each, and keeps stdout to the prompt", async () => {
    const { root, diff } = project({ ".lore/bad.lore": BROKEN });
    const { code, out, err } = await lore(["select", "--repo", root, "--diff", diff, "--format", "text"]);
    expect(code).toBe(0);
    expect(err).toBe("lore: excluded unknown-attribute in .lore/bad.lore line 1 (entry broken)\n");
    expect(out).toContain("## Rule `no-usd`");
    expect(out).not.toContain("broken");
    const json = await lore(["select", "--repo", root, "--diff", diff, "--format", "json"]);
    expect(json.err).toBe("");
  });

  test("text output never says no rules apply without saying entries were excluded", async () => {
    const root = repoWith({ ".lore/bad.lore": BROKEN });
    const diff = join(root, "change.diff");
    writeFileSync(diff, DIFF);
    const { code, out, err } = await lore(["select", "--repo", root, "--diff", diff, "--format", "text"]);
    expect(code).toBe(0);
    expect(out).toBe("No Lore rules apply to this change. Some Lore entries were excluded; see the excluded lines on stderr.\n");
    expect(err).toContain("lore: excluded unknown-attribute");
  });

  test("a file-relative src in a loose folder resolves inside that folder and is read", async () => {
    const folder = tempDir();
    write(folder, {
      ".loreconfig": "lore: 1\nrepo: github.com/acme/shop\n",
      ".lore/a.lore": '<context id="guide" src="./../docs/guide.md">\nRead the guide.\n</context>\n',
      "docs/guide.md": "Use formatMoney.\n",
    });
    const { code, out, err } = await lore(
      ["select", "--no-repo", "--remote", "github.com/acme/shop", "--given", folder, "--diff", "-", "--format", "json"],
      { stdin: DIFF },
    );
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(out).context).toEqual([
      { id: "guide", file: "loose:.lore/a.lore", summary: "Read the guide.", prose: "Read the guide.", src: "loose:docs/guide.md", srcText: "Use formatMoney.\n" },
    ]);
  });

  test("a regex nested past the group limit is an input error with a short message", async () => {
    const pattern = `${"(".repeat(1500)}a${")".repeat(1500)}`;
    const deep = `<rule id="deep" category="security">\n<when>\naddedMatches: ['${pattern}']\n</when>\nProse.\n</rule>\n`;
    const { root, diff } = project({ ".lore/deep.lore": deep });
    const { code, out, err } = await lore(["select", "--repo", root, "--diff", diff, "--format", "json"]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err.length).toBeLessThan(300);
    expect(err).toStartWith("lore: .lore/deep.lore entry deep: groups nested 1500 deep, past the limit of 1000: ");
    expect(err).not.toContain("    at ");
  });

  test("a pattern the regex engine refuses is an input error with a short message", async () => {
    const pattern = "(a|b)".repeat(200_000);
    const huge = `<rule id="huge" category="security">\n<when>\naddedMatches: ['${pattern}']\n</when>\nProse.\n</rule>\n`;
    const { root, diff } = project({ ".lore/huge.lore": huge });
    const { code, out, err } = await lore(["select", "--repo", root, "--diff", diff, "--format", "json"]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toStartWith("lore: .lore/huge.lore entry huge: ");
    expect(err.length).toBeLessThan(400);
  });

  test("an unreadable diff is an input error", async () => {
    const { root } = project();
    const { code, err } = await lore(["select", "--repo", root, "--diff", join(root, "missing.diff")]);
    expect(code).toBe(2);
    expect(err.trim().split("\n")).toHaveLength(1);
  });

  test("--no-repo reads rules from a loose given folder and never needs a repository", async () => {
    const folder = tempDir();
    write(folder, { ".loreconfig": "lore: 1\nrepo: github.com/acme/shop\n", ".lore/a.lore": RULE });
    const { code, out, err } = await lore(
      ["select", "--no-repo", "--remote", "https://github.com/acme/shop", "--given", folder, "--diff", "-", "--format", "json"],
      { stdin: DIFF },
    );
    expect(err).toBe("");
    expect(code).toBe(0);
    const selection = JSON.parse(out);
    expect(selection.rules.map((rule: { id: string }) => rule.id)).toEqual(["no-usd"]);
    expect(selection.warnings.map((warning: { name: string }) => warning.name)).toContain("untracked-given-folder");
  });

  test("--rules-ref reads the rules at that ref", async () => {
    const { root, diff } = project();
    const { code, out } = await lore(["select", "--repo", root, "--rules-ref", "HEAD", "--diff", diff, "--format", "json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out).rules.map((rule: { id: string }) => rule.id)).toEqual(["no-usd"]);
  });

  test("--repo outside a working copy is an input error", async () => {
    const { code, err } = await lore(["select", "--repo", tempDir(), "--diff", "-"], { stdin: DIFF });
    expect(code).toBe(2);
    expect(err).toContain("not in a git working copy");
  });

  describe("without --repo or --no-repo", () => {
    const start = process.cwd();
    const restore = () => process.chdir(start);

    test("the repository is the git root above the current directory", async () => {
      const { root } = project();
      process.chdir(root);
      try {
        const { code, out } = await lore(["select", "--diff", "-", "--format", "json"], { stdin: DIFF });
        expect(code).toBe(0);
        expect(JSON.parse(out).rules).toHaveLength(1);
      } finally {
        restore();
      }
    });

    test("without a git binary the message says how to run without git", async () => {
      const path = process.env.PATH;
      process.env.PATH = tempDir();
      try {
        const { code, err } = await lore(["select", "--diff", "-"], { stdin: DIFF });
        expect(code).toBe(2);
        expect(err).toBe("lore: git is not installed; pass --no-repo with --remote to run without it\n");
      } finally {
        process.env.PATH = path;
      }
    });

    test("the repository is resolved before stdin is read", async () => {
      process.chdir(tempDir());
      const io = {
        stdin: async (): Promise<string> => { throw new Error("stdin was read"); },
        stdout: () => {},
        stderr: (text: string) => { err += text; },
        isTTY: false,
      };
      let err = "";
      try {
        expect(await run(["select", "--diff", "-"], io)).toBe(2);
        expect(err).toBe("lore: no git working copy here: pass --repo or --no-repo\n");
        err = "";
        expect(await run(["select", "--no-repo", "--diff", "-"], io)).toBe(2);
        expect(err).toBe("lore: --no-repo needs --remote\n");
      } finally {
        restore();
      }
    });

    test("outside any repository it says to pass --repo or --no-repo", async () => {
      process.chdir(tempDir());
      try {
        const { code, err } = await lore(["select", "--diff", "-"], { stdin: DIFF });
        expect(code).toBe(2);
        expect(err).toContain("pass --repo or --no-repo");
      } finally {
        restore();
      }
    });
  });
});

const CONTEXT = (id: string) => `<context id="${id}" src="./../docs/guide.md">\nRead the guide.\n</context>\n`;
const GIVEN_CONFIG = { ".loreconfig": "lore: 1\nrepo: github.com/acme/shop\n" };

async function selectWith(given: string[]): Promise<{ code: number; selection: { context: { id: string; srcText: string | null }[]; warnings: unknown[] } }> {
  const args = ["select", "--no-repo", "--remote", "github.com/acme/shop", ...given.flatMap((dir) => ["--given", dir]), "--diff", "-", "--format", "json"];
  const { code, out } = await lore(args, { stdin: DIFF });
  return { code, selection: JSON.parse(out) };
}

describe("nested loose folders", () => {
  test("--given rules --given rules/team reads the inner folder's rules once, with no duplicate-id", async () => {
    const rules = tempDir();
    write(rules, { "team/.loreconfig": GIVEN_CONFIG[".loreconfig"], "team/.lore/a.lore": RULE });
    const args = ["select", "--no-repo", "--remote", "github.com/acme/shop", "--given", rules, "--given", join(rules, "team"), "--diff", "-", "--format", "json"];
    const { code, out } = await lore(args, { stdin: DIFF });
    expect(code).toBe(0);
    const selection = JSON.parse(out);
    expect(selection.excluded).toEqual([]);
    expect(selection.rules.map((rule: { id: string; file: string }) => [rule.id, rule.file])).toEqual([["no-usd", "loose:team/.lore/a.lore"]]);
  });
});

describe("src text from several given places", () => {
  test("two given repositories tracking the same src path each give their own context its own text", async () => {
    const first = repoWith({ "rules/.loreconfig": GIVEN_CONFIG[".loreconfig"], "rules/.lore/a.lore": CONTEXT("first-guide"), "rules/docs/guide.md": "first\n" });
    const second = repoWith({ "rules/.loreconfig": GIVEN_CONFIG[".loreconfig"], "rules/.lore/b.lore": CONTEXT("second-guide"), "rules/docs/guide.md": "second\n" });
    const { code, selection } = await selectWith([join(first, "rules"), join(second, "rules")]);
    expect(code).toBe(0);
    expect(selection.context.map(({ id, srcText }) => ({ id, srcText }))).toEqual([
      { id: "first-guide", srcText: "first\n" },
      { id: "second-guide", srcText: "second\n" },
    ]);
  });

  test("a src target the parser found but the command did not read is warned src-not-read at the context's line", async () => {
    const outside = tempDir();
    write(outside, { "secret.md": "host file\n" });
    const root = repoWith({ ".lore/a.lore": `${RULE}\n${CONTEXT("leak")}`, "docs/real.md": "real\n" });
    symlinkSync(join(outside, "secret.md"), join(root, "docs/guide.md"));
    execFileSync("git", ["add", "docs/guide.md"], { cwd: root });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "link"], { cwd: root, stdio: "ignore" });
    const { code, out } = await lore(["select", "--repo", root, "--diff", "-", "--format", "json"], { stdin: DIFF });
    expect(code).toBe(0);
    const selection = JSON.parse(out);
    expect(selection.context).toMatchObject([{ id: "leak", src: "docs/guide.md", srcText: null }]);
    expect(selection.warnings).toMatchObject([{ name: "src-not-read", file: ".lore/a.lore", entry: "leak", line: 8, range: { start: { line: 7 } } }]);
  });

  test("two loose folders holding the same src path each give their own context its own text", async () => {
    const first = tempDir();
    write(first, { ...GIVEN_CONFIG, ".lore/a.lore": CONTEXT("first-guide"), "docs/guide.md": "first\n" });
    const second = tempDir();
    write(second, { ...GIVEN_CONFIG, ".lore/b.lore": CONTEXT("second-guide"), "docs/guide.md": "second\n" });
    const { selection } = await selectWith([first, second]);
    expect(selection.context.map(({ id, srcText }) => ({ id, srcText }))).toEqual([
      { id: "first-guide", srcText: "first\n" },
      { id: "second-guide", srcText: "second\n" },
    ]);
  });
});

describe("lore-file-not-read", () => {
  const link = (root: string, path: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(join(root, "missing"), join(root, path));
  };
  const commit = (root: string): void => {
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "link"], { cwd: root, stdio: "ignore" });
  };
  const warningsFor = async (root: string): Promise<unknown[]> => {
    const { out } = await lore(["select", "--repo", root, "--diff", "-", "--format", "json"], { stdin: DIFF });
    return JSON.parse(out).warnings;
  };

  test("a broken Lore file the parser would read is warned", async () => {
    const root = repoWith({ ".lore/a.lore": RULE });
    link(root, ".lore/gone.lore");
    commit(root);
    expect(await warningsFor(root)).toEqual([{ name: "lore-file-not-read", file: ".lore/gone.lore", entry: null, line: 1 }]);
  });

  test("a broken Lore file under a repo-inside-repo subtree is not", async () => {
    const root = repoWith({ ".lore/a.lore": RULE, "sub/.loreconfig": "lore: 1\nrepo: github.com/acme/other\n" });
    link(root, "sub/.lore/gone.lore");
    commit(root);
    expect(await warningsFor(root)).toEqual([]);
  });

  test("a broken Lore file in a given folder with no tree marked for the governed repo is not", async () => {
    const other = repoWith({ "rules/.lore/a.lore": RULE });
    link(other, "rules/.lore/gone.lore");
    commit(other);
    const { selection } = await selectWith([join(other, "rules")]);
    expect(selection.warnings).toEqual([]);
  });
});

describe("usage errors", () => {
  const oneLine = (err: string) => expect(err.trim().split("\n")).toHaveLength(1);

  test.each([
    ["--no-repo without --remote", ["select", "--no-repo", "--diff", "-"], "--remote"],
    ["--rules-ref with --no-repo", ["select", "--no-repo", "--rules-ref", "main", "--remote", "github.com/acme/shop", "--diff", "-"], "--rules-ref"],
    ["--repo with --no-repo", ["select", "--no-repo", "--repo", ".", "--remote", "github.com/acme/shop", "--diff", "-"], "--repo"],
    ["--paths", ["select", "--paths", "x"], "not available yet"],
    ["--change", ["select", "--change", "x.json"], "not available yet"],
    ["--base", ["select", "--base", "main", "--diff", "-"], "not available yet"],
    ["--head", ["select", "--head", "main", "--diff", "-"], "not available yet"],
    ["no change input", ["select", "--repo", "."], "--diff"],
    ["two change inputs", ["select", "--diff", "a.diff", "--diff", "b.diff"], "--diff"],
    ["an unknown flag", ["select", "--bogus", "--diff", "-"], "--bogus"],
    ["a flag without its value", ["select", "--diff"], "--diff needs a value"],
    ["a value flag followed by another flag", ["select", "--diff", "--format", "json"], "--diff needs a value"],
    ["verdicts --selection followed by a flag", ["verdicts", "--selection", "--x"], "--selection needs a value"],
    ["a positional argument", ["select", "foo", "--diff", "x"], "unexpected argument: foo"],
    ["a bad format", ["select", "--diff", "-", "--format", "yaml"], "--format"],
    ["a bad capability", ["select", "--diff", "-", "--capabilities", "regex,magic"], "magic"],
    ["--strict with a value", ["select", "--diff", "-", "--strict=false"], "--strict"],
    ["--no-repo with a value", ["select", "--diff", "-", "--no-repo=yes"], "--no-repo"],
    ["an unknown command", ["frobnicate"], "frobnicate"],
    ["selection and verdicts both from stdin", ["verdicts", "--selection", "-"], "stdin can supply only one of the selection and the verdicts"],
    ["selection and an explicit - both from stdin", ["verdicts", "--selection=-", "-"], "stdin can supply only one of the selection and the verdicts"],
    ["no command", [], "command"],
  ])("%s exits 2 with a one-line message", async (_name, argv, mention) => {
    const { code, out, err } = await lore(argv);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain(mention);
    oneLine(err);
  });
});

describe("an internal error", () => {
  test("prints the stack and exits 70", async () => {
    let err = "";
    const code = await main(["verdicts", "--selection", "-", "x"], {
      stdin: async () => { throw new Error("boom"); },
      stdout: () => {},
      stderr: (text) => { err += text; },
      isTTY: false,
    });
    expect(code).toBe(70);
    expect(err).toStartWith("Error: boom\n    at ");
  });

  test("a usage error is still exit 2 through main", async () => {
    expect(await main(["frobnicate"], { stdin: async () => "", stdout: () => {}, stderr: () => {}, isTTY: false })).toBe(2);
  });
});

describe("help and version", () => {
  test("--version prints the package version", async () => {
    expect(await lore(["--version"])).toEqual({ code: 0, out: `${version}\n`, err: "" });
  });

  test("every option description starts in the same column", async () => {
    const { out } = await lore(["--help"]);
    const columns = out.split("\n").flatMap((line) => {
      const match = /^ {2}(--[\w-]+(?: \S+)?|<[^>]+>)( {2,})\S/.exec(line);
      return match === null ? [] : [2 + match[1]!.length + match[2]!.length];
    });
    expect(columns.length).toBeGreaterThan(8);
    expect(new Set(columns).size).toBe(1);
  });

  test("the exit codes are stated per command", async () => {
    const { out } = await lore(["--help"]);
    expect(out).toContain("lore select    0 the selection ran, 1 --strict was given and entries were excluded");
    expect(out).toContain("lore verdicts  0 the verdicts have no problems, 1 the verdicts have problems");
    expect(out).toContain("lore check     0 the check ran, 1 --strict was given and entries were excluded");
    expect(out).toContain("all            2 usage or input error, 70 internal error");
  });

  test("--help prints usage on stdout", async () => {
    const { code, out } = await lore(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("lore select");
    expect(out).toContain("lore verdicts");
    expect(out).toContain("--diff");
    expect(await lore(["select", "--help"])).toEqual({ code: 0, out, err: "" });
    expect(await lore(["verdicts", "--help"])).toEqual({ code: 0, out, err: "" });
  });
});

describe("lore check", () => {
  const start = process.cwd();
  const USD_FILE = 'const c = "USD";\n';
  const gitIn = (root: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "ignore" });
  const ids = (out: string): string[] => JSON.parse(out).rules.map((rule: { id: string }) => rule.id);

  test("checks uncommitted work, untracked files included", async () => {
    const root = repoWith({ ".lore/a.lore": RULE });
    write(root, { "src/p.ts": USD_FILE });
    const { code, out, err } = await lore(["check", "--repo", root, "--format", "json"]);
    expect(err).toBe("");
    expect(code).toBe(0);
    const selection = JSON.parse(out);
    expect(selection.rules[0].id).toBe("no-usd");
    expect(selection.rules[0].hits[0].file).toBe("src/p.ts");
  });

  test("checks one commit", async () => {
    const root = repoWith({ ".lore/a.lore": RULE });
    write(root, { "src/p.ts": USD_FILE });
    gitIn(root, "add", ".");
    gitIn(root, "commit", "-q", "-m", "usd");
    expect(ids((await lore(["check", "HEAD", "--repo", root, "--format", "json"])).out)).toEqual(["no-usd"]);
    expect(ids((await lore(["check", "--repo", root, "--format", "json"])).out)).toEqual([]);
  });

  test("text output uses the author preamble", async () => {
    const root = repoWith({ ".lore/a.lore": RULE });
    write(root, { "src/p.ts": USD_FILE });
    const { out } = await lore(["check", "--repo", root], { isTTY: true });
    expect(out).toStartWith("# Lore rules for this change\n\nThese rules apply to your change.");
  });

  test("an untracked rule applies to uncommitted work", async () => {
    const root = repoWith({ "README.md": "x\n" });
    write(root, { ".lore/a.lore": RULE, "src/p.ts": USD_FILE });
    expect(ids((await lore(["check", "--repo", root, "--format", "json"])).out)).toEqual(["no-usd"]);
  });

  test("exits 0 when a rule has flagged lines", async () => {
    const root = repoWith({ ".lore/a.lore": RULE });
    write(root, { "src/p.ts": USD_FILE });
    const { code, out } = await lore(["check", "--repo", root, "--format", "json"]);
    expect(JSON.parse(out).rules[0].hits).toHaveLength(1);
    expect(code).toBe(0);
  });

  test("--strict exits 1 when entries are excluded", async () => {
    const root = repoWith({ ".lore/a.lore": RULE, ".lore/bad.lore": BROKEN });
    expect((await lore(["check", "--repo", root, "--format", "json"])).code).toBe(0);
    expect((await lore(["check", "--repo", root, "--format", "json", "--strict"])).code).toBe(1);
  });

  test("--diff is a usage error", async () => {
    const { code, err } = await lore(["check", "--diff", "-"]);
    expect(code).toBe(2);
    expect(err).toContain("lore check builds the change itself; use lore select --diff for a diff");
  });

  test("two commits are a usage error", async () => {
    const { code, err } = await lore(["check", "a", "b"]);
    expect(code).toBe(2);
    expect(err).toContain("at most one commit");
  });

  test("an unknown commit is an input error", async () => {
    const root = repoWith({ ".lore/a.lore": RULE });
    const { code, err } = await lore(["check", "nope", "--repo", root]);
    expect(code).toBe(2);
    expect(err).toBe("lore: not a commit: nope\n");
  });

  test("--no-repo reads rules only from --given and the change from the working copy", async () => {
    const root = repoWith({ ".lore/own.lore": RULE.replace("no-usd", "own-rule") });
    write(root, { "src/p.ts": USD_FILE });
    const folder = tempDir();
    write(folder, { ".loreconfig": "lore: 1\nrepo: github.com/acme/shop\n", ".lore/g.lore": RULE.replace("no-usd", "given-rule") });
    const { code, out, err } = await lore(["check", "--repo", root, "--no-repo", "--given", folder, "--remote", "github.com/acme/shop", "--format", "json"]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(ids(out)).toEqual(["given-rule"]);
  });

  test("outside a working copy it is an input error", async () => {
    process.chdir(tempDir());
    try {
      const { code, err } = await lore(["check", "--format", "json"]);
      expect(code).toBe(2);
      expect(err).toBe("lore: lore check needs a git working copy: run it inside one or pass --repo\n");
    } finally {
      process.chdir(start);
    }
  });

  test("--repo outside a working copy is an input error", async () => {
    const { code, err } = await lore(["check", "--repo", tempDir()]);
    expect(code).toBe(2);
    expect(err).toContain("lore check needs a git working copy");
  });

  test("without a git binary the message says check needs it", async () => {
    const path = process.env.PATH;
    process.env.PATH = tempDir();
    try {
      const { code, err } = await lore(["check"]);
      expect(code).toBe(2);
      expect(err).toBe("lore: git is not installed; lore check needs it\n");
    } finally {
      process.env.PATH = path;
    }
  });

  test("from a subdirectory, untracked files elsewhere in the repo are included", async () => {
    const scoped = '<rule id="lib-usd" category="security" severity="blocking">\n<scope>\nfiles: ["lib/**"]\n</scope>\n<when>\naddedContains: ["USD"]\n</when>\nDo not hardcode USD.\n</rule>\n';
    const root = repoWith({ ".lore/a.lore": scoped, "src/sub/keep.ts": "a\n" });
    write(root, { "lib/q.ts": USD_FILE });
    process.chdir(join(root, "src/sub"));
    try {
      const { code, out } = await lore(["check", "--format", "json"]);
      expect(code).toBe(0);
      const selection = JSON.parse(out);
      expect(selection.rules[0].id).toBe("lib-usd");
      expect(selection.rules[0].hits[0].file).toBe("lib/q.ts");
    } finally {
      process.chdir(start);
    }
  });

  test("--help lists lore check", async () => {
    const { out } = await lore(["--help"]);
    expect(out).toContain("lore check [<commit>] [rules] [options]");
    expect(await lore(["check", "--help"])).toEqual({ code: 0, out, err: "" });
  });
});

describe("lore verdicts", () => {
  type Files = (name: string) => string;
  const selection = {
    lore: "1",
    rules: [{ id: "a" }],
    context: [],
    change: [{ kind: "M", path: "src/p.ts", oldPath: null, added: [2] }],
  };
  const files = (): Files => {
    const root = tempDir();
    write(root, {
      "selection.json": JSON.stringify(selection),
      "good.json": JSON.stringify({ lore: "1", verdicts: [{ rule: "a", verdict: "pass" }] }),
      "bad.json": JSON.stringify({ lore: "1", verdicts: [] }),
      "text.txt": "not json",
      "shape.json": JSON.stringify({ lore: "1" }),
    });
    return (name) => join(root, name);
  };

  test("exits 0 and prints no problems for a complete set from stdin", async () => {
    const file = files();
    const stdin = JSON.stringify({ lore: "1", verdicts: [{ rule: "a", verdict: "pass" }] });
    expect(await lore(["verdicts", "--selection", file("selection.json")], { stdin })).toEqual({
      code: 0, out: '{\n  "problems": []\n}\n', err: "",
    });
    expect((await lore(["verdicts", "--selection", file("selection.json"), file("good.json")])).code).toBe(0);
  });

  test("exits 1 and lists the problems", async () => {
    const file = files();
    const { code, out } = await lore(["verdicts", "--selection", file("selection.json"), file("bad.json")]);
    expect(code).toBe(1);
    expect(JSON.parse(out).problems).toEqual([{ name: "missing-verdict", rule: "a", detail: expect.any(String) }]);
  });

  test.each([
    ["an unreadable selection", (f: Files) => ["--selection", f("nope.json"), f("good.json")], "cannot read selection"],
    ["a selection that is not JSON", (f: Files) => ["--selection", f("text.txt"), f("good.json")], "selection is not JSON"],
    ["a selection of the wrong shape", (f: Files) => ["--selection", f("shape.json"), f("good.json")], "not a lore select selection"],
    ["an unreadable verdicts file", (f: Files) => ["--selection", f("selection.json"), f("nope.json")], "cannot read verdicts"],
    ["verdicts that are not JSON", (f: Files) => ["--selection", f("selection.json"), f("text.txt")], "verdicts is not JSON"],
  ])("%s exits 2 with a one-line message", async (_name, args, mention) => {
    const { code, out, err } = await lore(["verdicts", ...args(files())]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain(mention);
    expect(err.trim().split("\n")).toHaveLength(1);
  });

  test("stdin that is not JSON exits 2", async () => {
    const { code, err } = await lore(["verdicts", "--selection", files()("selection.json")], { stdin: "nope" });
    expect(code).toBe(2);
    expect(err).toContain("verdicts is not JSON: stdin");
  });
});
