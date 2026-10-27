import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { InputError } from "../src/errors";
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
