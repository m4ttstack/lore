import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const script = join(import.meta.dir, "private.ts");
let scratch: string;
let identityFile: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "lore-private-test-"));
  identityFile = join(scratch, "identity.txt");
  const keygen = spawnSync("age-keygen", ["-o", identityFile], { encoding: "utf8" });
  if (keygen.status !== 0) throw new Error(`age-keygen failed: ${keygen.stderr}`);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function privateCli(root: string, ...args: string[]) {
  return spawnSync("bun", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, LORE_PRIVATE_ROOT: root, LORE_PRIVATE_IDENTITY_FILE: identityFile },
  });
}

function makeRoot(name: string): string {
  const root = join(scratch, name);
  mkdirSync(join(root, "private"), { recursive: true });
  return root;
}

function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(dir, path)] = readFileSync(path, "utf8");
    }
  };
  walk(dir);
  return files;
}

test("lock then unlock into a fresh root restores the tree and skips .DS_Store and node_modules", () => {
  const source = makeRoot("source");
  const dev = join(source, "private", "dev");
  mkdirSync(join(dev, "notes", "deep"), { recursive: true });
  mkdirSync(join(dev, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dev, "top.md"), "top\n");
  writeFileSync(join(dev, "notes", "deep", "a.json"), "{\"a\":1}\n");
  writeFileSync(join(dev, ".DS_Store"), "junk");
  writeFileSync(join(dev, "node_modules", "pkg", "index.js"), "junk");

  const locked = privateCli(source, "lock");
  expect(locked.stderr).toBe("");
  expect(locked.status).toBe(0);
  expect(locked.stdout).toContain("KiB");

  const target = makeRoot("target");
  writeFileSync(join(target, "private", "dev.tar.age"), readFileSync(join(source, "private", "dev.tar.age")));
  const unlocked = privateCli(target, "unlock");
  expect(unlocked.stderr).toBe("");
  expect(unlocked.status).toBe(0);

  expect(snapshot(join(target, "private", "dev"))).toEqual({
    "top.md": "top\n",
    "notes/deep/a.json": "{\"a\":1}\n",
  });
});

test("lock refuses an empty dev folder", () => {
  const root = makeRoot("empty");
  mkdirSync(join(root, "private", "dev"));
  const result = privateCli(root, "lock");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("nothing to lock");
});

test("unlock refuses a non-empty dev folder unless --force", () => {
  const root = makeRoot("busy");
  const dev = join(root, "private", "dev");
  mkdirSync(dev);
  writeFileSync(join(dev, "kept.md"), "original\n");
  expect(privateCli(root, "lock").status).toBe(0);
  writeFileSync(join(dev, "kept.md"), "edited\n");

  const refused = privateCli(root, "unlock");
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("pass --force");
  expect(readFileSync(join(dev, "kept.md"), "utf8")).toBe("edited\n");

  const forced = privateCli(root, "unlock", "--force");
  expect(forced.status).toBe(0);
  expect(readFileSync(join(dev, "kept.md"), "utf8")).toBe("original\n");
});

test("unlock fails with one line when there is no archive", () => {
  const root = makeRoot("bare");
  const result = privateCli(root, "unlock");
  expect(result.status).toBe(1);
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
  expect(result.stderr).toContain("no archive");
});
