import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { EXTERNAL, LOOSE, type InputFile, type LoreInput } from "@lore/parser";
import { InputError } from "./errors";
import { gitRoot, readFileAt, remoteUrls, trackedPaths } from "./git";

export interface RuleSources {
  repo: string | null;
  rulesRef: string | null;
  given: string[];
  remotes: string[];
}
export interface BuiltInput { input: LoreInput; readSrc(file: string): string | null }

const LORE_FOLDER = ".lore";
const CONFIG_NAME = ".loreconfig";

export function findRepoRoot(dir: string): string | null {
  return gitRoot(dir);
}

export async function buildInput(sources: RuleSources): Promise<BuiltInput> {
  const { repo, rulesRef } = sources;
  const remotes = sources.remotes.length > 0 ? sources.remotes : repo === null ? [] : remoteUrls(repo);
  if (repo === null && remotes.length === 0) throw new InputError("--no-repo needs --remote");

  const governed = repo === null ? [] : readFiles(repo, rulesRef, trackedPaths(repo, rulesRef));
  const input: LoreInput = rulesRef === null ? { repo: governed, given: [], remotes } : { repo: [], rules: governed, given: [], remotes };

  const repositories = new Set<string>();
  const looseFolders: string[] = [];
  const trackedByRoot = new Map<string, InputFile[]>();
  for (const typed of sources.given) {
    const dir = realFolder(typed);
    const root = gitRoot(dir);
    if (root === null) {
      looseFolders.push(dir);
      input.given.push({ folder: "", loose: true, files: readLoose(dir) });
      continue;
    }
    repositories.add(root);
    if (!trackedByRoot.has(root)) trackedByRoot.set(root, readFiles(root, null, trackedPaths(root, null)));
    input.given.push({ folder: relative(root, dir).split(sep).join("/"), repository: root, files: trackedByRoot.get(root)! });
  }

  const readSrc = (file: string): string | null => {
    if (file.startsWith(EXTERNAL)) return readFirst([...repositories], file.slice(EXTERNAL.length));
    if (file.startsWith(LOOSE)) return readFirst(looseFolders, file.slice(LOOSE.length));
    if (repo === null) return null;
    if (rulesRef === null) return readInside(repo, file);
    try {
      return readFileAt(repo, rulesRef, file);
    } catch {
      return null;
    }
  };
  return { input, readSrc };
}

function realFolder(typed: string): string {
  let dir: string;
  try {
    dir = realpathSync(resolve(typed));
  } catch {
    throw new InputError(`given folder not found: ${typed}`);
  }
  if (!statSync(dir).isDirectory()) throw new InputError(`given folder is not a directory: ${typed}`);
  return dir;
}

function wantsContent(path: string): boolean {
  const segments = path.split("/");
  const name = segments.at(-1)!;
  const folders = segments.slice(0, -1);
  if (name.endsWith(".lore")) return folders.includes(LORE_FOLDER);
  return name === CONFIG_NAME && !folders.includes(LORE_FOLDER);
}

function readFiles(root: string, ref: string | null, paths: string[]): InputFile[] {
  return paths.map((path) => ({ path, content: wantsContent(path) ? readFileAt(root, ref, path) : "" }));
}

function readLoose(dir: string): InputFile[] {
  const paths: string[] = [];
  const walk = (at: string, prefix: string): void => {
    const entries = readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") || entry.name === LORE_FOLDER) walk(join(at, entry.name), `${path}/`);
      } else if (entry.isFile()) paths.push(path);
    }
  };
  walk(dir, "");
  return paths.map((path) => ({ path, content: wantsContent(path) ? readFileSync(join(dir, path), "utf8") : "" }));
}

function readFirst(roots: string[], path: string): string | null {
  for (const root of roots) {
    const content = readInside(root, path);
    if (content !== null) return content;
  }
  return null;
}

function readInside(root: string, path: string): string | null {
  const target = resolve(root, path);
  const from = relative(root, target);
  if (from === ".." || from.startsWith(`..${sep}`)) return null;
  try {
    return readFileSync(target, "utf8");
  } catch {
    return null;
  }
}
