import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { InputError } from "../src/errors";
import { readFileAt, trackedPaths } from "../src/git";
import { buildInput } from "../src/input";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-cli-")));
  made.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "ignore" });
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function repoWith(files: Record<string, string>): string {
  const root = tempDir();
  git(root, "init", "-q", "-b", "main");
  write(root, files);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  return root;
}

const rule = (id: string) => `# ${id}\n`;

describe("buildInput", () => {
  test("lists tracked paths, reads only Lore files, and leaves untracked files out", async () => {
    const root = repoWith({ ".lore/a.lore": rule("a"), "src/x.ts": "export {};\n" });
    write(root, { ".lore/b.lore": rule("b") });
    const { input } = await buildInput({ repo: root, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    expect(input.rules).toBeUndefined();
    expect(input.repo).toEqual([
      { path: ".lore/a.lore", content: rule("a") },
      { path: "src/x.ts", content: "" },
    ]);
  });

  test("reads a .loreconfig outside a .lore folder and nothing else", async () => {
    const root = repoWith({ ".loreconfig": "root: true\n", "docs/notes.lore": "ignored\n", "README.md": "hi\n" });
    const { input } = await buildInput({ repo: root, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    const contents = Object.fromEntries(input.repo.map(({ path, content }) => [path, content]));
    expect(contents).toEqual({ ".loreconfig": "root: true\n", "docs/notes.lore": "", "README.md": "" });
  });

  test("skips a tracked file deleted from the working tree", async () => {
    const root = repoWith({ ".lore/a.lore": rule("a"), ".lore/gone.lore": rule("gone") });
    rmSync(join(root, ".lore/gone.lore"));
    const { input } = await buildInput({ repo: root, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    expect(input.repo.map(({ path }) => path)).toEqual([".lore/a.lore"]);
  });

  test("with a rules ref, the ref's files are the rules and the change side is empty", async () => {
    const root = repoWith({ ".lore/a.lore": rule("a") });
    write(root, { ".lore/new.lore": rule("new") });
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "second");
    const { input } = await buildInput({ repo: root, rulesRef: "HEAD~1", given: [], remotes: ["github.com/acme/shop"] });
    expect(input.repo).toEqual([]);
    expect(input.rules).toEqual([{ path: ".lore/a.lore", content: rule("a") }]);
  });

  test("a ref git cannot resolve is an input error naming the command", async () => {
    const root = repoWith({ ".lore/a.lore": rule("a") });
    const attempt = buildInput({ repo: root, rulesRef: "nope", given: [], remotes: ["github.com/acme/shop"] });
    await expect(attempt).rejects.toThrow(InputError);
    await expect(attempt).rejects.toThrow(/^git ls-tree -r -z --name-only nope failed: .+/);
    await expect(attempt).rejects.not.toThrow(/\n/);
  });

  test("a tracked given folder carries its repository, its path from that root and its repository's tracked files", async () => {
    const other = repoWith({
      ".loreconfig": "repo: github.com/acme/shop\n",
      "rules/.lore/shared.lore": rule("shared"),
      "rules/README.md": "hi\n",
    });
    const root = repoWith({ ".lore/a.lore": rule("a") });
    const { input } = await buildInput({ repo: root, rulesRef: null, given: [join(other, "rules")], remotes: ["github.com/acme/shop"] });
    expect(input.given).toEqual([
      {
        folder: "rules",
        repository: other,
        files: [
          { path: ".loreconfig", content: "repo: github.com/acme/shop\n" },
          { path: "rules/.lore/shared.lore", content: rule("shared") },
          { path: "rules/README.md", content: "" },
        ],
      },
    ]);
  });

  test("a given folder spelled with a trailing slash, relatively or absolutely builds equal inputs", async () => {
    const other = repoWith({ "rules/.lore/shared.lore": rule("shared") });
    const root = repoWith({ ".lore/a.lore": rule("a") });
    const absolute = join(other, "rules");
    const spellings = [absolute, `${absolute}/`, relative(process.cwd(), absolute)];
    const inputs = await Promise.all(
      spellings.map(async (spelling) => (await buildInput({ repo: root, rulesRef: null, given: [spelling], remotes: ["github.com/acme/shop"] })).input),
    );
    expect(inputs[1]).toEqual(inputs[0]);
    expect(inputs[2]).toEqual(inputs[0]);
    expect(inputs[0]!.given[0]!.folder).toBe("rules");
  });

  test("a given folder in no repository is loose and skips dot-folders other than .lore", async () => {
    const loose = tempDir();
    write(loose, { ".lore/x.lore": rule("x"), "docs/guide.md": "g\n", ".cache/.lore/y.lore": rule("y") });
    const root = repoWith({ ".lore/a.lore": rule("a") });
    const { input } = await buildInput({ repo: root, rulesRef: null, given: [loose], remotes: ["github.com/acme/shop"] });
    expect(input.given).toEqual([
      {
        folder: "",
        loose: true,
        files: [
          { path: ".lore/x.lore", content: rule("x") },
          { path: "docs/guide.md", content: "" },
        ],
      },
    ]);
  });

  test("a given folder inside a working copy that tracks none of its files is an input error", async () => {
    const other = repoWith({ ".gitignore": "node_modules/\n", "README.md": "hi\n" });
    write(other, { "node_modules/@acme/rules/.lore/a.lore": rule("a") });
    const typed = join(other, "node_modules/@acme/rules");
    const attempt = buildInput({ repo: null, rulesRef: null, given: [typed], remotes: ["github.com/acme/shop"] });
    await expect(attempt).rejects.toThrow(InputError);
    await expect(attempt).rejects.toThrow(`given folder ${typed} is inside the working copy at ${other}, but git tracks none of its files`);
  });

  test("the same given folder named twice is read once", async () => {
    const loose = tempDir();
    write(loose, { ".lore/x.lore": rule("x") });
    const other = repoWith({ "rules/.lore/shared.lore": rule("shared") });
    const given = [loose, `${loose}/`, join(other, "rules"), `${join(other, "rules")}/`];
    const { input } = await buildInput({ repo: null, rulesRef: null, given, remotes: ["github.com/acme/shop"] });
    expect(input.given.map((folder) => folder.folder)).toEqual(["", "rules"]);
  });

  test("a loose folder inside another given loose folder is collected through the outer one only", async () => {
    const outer = tempDir();
    write(outer, { ".lore/a.lore": rule("a"), "team/.lore/b.lore": rule("b"), ".cache/team/.lore/c.lore": rule("c") });
    const inner = join(outer, "team");
    const hidden = join(outer, ".cache/team");
    for (const given of [[outer, inner, hidden], [hidden, inner, outer]]) {
      const { input } = await buildInput({ repo: null, rulesRef: null, given, remotes: ["github.com/acme/shop"] });
      expect(input.given.map(({ files }) => files.map(({ path }) => path))).toEqual(
        given[0] === outer ? [[".lore/a.lore", "team/.lore/b.lore"], [".lore/c.lore"]] : [[".lore/c.lore"], [".lore/a.lore", "team/.lore/b.lore"]],
      );
    }
  });

  test("a missing given folder is an input error", async () => {
    const root = repoWith({ ".lore/a.lore": rule("a") });
    await expect(buildInput({ repo: root, rulesRef: null, given: [join(root, "absent")], remotes: ["github.com/acme/shop"] })).rejects.toThrow(
      InputError,
    );
  });

  test("no repo and no remote is an input error", async () => {
    const attempt = buildInput({ repo: null, rulesRef: null, given: [], remotes: [] });
    await expect(attempt).rejects.toThrow(InputError);
    await expect(attempt).rejects.toThrow("--no-repo needs --remote");
  });

  test("no repo with a remote has an empty change side and no rules", async () => {
    const { input } = await buildInput({ repo: null, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    expect(input).toEqual({ repo: [], given: [], remotes: ["github.com/acme/shop"] });
  });

  test("without --remote, the repo's fetch URLs are the remotes", async () => {
    const root = repoWith({ ".lore/a.lore": rule("a") });
    git(root, "remote", "add", "origin", "https://github.com/acme/shop.git");
    const { input } = await buildInput({ repo: root, rulesRef: null, given: [], remotes: [] });
    expect(input.remotes).toEqual(["https://github.com/acme/shop.git"]);
  });
});

describe("readSrc", () => {
  test("reads a plain path from the working tree, or from the rules ref when given", async () => {
    const root = repoWith({ "docs/a.md": "old\n" });
    write(root, { "docs/a.md": "new\n" });
    const sources = { repo: root, given: [], remotes: ["github.com/acme/shop"] };
    expect((await buildInput({ ...sources, rulesRef: null })).readSrc("docs/a.md")).toBe("new\n");
    expect((await buildInput({ ...sources, rulesRef: "HEAD" })).readSrc("docs/a.md")).toBe("old\n");
  });

  test("reads external: from a given folder's repository and loose: from the loose folder", async () => {
    const other = repoWith({ "rules/.lore/shared.lore": rule("shared"), "docs/guide.md": "external\n" });
    const loose = tempDir();
    write(loose, { "docs/guide.md": "loose\n" });
    const root = repoWith({ ".lore/a.lore": rule("a") });
    const { readSrc } = await buildInput({ repo: root, rulesRef: null, given: [join(other, "rules"), loose], remotes: ["github.com/acme/shop"] });
    expect(readSrc("external:docs/guide.md")).toBe("external\n");
    expect(readSrc("loose:docs/guide.md")).toBe("loose\n");
  });

  test("is null when unreadable, outside the folder, or with --no-repo", async () => {
    const root = repoWith({ "docs/a.md": "a\n" });
    const withRepo = await buildInput({ repo: root, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    expect(withRepo.readSrc("docs/missing.md")).toBeNull();
    expect(withRepo.readSrc("../outside.md")).toBeNull();
    expect(withRepo.readSrc("external:docs/a.md")).toBeNull();
    const noRepo = await buildInput({ repo: null, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    expect(noRepo.readSrc("docs/a.md")).toBeNull();
  });
});

describe("readSrc with several given places", () => {
  test("external: reads the repository that tracks the path, not one with an untracked copy", async () => {
    const first = repoWith({ "rules/.lore/a.lore": rule("a") });
    write(first, { "docs/guide.md": "untracked\n" });
    const second = repoWith({ "rules/.lore/b.lore": rule("b"), "docs/guide.md": "tracked\n" });
    const root = repoWith({ ".lore/r.lore": rule("r") });
    const { readSrc } = await buildInput({ repo: root, rulesRef: null, given: [join(first, "rules"), join(second, "rules")], remotes: ["github.com/acme/shop"] });
    expect(readSrc("external:docs/guide.md")).toBe("tracked\n");
  });

  test("external: is null when more than one given repository tracks the path", async () => {
    const first = repoWith({ "rules/.lore/a.lore": rule("a"), "docs/guide.md": "first\n" });
    const second = repoWith({ "rules/.lore/b.lore": rule("b"), "docs/guide.md": "second\n" });
    const root = repoWith({ ".lore/r.lore": rule("r") });
    const { readSrc } = await buildInput({ repo: root, rulesRef: null, given: [join(first, "rules"), join(second, "rules")], remotes: ["github.com/acme/shop"] });
    expect(readSrc("external:docs/guide.md")).toBeNull();
  });

  test("with the entry's given folder, an ambiguous path reads from exactly that place", async () => {
    const first = repoWith({ "rules/.lore/a.lore": rule("a"), "docs/guide.md": "first\n" });
    const second = repoWith({ "rules/.lore/b.lore": rule("b"), "docs/guide.md": "second\n" });
    const loose = tempDir();
    write(loose, { "docs/guide.md": "loose\n" });
    const other = tempDir();
    write(other, { "docs/guide.md": "other\n" });
    const given = [join(first, "rules"), join(second, "rules"), loose, other];
    const { readSrc } = await buildInput({ repo: null, rulesRef: null, given, remotes: ["github.com/acme/shop"] });
    expect(readSrc("external:docs/guide.md", 0)).toBe("first\n");
    expect(readSrc("external:docs/guide.md", 1)).toBe("second\n");
    expect(readSrc("loose:docs/guide.md", 2)).toBe("loose\n");
    expect(readSrc("loose:docs/guide.md", 3)).toBe("other\n");
    expect(readSrc("loose:docs/guide.md", 0)).toBeNull();
    expect(readSrc("external:docs/guide.md", 2)).toBeNull();
    expect(readSrc("external:docs/guide.md", 9)).toBeNull();
  });

  test("loose: is null when more than one loose folder holds the path", async () => {
    const first = tempDir();
    write(first, { "docs/guide.md": "first\n" });
    const second = tempDir();
    write(second, { "docs/guide.md": "second\n" });
    const { readSrc } = await buildInput({ repo: null, rulesRef: null, given: [first, second], remotes: ["github.com/acme/shop"] });
    expect(readSrc("loose:docs/guide.md")).toBeNull();
  });

  test("loose: reads the folder whose walked files hold the path", async () => {
    const first = tempDir();
    write(first, { ".cache/docs/guide.md": "skipped\n", "x.md": "x\n" });
    const second = tempDir();
    write(second, { "docs/guide.md": "walked\n" });
    const root = repoWith({ ".lore/r.lore": rule("r") });
    const { readSrc } = await buildInput({ repo: root, rulesRef: null, given: [first, second], remotes: ["github.com/acme/shop"] });
    expect(readSrc("loose:docs/guide.md")).toBe("walked\n");
  });
});

describe("reads that leave the folder or fail", () => {
  test("a tracked symlink pointing outside the repo is not read as a src target or as a Lore file", async () => {
    const outside = tempDir();
    write(outside, { "secret.txt": "host file\n", "evil.lore": rule("evil") });
    const root = tempDir();
    git(root, "init", "-q", "-b", "main");
    write(root, { ".lore/a.lore": rule("a") });
    mkdirSync(join(root, "src"));
    symlinkSync(join(outside, "secret.txt"), join(root, "src/leak"));
    symlinkSync(join(outside, "evil.lore"), join(root, ".lore/evil.lore"));
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    const { input, readSrc } = await buildInput({ repo: root, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    expect(readSrc("src/leak")).toBeNull();
    expect(input.repo.map(({ path }) => path)).toEqual([".lore/a.lore", "src/leak"]);
  });

  test("an untracked src target is not read from the working tree", async () => {
    const root = repoWith({ ".gitignore": ".npmrc\n", ".lore/a.lore": rule("a") });
    write(root, { ".npmrc": "token\n", "docs/new.md": "untracked\n" });
    const { readSrc } = await buildInput({ repo: root, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    expect(readSrc(".npmrc")).toBeNull();
    expect(readSrc("docs/new.md")).toBeNull();
  });

  test("a tracked in-repo symlink is read only when its target is tracked", async () => {
    const root = tempDir();
    git(root, "init", "-q", "-b", "main");
    write(root, { ".gitignore": ".npmrc\nnotes/\n", ".npmrc": "token\n", "docs/real.md": "real\n", "notes/x.lore": rule("x"), ".lore/a.lore": rule("a") });
    symlinkSync("../.npmrc", join(root, "docs/guide.md"));
    symlinkSync("real.md", join(root, "docs/alias.md"));
    symlinkSync("../notes/x.lore", join(root, ".lore/x.lore"));
    symlinkSync("a.lore", join(root, ".lore/same.lore"));
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    const { input, readSrc } = await buildInput({ repo: root, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    expect(readSrc("docs/guide.md")).toBeNull();
    expect(readSrc("docs/alias.md")).toBe("real\n");
    const lore = input.repo.filter(({ path }) => path.startsWith(".lore/"));
    expect(lore).toEqual([
      { path: ".lore/a.lore", content: rule("a") },
      { path: ".lore/same.lore", content: rule("a") },
    ]);
  });

  test("a given repository's symlink to an untracked file is not read", async () => {
    const other = tempDir();
    git(other, "init", "-q", "-b", "main");
    write(other, { ".gitignore": ".npmrc\n", ".npmrc": "token\n", "rules/.lore/a.lore": rule("a") });
    mkdirSync(join(other, "docs"));
    symlinkSync("../.npmrc", join(other, "docs/guide.md"));
    git(other, "add", ".");
    git(other, "commit", "-q", "-m", "first");
    write(other, { "docs/loose.md": "untracked\n" });
    const root = repoWith({ ".lore/r.lore": rule("r") });
    const { readSrc } = await buildInput({ repo: root, rulesRef: null, given: [join(other, "rules")], remotes: ["github.com/acme/shop"] });
    expect(readSrc("external:docs/guide.md")).toBeNull();
    expect(readSrc("external:docs/loose.md")).toBeNull();
  });

  test("a dangling tracked Lore symlink is left out instead of throwing", async () => {
    const root = tempDir();
    git(root, "init", "-q", "-b", "main");
    write(root, { ".lore/a.lore": rule("a") });
    symlinkSync(join(root, "missing.lore"), join(root, ".lore/dangling.lore"));
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    const { input } = await buildInput({ repo: root, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    expect(input.repo.map(({ path }) => path)).toEqual([".lore/a.lore"]);
  });

  test("a tracked Lore or .loreconfig file the command cannot read is warned lore-file-not-read", async () => {
    const outside = tempDir();
    write(outside, { "evil.lore": rule("evil") });
    const root = tempDir();
    git(root, "init", "-q", "-b", "main");
    write(root, { ".lore/a.lore": rule("a"), ".lore/skipped.lore": rule("skipped"), "src/x.ts": "export {};\n" });
    symlinkSync(join(outside, "evil.lore"), join(root, ".lore/evil.lore"));
    symlinkSync(join(root, "missing"), join(root, ".loreconfig"));
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "first");
    git(root, "update-index", "--skip-worktree", ".lore/skipped.lore");
    rmSync(join(root, ".lore/skipped.lore"));
    const { warnings } = await buildInput({ repo: root, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    expect(warnings).toEqual([
      { name: "lore-file-not-read", file: ".lore/evil.lore", entry: null, line: 1 },
      { name: "lore-file-not-read", file: ".lore/skipped.lore", entry: null, line: 1 },
      { name: "lore-file-not-read", file: ".loreconfig", entry: null, line: 1 },
    ]);
  });

  test("a tracked Lore path that is a directory is warned lore-file-not-read", async () => {
    const root = repoWith({ ".lore/a.lore": rule("a") });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    git(root, "update-index", "--add", "--cacheinfo", `160000,${head},.lore/sub.lore`);
    mkdirSync(join(root, ".lore/sub.lore"));
    const { warnings } = await buildInput({ repo: root, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] });
    expect(warnings).toEqual([{ name: "lore-file-not-read", file: ".lore/sub.lore", entry: null, line: 1 }]);
  });

  test("a given repository warns only for unread files its given folders reach, and a loose folder for any", async () => {
    const other = tempDir();
    git(other, "init", "-q", "-b", "main");
    write(other, { "rules/.lore/a.lore": rule("a") });
    symlinkSync(join(other, "missing"), join(other, ".loreconfig"));
    symlinkSync(join(other, "missing"), join(other, "rules/.lore/gone.lore"));
    mkdirSync(join(other, "elsewhere/.lore"), { recursive: true });
    symlinkSync(join(other, "missing"), join(other, "elsewhere/.lore/gone.lore"));
    git(other, "add", ".");
    git(other, "commit", "-q", "-m", "first");
    const loose = tempDir();
    write(loose, { ".lore/locked.lore": rule("locked") });
    chmodSync(join(loose, ".lore/locked.lore"), 0o000);
    try {
      const { warnings } = await buildInput({ repo: null, rulesRef: null, given: [join(other, "rules"), loose], remotes: ["github.com/acme/shop"] });
      expect(warnings).toEqual([
        { name: "lore-file-not-read", file: "external:.loreconfig", entry: null, line: 1 },
        { name: "lore-file-not-read", file: "external:rules/.lore/gone.lore", entry: null, line: 1 },
        { name: "lore-file-not-read", file: "loose:.lore/locked.lore", entry: null, line: 1 },
      ]);
    } finally {
      chmodSync(join(loose, ".lore/locked.lore"), 0o644);
    }
  });

  test("a path conflicted in a merge is listed once", () => {
    const root = repoWith({ "a.txt": "base\n" });
    git(root, "checkout", "-q", "-b", "side");
    write(root, { "a.txt": "side\n" });
    git(root, "commit", "-q", "-am", "side");
    git(root, "checkout", "-q", "main");
    write(root, { "a.txt": "main\n" });
    git(root, "commit", "-q", "-am", "main");
    expect(() => git(root, "merge", "-q", "side")).toThrow();
    expect(trackedPaths(root, null)).toEqual(["a.txt"]);
  });

  test("a git failure other than no working copy is an input error naming git's reason", async () => {
    const broken = tempDir();
    write(broken, { ".git": "garbage\n", ".lore/x.lore": rule("x") });
    const attempt = buildInput({ repo: null, rulesRef: null, given: [broken], remotes: ["github.com/acme/shop"] });
    await expect(attempt).rejects.toThrow(InputError);
    await expect(attempt).rejects.toThrow(/invalid gitfile format/);
    await expect(attempt).rejects.not.toThrow(/\n/);
  });

  test("readFileAt on the working tree names the path when it cannot be read", () => {
    const root = tempDir();
    expect(() => readFileAt(root, null, "absent.lore")).toThrow(InputError);
    expect(() => readFileAt(root, null, "absent.lore")).toThrow(/absent\.lore/);
  });
});

describe("under a translated git", () => {
  test("a folder in no working copy is still loose when the caller's locale is not English", async () => {
    const bin = tempDir();
    writeFileSync(
      join(bin, "git"),
      '#!/bin/sh\nif [ "$LC_ALL" = C ]; then echo "fatal: not a git repository (or any of the parent directories): .git" >&2; else echo "fatal: kein Git-Repository (oder irgendeines der Elternverzeichnisse): .git" >&2; fi\nexit 128\n',
      { mode: 0o755 },
    );
    const plain = tempDir();
    write(plain, { ".lore/x.lore": rule("x") });
    const saved = { PATH: process.env.PATH, LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
    Object.assign(process.env, { PATH: bin, LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" });
    try {
      const { input } = await buildInput({ repo: null, rulesRef: null, given: [plain], remotes: ["github.com/acme/shop"] });
      expect(input.given).toEqual([{ folder: "", loose: true, files: [{ path: ".lore/x.lore", content: rule("x") }] }]);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("without a git binary", () => {
  async function withoutGit<T>(run: () => Promise<T>): Promise<T> {
    const path = process.env.PATH;
    process.env.PATH = tempDir();
    try {
      return await run();
    } finally {
      process.env.PATH = path;
    }
  }

  test("a given folder is loose and the run needs no git", async () => {
    const plain = tempDir();
    write(plain, { ".lore/x.lore": rule("x") });
    const { input } = await withoutGit(() => buildInput({ repo: null, rulesRef: null, given: [plain], remotes: ["github.com/acme/shop"] }));
    expect(input.given).toEqual([{ folder: "", loose: true, files: [{ path: ".lore/x.lore", content: rule("x") }] }]);
  });

  test("a governed repo still reports the missing git", async () => {
    const root = repoWith({ ".lore/a.lore": rule("a") });
    const attempt = withoutGit(() => buildInput({ repo: root, rulesRef: null, given: [], remotes: ["github.com/acme/shop"] }));
    await expect(attempt).rejects.toThrow("git is not installed");
  });
});
