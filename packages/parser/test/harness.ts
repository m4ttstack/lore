import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Example } from "../../../tools/check/extract";
import type { AuditOptions } from "../src/audit";
import { LOCK_NAME, readReviews, type ReviewRecord } from "../src/reviews";
import type { Change, ChangedFile, InputFile, LoreInput } from "../src/types";

const DEFAULT_REMOTE = "https://github.com/acme/shop";

export function toInput(example: Example): LoreInput {
  const repo: InputFile[] = [];
  const external: InputFile[] = [];
  const rules: InputFile[] = [];
  const loose: InputFile[] = [];
  for (const file of example.files) {
    const path = file.path.slice(file.path.indexOf(":") + 1);
    if (file.place === "external") external.push({ path, content: file.content });
    else if (file.place === "rules") rules.push({ path, content: file.content });
    else if (file.place === "loose") loose.push({ path, content: file.content });
    else if (file.place === "repo") repo.push({ path: file.path, content: file.content });
  }
  return {
    repo,
    given: [
      ...(external.length > 0 ? [{ folder: "", files: external }] : []),
      ...(loose.length > 0 ? [{ folder: "", loose: true, files: loose }] : []),
    ],
    remotes: [example.remote ?? DEFAULT_REMOTE],
    ...(rules.length > 0 ? { rules } : {}),
  };
}

// Every file the example does not hold reads as absent, so an example never leaves a source unchecked.
export function auditOptions(example: Example): Pick<AuditOptions, "today" | "readSource" | "locks"> {
  const contents = new Map(example.files.map((file) => [file.path, file.content]));
  const locks = new Map<string, ReviewRecord[]>();
  for (const file of example.files) {
    const path = file.place === "repo" ? file.path : file.path.slice(file.path.indexOf(":") + 1);
    if (path.split("/").at(-1) !== LOCK_NAME) continue;
    const read = readReviews(file.content);
    if ("problem" in read) throw new Error(`${file.path}:${read.line}: ${read.problem}`);
    locks.set(file.path, read.records);
  }
  return { today: example.today ?? "", readSource: (_place, path) => contents.get(path) ?? null, locks };
}

export function toChange(diff: string): Change {
  const files: ChangedFile[] = [];
  for (const line of diff.split("\n")) {
    if (line === "") continue;
    const added = /^\+(\d+)(?: (.*))?$/.exec(line);
    if (added) {
      const current = files.at(-1);
      if (!current) throw new Error(`added line before any file: ${line}`);
      current.added.push({ line: Number(added[1]), text: added[2] ?? "" });
      continue;
    }
    const removed = /^-(\d+)(?: (.*))?$/.exec(line);
    if (removed) {
      const current = files.at(-1);
      if (!current) throw new Error(`removed line before any file: ${line}`);
      if (current.kind === "A") throw new Error(`removed line in an added file: ${line}`);
      current.removed.push({ line: Number(removed[1]), text: removed[2] ?? "" });
      continue;
    }
    const renamed = /^R (.+) -> (.+)$/.exec(line);
    if (renamed) {
      files.push({ kind: "R", oldPath: renamed[1]!, path: renamed[2]!, added: [], removed: [] });
      continue;
    }
    const plain = /^([AMD]) (.+)$/.exec(line);
    if (!plain) throw new Error(`unrecognised diff line: ${line}`);
    files.push({ kind: plain[1] as "A" | "M" | "D", path: plain[2]!, added: [], removed: [] });
  }
  return { files };
}

// Workspace hoisting can put the binary in the package's node_modules or in the root's.
export function astGrepBinary(): string {
  for (const dir of ["../node_modules/.bin", "../../../node_modules/.bin"]) {
    const path = fileURLToPath(new URL(`${dir}/ast-grep`, import.meta.url));
    if (existsSync(path)) return path;
  }
  throw new Error("the @ast-grep/cli devDependency is not installed; run bun install");
}

// A stand-in binary that only answers --version with the given line.
export function stubAstGrep(version: string): { binary: string; remove(): void } {
  const dir = mkdtempSync(join(tmpdir(), "lore-astgrep-stub-"));
  const stub = join(dir, "ast-grep");
  writeFileSync(stub, `#!/bin/sh\necho "${version}"\n`);
  chmodSync(stub, 0o755);
  return { binary: stub, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
