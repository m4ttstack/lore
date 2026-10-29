import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { changeDiff, type ChangeSource } from "../src/change";
import { parseUnifiedDiff } from "../src/diff";
import { InputError } from "../src/errors";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-change-")));
  made.push(dir);
  return dir;
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function runner(root: string): (...args: string[]) => string {
  return (...args) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function repoWith(files: Record<string, string>): { root: string; git: (...args: string[]) => string } {
  const root = tempDir();
  const git = runner(root);
  git("init", "-q", "-b", "main");
  write(root, files);
  git("add", ".");
  git("commit", "-q", "-m", "first");
  return { root, git };
}

function filesOf(root: string, source: ChangeSource) {
  return parseUnifiedDiff(changeDiff(root, source)).files;
}

describe("changeDiff for uncommitted work", () => {
  test("uncommitted: staged, unstaged and untracked files are all in the change", () => {
    const { root, git } = repoWith({ "staged.ts": "a\n", "unstaged.ts": "a\n" });
    write(root, { "staged.ts": "a\nb\n" });
    git("add", "staged.ts");
    write(root, { "unstaged.ts": "a\nb\nc\n", "fresh.ts": "x\ny\n" });
    const files = filesOf(root, { base: null });
    expect(files.map((f) => [f.kind, f.path]).sort()).toEqual([["A", "fresh.ts"], ["M", "staged.ts"], ["M", "unstaged.ts"]]);
    const added = (path: string) => files.find((f) => f.path === path)!.added.map((l) => l.line);
    expect(added("staged.ts")).toEqual([2]);
    expect(added("unstaged.ts")).toEqual([2, 3]);
    expect(added("fresh.ts")).toEqual([1, 2]);
  });

  test("uncommitted: an ignored untracked file is not in the change", () => {
    const { root } = repoWith({ ".gitignore": "secret.env\n" });
    write(root, { "secret.env": "TOKEN=1\n", "visible.ts": "v\n" });
    expect(filesOf(root, { base: null }).map((f) => f.path)).toEqual(["visible.ts"]);
  });

  test("uncommitted: a clean tree gives an empty change", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    expect(filesOf(root, { base: null })).toEqual([]);
  });

  test("uncommitted: a repo with no commits treats every file as added", () => {
    const root = tempDir();
    const git = runner(root);
    git("init", "-q", "-b", "main");
    write(root, { "staged.ts": "s\n", "loose.ts": "l\n" });
    git("add", "staged.ts");
    const files = filesOf(root, { base: null });
    expect(files.map((f) => [f.kind, f.path]).sort()).toEqual([["A", "loose.ts"], ["A", "staged.ts"]]);
  });

  test("uncommitted: an untracked path git quotes is named exactly", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    write(root, { "src/é.ts": "e\n" });
    expect(filesOf(root, { base: null }).map((f) => f.path)).toEqual(["src/é.ts"]);
  });

  test("uncommitted: an untracked symlink to a file is added with its target as the one added line", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    write(root, { "real.ts": "r\n" });
    symlinkSync("real.ts", join(root, "link.ts"));
    const link = filesOf(root, { base: null }).find((f) => f.path === "link.ts")!;
    expect(link.kind).toBe("A");
    expect(link.added).toEqual([{ line: 1, text: "real.ts" }]);
  });

  test("uncommitted: an untracked symlink to a directory is added with its target as the one added line", () => {
    const { root } = repoWith({ "dir/a.ts": "a\n" });
    symlinkSync("dir", join(root, "link"));
    expect(filesOf(root, { base: null }).map((f) => [f.kind, f.path, f.added])).toEqual([["A", "link", [{ line: 1, text: "dir" }]]]);
  });

  test("uncommitted: untracked names that look like pathspecs or options are read literally", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    write(root, { "*.ts": "s\n", ":(glob)c.ts": "c\n", "-dash.ts": "d\n" });
    expect(filesOf(root, { base: null }).map((f) => f.path).sort()).toEqual(["*.ts", "-dash.ts", ":(glob)c.ts"]);
  });

  test("uncommitted: many untracked files are all in the change", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    for (let i = 0; i < 500; i++) writeFileSync(join(root, `f${i}.ts`), `x${i}\n`);
    const started = performance.now();
    const files = filesOf(root, { base: null });
    expect(files.length).toBe(500);
    expect(files.every((f) => f.kind === "A" && f.added.length === 1)).toBe(true);
    // One git call per file took about 8 s here; a single diff takes well under one.
    expect(performance.now() - started).toBeLessThan(5000);
  });

  test("uncommitted: a moved file that is not staged is a rename", () => {
    const { root } = repoWith({ "old.ts": "one\ntwo\nthree\nfour\nfive\n" });
    renameSync(join(root, "old.ts"), join(root, "new.ts"));
    expect(filesOf(root, { base: null }).map((f) => [f.kind, f.path, f.kind === "R" ? f.oldPath : null])).toEqual([["R", "new.ts", "old.ts"]]);
  });

  test("uncommitted: the real index and git directory are unchanged", () => {
    const { root, git } = repoWith({ "staged.ts": "a\n", "unstaged.ts": "a\n", "gone.ts": "g\n" });
    git("config", "core.splitIndex", "true");
    write(root, { "staged.ts": "a\nb\n" });
    git("add", "staged.ts");
    write(root, { "unstaged.ts": "a\nb\n", "fresh.ts": "f\n" });
    rmSync(join(root, "gone.ts"));
    const state = () => [git("diff", "--cached", "--name-only"), git("status", "--porcelain")];
    const disk = () => [readdirSync(join(root, ".git")).sort(), readFileSync(join(root, ".git", "index")).toString("base64")];
    const before = state();
    const diskBefore = disk();
    expect(filesOf(root, { base: null }).length).toBe(4);
    expect(disk()).toEqual(diskBefore);
    expect(state()).toEqual(before);
  });

  test("uncommitted: an untracked nested repository is skipped", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    const nested = join(root, "nested");
    mkdirSync(nested);
    runner(nested)("init", "-q", "-b", "main");
    write(nested, { "inner.ts": "i\n" });
    runner(nested)("add", ".");
    runner(nested)("commit", "-q", "-m", "inner");
    expect(filesOf(root, { base: null })).toEqual([]);
  });

  test("uncommitted: an untracked binary file is added with no added lines", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    writeFileSync(join(root, "blob.bin"), Buffer.from([0, 1, 2, 0, 255, 0]));
    const files = filesOf(root, { base: null });
    expect(files.map((f) => [f.kind, f.path, f.added])).toEqual([["A", "blob.bin", []]]);
  });

  test("uncommitted: diff config does not change the result", () => {
    const build = () => {
      const made = repoWith({ "t.ts": "a\n" });
      write(made.root, { "t.ts": "a\nb\n", "u.ts": "u\n" });
      return made;
    };
    const plain = filesOf(build().root, { base: null });
    const configured = build();
    for (const [key, value] of [["diff.noprefix", "true"], ["diff.mnemonicPrefix", "true"], ["color.ui", "always"], ["diff.external", "false"]]) {
      configured.git("config", key!, value!);
    }
    expect(filesOf(configured.root, { base: null })).toEqual(plain);
    expect(plain.length).toBe(2);
  });
});

