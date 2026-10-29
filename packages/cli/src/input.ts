import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { EXTERNAL, LOOSE, type Collected, type Diagnostic, type InputFile, type LoreInput } from "@lore/parser";
import { InputError } from "./errors";
import { GitMissingError, gitRoot, readFileAt, readTracked, remoteUrls, trackedPaths, untrackedPaths } from "./git";

export interface RuleSources {
  repo: string | null;
  rulesRef: string | null;
  given: string[];
  remotes: string[];
  untrackedLore?: boolean;
}
export interface BuiltInput {
  input: LoreInput;
  // given is the index in input.given of the folder whose entry names the src; without it an ambiguous path reads as null.
  readSrc(file: string, given?: number): string | null;
  // Tracked Lore and .loreconfig files the command could not read; unreadWarnings keeps those the parser would have collected.
  unread: UnreadFile[];
}
export interface UnreadFile {
  // With its source's prefix: "loose:" or "external:" for a given folder, none for the governed repo.
  file: string;
  // The index in input.given of the place's first folder, or null for the governed repo.
  given: number | null;
}
interface Place { root: string; listed: Set<string>; files: InputFile[]; unread: string[]; folders: string[]; prefix: string }

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
  if (repo !== null && rulesRef === null && sources.untrackedLore) {
    governedPaths.push(...untrackedPaths(repo).filter(wantsContent));
  }
  const governed = repo === null ? { files: [], unread: [] } : readFiles(repo, rulesRef, governedPaths);
  const input: LoreInput = rulesRef === null
    ? { repo: governed.files, given: [], remotes }
    : { repo: [], rules: governed.files, given: [], remotes };

  const repositories = new Map<string, Place>();
  const looseFolders = new Map<string, Place>();
  const givenPlaces: Place[] = [];
  const folders = new Map<string, { typed: string; root: string | null }>();
  for (const typed of sources.given) {
    const dir = realFolder(typed);
    if (!folders.has(dir)) folders.set(dir, { typed, root: workingCopyOf(dir) });
  }
  const looseDirs = [...folders].filter(([, { root }]) => root === null).map(([dir]) => dir);
  for (const [dir, { typed, root }] of folders) {
    if (root === null && looseDirs.some((outer) => walkReaches(outer, dir))) continue;
    if (root === null) {
      const place = placeOf(dir, walkLoose(dir), LOOSE);
      place.folders.push("");
      looseFolders.set(dir, place);
      givenPlaces.push(place);
      input.given.push({ folder: "", loose: true, files: place.files });
      continue;
    }
    if (!repositories.has(root)) repositories.set(root, placeOf(root, trackedPaths(root, null), EXTERNAL));
    const place = repositories.get(root)!;
    const folder = relative(root, dir).split(sep).join("/");
    if (![...place.listed].some((path) => folder === "" || path.startsWith(`${folder}/`))) {
      throw new InputError(`given folder ${typed} is inside the working copy at ${root}, but git tracks none of its files`);
    }
    place.folders.push(folder);
    givenPlaces.push(place);
    input.given.push({ folder, repository: root, files: place.files });
  }

  const readGiven = (places: Map<string, Place>, path: string, given: number | undefined): string | null => {
    if (given === undefined) return readOnly(places, path);
    const place = givenPlaces[given];
    return place !== undefined && places.get(place.root) === place ? readTracked(place.root, path, place.listed) : null;
  };
  const readSrc = (file: string, given?: number): string | null => {
    if (file.startsWith(EXTERNAL)) return readGiven(repositories, file.slice(EXTERNAL.length), given);
    if (file.startsWith(LOOSE)) return readGiven(looseFolders, file.slice(LOOSE.length), given);
    if (repo === null) return null;
    if (rulesRef === null) return readTracked(repo, file, governedTracked);
    try {
      return readFileAt(repo, rulesRef, file);
    } catch {
      return null;
    }
  };
  const unread: UnreadFile[] = [
    ...governed.unread.map((file) => ({ file, given: null })),
    ...[...repositories.values(), ...looseFolders.values()].flatMap((place) =>
      place.unread.filter((path) => reached(path, place.folders)).map((path) => ({ file: place.prefix + path, given: givenPlaces.indexOf(place) }))),
  ];
  return { input, readSrc, unread };
}

// One lore-file-not-read per unread file the parser would have collected: a Lore file counts only in a marked tree
// and outside a repo-inside-repo or nested-repo subtree; a .loreconfig counts outside such a subtree, as it may be what marks one.
export function unreadWarnings(unread: readonly UnreadFile[], collected: Collected): Diagnostic[] {
  const files = unread.filter(({ file, given }) => {
    const prefix = [EXTERNAL, LOOSE].find((candidate) => file.startsWith(candidate)) ?? "";
    const dir = dirOf(file.slice(prefix.length));
    const excluded = collected.diagnostics.some(
      ({ name, file: reported }) =>
        (name === "repo-inside-repo" || name === "nested-repo") &&
        (prefix === "" ? ![EXTERNAL, LOOSE].some((other) => reported.startsWith(other)) : reported.startsWith(prefix)) &&
        within(dir, dirOf(reported.slice(prefix.length))),
    );
    if (excluded) return false;
    if (file.endsWith(CONFIG_NAME) || given === null) return true;
    return collected.trees.some((tree) => collected.repositoryGiven[tree.repository] === given && within(dir, tree.marked));
  });
  return [...new Set(files.map(({ file }) => file))].map((file) => ({ name: "lore-file-not-read", file, entry: null, line: 1 }));
}

function dirOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
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
function readFiles(root: string, ref: string | null, paths: string[]): { files: InputFile[]; unread: string[] } {
  const listed = new Set(paths);
  const files: InputFile[] = [];
  const unread: string[] = [];
  for (const path of paths) {
    if (!wantsContent(path)) files.push({ path, content: "" });
    else if (ref !== null) files.push({ path, content: readFileAt(root, ref, path) });
    else {
      const content = readTracked(root, path, listed);
      if (content === null) unread.push(path);
      else files.push({ path, content });
    }
  }
  return { files, unread };
}

function placeOf(root: string, paths: string[], prefix: string): Place {
  return { root, listed: new Set(paths), ...readFiles(root, null, paths), folders: [], prefix };
}

// Mirrors what the parser reads of a given folder: Lore files inside it, and .loreconfig files inside it or above it.
function reached(path: string, folders: readonly string[]): boolean {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const config = path.split("/").at(-1) === CONFIG_NAME;
  return folders.some((folder) => within(dir, folder) || (config && within(folder, dir)));
}

function within(dir: string, ancestor: string): boolean {
  return ancestor === "" || dir === ancestor || dir.startsWith(`${ancestor}/`);
}

// A loose folder whose walk reaches another given loose folder already collects that folder's files.
function walkReaches(outer: string, inner: string): boolean {
  const path = relative(outer, inner);
  if (path === "" || path === ".." || path.startsWith(`..${sep}`)) return false;
  return path.split(sep).every((name) => !name.startsWith(".") || name === LORE_FOLDER);
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
