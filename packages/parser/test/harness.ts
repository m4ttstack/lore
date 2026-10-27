import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Example } from "../../../tools/check/extract";
import type { Change, ChangedFile, InputFile, LoreInput } from "../src/types";

const DEFAULT_REMOTE = "https://github.com/acme/shop";
const EXTERNAL = "external:";

export function toInput(example: Example): LoreInput {
  const repo: InputFile[] = [];
  const external: InputFile[] = [];
  for (const file of example.files) {
    if (file.external) external.push({ path: file.path.slice(EXTERNAL.length), content: file.content });
    else repo.push({ path: file.path, content: file.content });
  }
  return {
    repo,
    given: external.length > 0 ? [{ folder: "", files: external }] : [],
    remotes: [example.remote ?? DEFAULT_REMOTE],
  };
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
    const renamed = /^R (.+) -> (.+)$/.exec(line);
    if (renamed) {
      files.push({ kind: "R", oldPath: renamed[1]!, path: renamed[2]!, added: [] });
      continue;
    }
    const plain = /^([AMD]) (.+)$/.exec(line);
    if (!plain) throw new Error(`unrecognised diff line: ${line}`);
    files.push({ kind: plain[1] as "A" | "M" | "D", path: plain[2]!, added: [] });
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