describe("changeDiff for one commit", () => {
  test("commit: compares with its first parent", () => {
    const { root, git } = repoWith({ "a.ts": "a\n", "b.ts": "b\n" });
    write(root, { "a.ts": "a\nmore\n" });
    git("commit", "-q", "-am", "second");
    const files = filesOf(root, { commit: "HEAD" });
    expect(files.map((f) => [f.kind, f.path])).toEqual([["M", "a.ts"]]);
    expect(files[0]!.added).toEqual([{ line: 2, text: "more" }]);
  });

  test("commit: a root commit compares with the empty tree", () => {
    const { root } = repoWith({ "a.ts": "a\n", "b.ts": "b\n" });
    expect(filesOf(root, { commit: "HEAD" }).map((f) => [f.kind, f.path])).toEqual([["A", "a.ts"], ["A", "b.ts"]]);
  });

  test("commit: a merge commit compares with its first parent", () => {
    const { root, git } = repoWith({ "base.ts": "b\n", "main-only.ts": "m\n" });
    git("checkout", "-q", "-b", "side");
    write(root, { "side.ts": "s\n" });
    git("add", ".");
    git("commit", "-q", "-m", "side");
    git("checkout", "-q", "main");
    write(root, { "main-only.ts": "m\nm2\n" });
    git("commit", "-q", "-am", "main work");
    git("merge", "-q", "--no-ff", "-m", "merge", "side");
    expect(filesOf(root, { commit: "HEAD" }).map((f) => [f.kind, f.path])).toEqual([["A", "side.ts"]]);
  });

  test("commit: an unknown commit is an input error", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    expect(() => changeDiff(root, { commit: "nope" })).toThrow(new InputError("not a commit: nope"));
  });

  test("commit: a value starting with - is an input error", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    expect(() => changeDiff(root, { commit: "--help" })).toThrow(new InputError("not a commit: --help"));
  });
});

describe("changeDiff for the branch so far", () => {
  test("base: compares the merge base with the working tree", () => {
    const { root, git } = repoWith({ "m0.ts": "m\n" });
    git("checkout", "-q", "-b", "feat");
    write(root, { "b.ts": "b\n" });
    git("add", ".");
    git("commit", "-q", "-m", "branch");
    git("checkout", "-q", "main");
    write(root, { "m1.ts": "m1\n" });
    git("add", "m1.ts");
    git("commit", "-q", "-m", "main moves");
    git("checkout", "-q", "feat");
    write(root, { "b.ts": "b\nmore\n", "c.ts": "c\n" });
    expect(filesOf(root, { base: "main" }).map((f) => [f.kind, f.path]).sort()).toEqual([["A", "b.ts"], ["A", "c.ts"]]);
  });

  test("base: HEAD as the base equals the uncommitted change", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    write(root, { "a.ts": "a\nb\n", "u.ts": "u\n" });
    expect(filesOf(root, { base: "HEAD" })).toEqual(filesOf(root, { base: null }));
    expect(filesOf(root, { base: "HEAD" }).length).toBe(2);
  });

  test("base: an unknown ref is an input error", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    expect(() => changeDiff(root, { base: "nope" })).toThrow(new InputError("not a commit: nope"));
  });

  test("base: a value starting with - is an input error", () => {
    const { root } = repoWith({ "a.ts": "a\n" });
    expect(() => changeDiff(root, { base: "--help" })).toThrow(new InputError("not a commit: --help"));
  });

  test("base: unrelated histories are an input error", () => {
    const { root, git } = repoWith({ "a.ts": "a\n" });
    git("checkout", "-q", "--orphan", "other");
    git("commit", "-q", "--allow-empty", "-m", "root");
    git("checkout", "-q", "main");
    expect(() => changeDiff(root, { base: "other" })).toThrow(new InputError("no merge base between other and HEAD"));
  });
});
