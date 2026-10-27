import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "../src/main";

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
    expect(out).toBe("No Lore rules apply to this change. Some Lore entries were excluded; see the errors.\n");
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
    expect(err).toContain("past the limit");
    expect(err).not.toContain("    at ");
  });

  test("a pattern the regex engine refuses is an input error with a short message", async () => {
    const pattern = "(a|b)".repeat(200_000);
    const huge = `<rule id="huge" category="security">\n<when>\naddedMatches: ['${pattern}']\n</when>\nProse.\n</rule>\n`;
    const { root, diff } = project({ ".lore/huge.lore": huge });
    const { code, out, err } = await lore(["select", "--repo", root, "--diff", diff, "--format", "json"]);
    expect(code).toBe(2);
    expect(out).toBe("");
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
    ["a flag without its value", ["select", "--diff"], "--diff"],
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

describe("help and version", () => {
  test("--version prints 0.1.0", async () => {
    expect(await lore(["--version"])).toEqual({ code: 0, out: "0.1.0\n", err: "" });
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
