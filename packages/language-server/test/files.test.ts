import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "@lore/parser";
import { buildInput, listFiles } from "../src/files";

const RULE = `<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
`;

const made: string[] = [];

function folder(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-ls-files-")));
  made.push(dir);
  return dir;
}

function write(root: string, path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd: root, stdio: "ignore",
  });
}

function repository(): string {
  const root = folder();
  git(root, "init", "-q");
  return root;
}

function paths(files: { path: string }[]): string[] {
  return files.map((file) => file.path).sort();
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("listFiles", () => {
  test("is null outside a repository", async () => {
    expect(await listFiles(folder())).toBeNull();
  });

  test("is null for a missing folder", async () => {
    expect(await listFiles(join(folder(), "gone"))).toBeNull();
  });

  test("never runs a repository's core.fsmonitor command", async () => {
    const root = repository();
    const marker = join(root, "marker");
    write(root, "hook.sh", `#!/bin/sh\ntouch "${marker}"\n`);
    chmodSync(join(root, "hook.sh"), 0o755);
    git(root, "config", "core.fsmonitor", join(root, "hook.sh"));
    write(root, ".lore/a.lore", RULE);
    git(root, "add", ".lore/a.lore");
    rmSync(marker, { force: true });
    expect(await listFiles(root)).toContain(".lore/a.lore");
    await buildInput(root, new Map(), [root]);
    expect(existsSync(marker)).toBe(false);
  });

  test("ignores git variables inherited from the environment", async () => {
    const root = repository();
    const other = repository();
    write(other, "elsewhere.txt", "x\n");
    process.env.GIT_DIR = join(other, ".git");
    process.env.GIT_WORK_TREE = other;
    try {
      expect(await listFiles(root)).toEqual([]);
    } finally {
      delete process.env.GIT_DIR;
      delete process.env.GIT_WORK_TREE;
    }
  });

  test("ignores an inherited common or object directory", async () => {
    const root = repository();
    write(root, "here.txt", "x\n");
    const gone = join(folder(), "gone");
    for (const name of ["GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"]) {
      process.env[name] = gone;
      try {
        expect(await listFiles(root)).toEqual(["here.txt"]);
      } finally {
        delete process.env[name];
      }
    }
  });

  test("lists tracked and untracked files but not ignored ones", async () => {
    const root = repository();
    write(root, ".gitignore", "build/\n");
    write(root, ".lore/tracked.lore", RULE);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    write(root, ".lore/untracked.lore", RULE);
    write(root, "build/.lore/ignored.lore", RULE);
    expect((await listFiles(root))!.sort()).toEqual([".gitignore", ".lore/tracked.lore", ".lore/untracked.lore"]);
  });
});

describe("buildInput", () => {
  test("an untracked new .lore file counts", async () => {
    const root = repository();
    write(root, ".lore/a.lore", RULE);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    write(root, ".lore/b.lore", RULE);
    const input = await buildInput(root, new Map(), []);
    expect(paths(input.repo)).toEqual([".lore/a.lore", ".lore/b.lore"]);
    expect(parse(input).errors.map((d) => [d.name, d.file])).toEqual([
      ["duplicate-id", ".lore/a.lore"],
      ["duplicate-id", ".lore/b.lore"],
    ]);
  });

  test("an unsaved buffer wins over disk", async () => {
    const root = repository();
    write(root, ".lore/a.lore", RULE);
    const buffer = "<rule id=\"half\"\n";
    const input = await buildInput(root, new Map([[join(root, ".lore/a.lore"), buffer]]), []);
    expect(input.repo).toEqual([{ path: ".lore/a.lore", content: buffer }]);
  });

  test("an open buffer never saved to disk counts", async () => {
    const root = repository();
    const input = await buildInput(root, new Map([[join(root, ".lore/new.lore"), RULE]]), []);
    expect(input.repo).toEqual([{ path: ".lore/new.lore", content: RULE }]);
  });

  test("without git, the open buffers under the folder are the files", async () => {
    const root = folder();
    write(root, ".lore/on-disk.lore", RULE);
    const input = await buildInput(root, new Map([
      [join(root, ".lore/open.lore"), RULE],
      [join(folder(), ".lore/elsewhere.lore"), RULE],
    ]), []);
    expect(input).toEqual({ repo: [{ path: ".lore/open.lore", content: RULE }], given: [], remotes: [] });
  });

  test("reads only Lore files eagerly; other files read on demand", async () => {
    const root = repository();
    write(root, "src/app.ts", "export {};\n");
    write(root, ".loreconfig", "lore: 1\n");
    const input = await buildInput(root, new Map(), []);
    expect(Object.fromEntries(input.repo.map((file) => [file.path, file.content]))).toEqual({
      ".loreconfig": "lore: 1\n",
      "src/app.ts": "export {};\n",
    });
  });

  test("a file that is not valid UTF-8 is unreadable-structure at the invalid byte's line", async () => {
    const root = repository();
    const bytes = new TextEncoder().encode(RULE);
    const at = RULE.indexOf("\n") + 5;
    const broken = new Uint8Array([...bytes.slice(0, at), 0xff, ...bytes.slice(at)]);
    write(root, ".lore/a.lore", broken);
    const input = await buildInput(root, new Map(), []);
    expect(parse(input).errors.map((d) => [d.name, d.line])).toEqual([["unreadable-structure", 2]]);
  });

  test("a byte order mark and a U+FEFF at a line start are kept for the parser", async () => {
    const root = repository();
    write(root, ".lore/a.lore", "﻿a\n﻿b\n");
    const input = await buildInput(root, new Map(), []);
    expect(input.repo[0]!.content).toBe("﻿a\n﻿b\n");
  });

  test("the invalid UTF-8 path keeps a U+FEFF at a line start", async () => {
    const root = repository();
    const bytes = new TextEncoder().encode("﻿a\n﻿b\nc");
    write(root, ".lore/a.lore", new Uint8Array([...bytes, 0xff, 0x0a]));
    const input = await buildInput(root, new Map(), []);
    expect(input.repo[0]!.content.split("\n").slice(0, 2)).toEqual(["﻿a", "﻿b"]);
    expect(parse(input).errors.map((d) => [d.name, d.line])).toEqual([["unreadable-structure", 3]]);
  });

  test("reports an external folder outside any repository", async () => {
    const root = repository();
    const outside = join(folder(), "rules");
    const skipped: string[] = [];
    const input = await buildInput(root, new Map(), [outside], (path) => skipped.push(path));
    expect(input.given).toEqual([]);
    expect(skipped).toEqual([outside]);
  });

  test("remotes are the repository's fetch URLs, once each", async () => {
    const root = repository();
    git(root, "remote", "add", "origin", "git@example.com:acme/shop.git");
    git(root, "remote", "add", "mirror", "git@example.com:acme/shop.git");
    git(root, "remote", "add", "upstream", "https://example.com/acme/shop");
    git(root, "remote", "set-url", "--push", "upstream", "https://example.com/acme/push-only");
    const input = await buildInput(root, new Map(), []);
    expect(input.remotes.sort()).toEqual(["git@example.com:acme/shop.git", "https://example.com/acme/shop"]);
  });

  test("each external folder is a given folder of its enclosing repository", async () => {
    const root = repository();
    const rules = repository();
    write(rules, "shop/.loreconfig", "lore: 1\nrepo: example.com/acme/shop\n");
    write(rules, "shop/.lore/a.lore", RULE);
    write(rules, "other/.lore/b.lore", RULE);
    const input = await buildInput(root, new Map([[join(rules, "shop/.lore/a.lore"), "<rule"]]), [
      join(rules, "shop"),
      join(rules, "other"),
      rules,
      join(folder(), "not-a-repository"),
    ]);
    expect(input.given.map(({ folder, repository }) => ({ folder, repository }))).toEqual([
      { folder: "shop", repository: rules },
      { folder: "other", repository: rules },
      { folder: "", repository: rules },
    ]);
    expect(input.given[1]!.files).toBe(input.given[0]!.files);
    expect(input.given[2]!.files).toBe(input.given[0]!.files);
    expect(Object.fromEntries(input.given[0]!.files.map((file) => [file.path, file.content]))).toEqual({
      "shop/.loreconfig": "lore: 1\nrepo: example.com/acme/shop\n",
      "shop/.lore/a.lore": "<rule",
      "other/.lore/b.lore": RULE,
    });
  });

  test("an external folder may be relative to the workspace", async () => {
    const root = repository();
    write(root, "vendor/rules/.lore/a.lore", RULE);
    const input = await buildInput(root, new Map(), ["vendor/rules"]);
    expect(input.given.map(({ folder, repository }) => ({ folder, repository }))).toEqual([
      { folder: "vendor/rules", repository: root },
    ]);
  });
});
