import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { EXTERNAL, LOOSE, type InputFile, type LoreInput } from "@lore/parser";
import { InputError } from "./errors";
import { GitMissingError, gitRoot, readContained, readFileAt, remoteUrls, trackedPaths } from "./git";

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

  const repositories = new Map<string, InputFile[]>();
  const looseFolders = new Map<string, InputFile[]>();
  for (const typed of sources.given) {
    const dir = realFolder(typed);
    const root = workingCopyOf(dir);
    if (root === null) {
      if (!looseFolders.has(dir)) looseFolders.set(dir, readLoose(dir));
      input.given.push({ folder: "", loose: true, files: looseFolders.get(dir)! });
      continue;
    }
    if (!repositories.has(root)) repositories.set(root, readFiles(root, null, trackedPaths(root, null)));
    input.given.push({ folder: relative(root, dir).split(sep).join("/"), repository: root, files: repositories.get(root)! });
  }

  const readSrc = (file: string): string | null => {
    if (file.startsWith(EXTERNAL)) return readFirst(repositories, file.slice(EXTERNAL.length));
    if (file.startsWith(LOOSE)) return readFirst(looseFolders, file.slice(LOOSE.length));
    if (repo === null) return null;
    if (rulesRef === null) return readContained(repo, file);
    try {
      return readFileAt(repo, rulesRef, file);
    } catch {
      return null;
    }
  };
  return { input, readSrc };
}

// Without a git binary no folder can be a working copy, so a given folder is loose.
function workingCopyOf(dir: string): string | null {
  try {
    return gitRoot(dir);
  } catch (error) {
    if (error instanceof GitMissingError) return null;
    throw error;
  }
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

// A working-tree Lore or .loreconfig file that does not resolve to a readable file inside root
// (an escaping or dangling symlink, a directory, a skipped sparse-checkout file) is left out of the input.
function readFiles(root: string, ref: string | null, paths: string[]): InputFile[] {
  const files: InputFile[] = [];
  for (const path of paths) {
    if (!wantsContent(path)) files.push({ path, content: "" });
    else if (ref !== null) files.push({ path, content: readFileAt(root, ref, path) });
    else {
      const content = readContained(root, path);
      if (content !== null) files.push({ path, content });
    }
  }
  return files;
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
  return readFiles(dir, null, paths);
}

// Only a place whose own file list holds the path is read, so an untracked file in one repository cannot shadow a tracked one in another.
function readFirst(places: Map<string, InputFile[]>, path: string): string | null {
  for (const [root, files] of places) {
    if (!files.some((file) => file.path === path)) continue;
    const content = readContained(root, path);
    if (content !== null) return content;
  }
  return null;
}
