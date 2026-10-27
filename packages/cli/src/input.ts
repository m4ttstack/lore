import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { EXTERNAL, LOOSE, type InputFile, type LoreInput } from "@lore/parser";
import { InputError } from "./errors";
import { GitMissingError, gitRoot, readFileAt, readTracked, remoteUrls, trackedPaths } from "./git";

export interface RuleSources {
  repo: string | null;
  rulesRef: string | null;
  given: string[];
  remotes: string[];
}
export interface BuiltInput { input: LoreInput; readSrc(file: string): string | null }
interface Place { root: string; listed: Set<string>; files: InputFile[] }

const LORE_FOLDER = ".lore";
const CONFIG_NAME = ".loreconfig";

export function findRepoRoot(dir: string): string | null {
  return gitRoot(dir);
}

export async function buildInput(sources: RuleSources): Promise<BuiltInput> {
  const { repo, rulesRef } = sources;
  const remotes = sources.remotes.length > 0 ? sources.remotes : repo === null ? [] : remoteUrls(repo);
  if (repo === null && remotes.length === 0) throw new InputError("--no-repo needs --remote");

  const governedPaths = repo === null ? [] : trackedPaths(repo, rulesRef);
  const governedTracked = new Set(governedPaths);
  const governed = repo === null ? [] : readFiles(repo, rulesRef, governedPaths);
  const input: LoreInput = rulesRef === null ? { repo: governed, given: [], remotes } : { repo: [], rules: governed, given: [], remotes };

  const repositories = new Map<string, Place>();
  const looseFolders = new Map<string, Place>();
  const seen = new Set<string>();
  for (const typed of sources.given) {
    const dir = realFolder(typed);
    if (seen.has(dir)) continue;
    seen.add(dir);
    const root = workingCopyOf(dir);
    if (root === null) {
      const place = placeOf(dir, walkLoose(dir));
      looseFolders.set(dir, place);
      input.given.push({ folder: "", loose: true, files: place.files });
      continue;
    }
    if (!repositories.has(root)) repositories.set(root, placeOf(root, trackedPaths(root, null)));
    const place = repositories.get(root)!;
    const folder = relative(root, dir).split(sep).join("/");
    if (![...place.listed].some((path) => folder === "" || path.startsWith(`${folder}/`))) {
      throw new InputError(`given folder ${typed} is inside the working copy at ${root}, but git tracks none of its files`);
    }
    input.given.push({ folder, repository: root, files: place.files });
  }

  const readSrc = (file: string): string | null => {
    if (file.startsWith(EXTERNAL)) return readOnly(repositories, file.slice(EXTERNAL.length));
    if (file.startsWith(LOOSE)) return readOnly(looseFolders, file.slice(LOOSE.length));
    if (repo === null) return null;
    if (rulesRef === null) return readTracked(repo, file, governedTracked);
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

// A working-tree Lore or .loreconfig file that does not resolve to a readable listed file
// (a symlink out of the listed paths, a dangling one, a skipped sparse-checkout file) is left out of the input.
function readFiles(root: string, ref: string | null, paths: string[]): InputFile[] {
  const listed = new Set(paths);
  const files: InputFile[] = [];
  for (const path of paths) {
    if (!wantsContent(path)) files.push({ path, content: "" });
    else if (ref !== null) files.push({ path, content: readFileAt(root, ref, path) });
    else {
      const content = readTracked(root, path, listed);
      if (content !== null) files.push({ path, content });
    }
  }
  return files;
}

function placeOf(root: string, paths: string[]): Place {
  return { root, listed: new Set(paths), files: readFiles(root, null, paths) };
}

function walkLoose(dir: string): string[] {
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
  return paths;
}

// A path listed by more than one place is ambiguous, so it is read from none rather than from whichever came first.
function readOnly(places: Map<string, Place>, path: string): string | null {
  const holders = [...places.values()].filter((place) => place.listed.has(path));
  return holders.length === 1 ? readTracked(holders[0]!.root, path, holders[0]!.listed) : null;
}
