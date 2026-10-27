import { FIXED_CATEGORIES } from "./blocks";
import { namesRepo, readLoreconfig, type DisableItem } from "./loreconfig";
import { compareCodePoints, lineRange } from "./text";
import type { Diagnostic, GivenFolder, InputFile, LoreInput } from "./types";

// "repo" is the governed repo; a number indexes Collected.trees (one per external folder).
export type Tree = "repo" | number;
// "repo" is the governed repo; a number is one repository of the given folders.
export type Repository = "repo" | number;

export interface CollectedFile {
  file: string;
  base: string;
  loreRoot: string;
  categories: string[];
  tree: Tree;
  content: string;
}

export interface ConfigFile {
  file: string;
  dir: string;
  repository: Repository;
  root: boolean;
  categories: string[];
  disable: DisableItem[];
  trees: Tree[];
}

export interface TreeInfo { repository: number; marked: string }

export interface Collected {
  files: CollectedFile[];
  configs: ConfigFile[];
  diagnostics: Diagnostic[];
  trees: TreeInfo[];
  // Indexed by Repository number: the tracked files of each repository of the given folders.
  repositoryFiles: InputFile[][];
  configsByRepository: ReadonlyMap<Repository, ReadonlyMap<string, ConfigFile>>;
}

type Config = Omit<ConfigFile, "trees">;
type Configs = ReadonlyMap<string, Config>;

interface Source { repository: Repository; prefix: string; files: InputFile[]; folders: string[] | null }

const LORE_FOLDER = ".lore";
const CONFIG_NAME = ".loreconfig";
export const EXTERNAL = "external:";
const ROOT = "";
const NO_CONFIGS: Configs = new Map();

export function collect(input: LoreInput): Collected {
  const given = repositories(input.given);
  const collected: Collected = {
    files: [], configs: [], diagnostics: [], trees: [], repositoryFiles: given.map(({ files }) => files), configsByRepository: new Map(),
  };
  collectSource({ repository: "repo", prefix: "", files: input.repo, folders: null }, input.remotes, collected);
  given.forEach(({ files, folders }, repository) => {
    collectSource({ repository, prefix: EXTERNAL, files, folders }, input.remotes, collected);
  });
  collected.files.sort((a, b) => compareCodePoints(a.file, b.file));
  const byRepository = new Map<Repository, Map<string, ConfigFile>>();
  for (const config of collected.configs) {
    const configs = byRepository.get(config.repository) ?? new Map<string, ConfigFile>();
    byRepository.set(config.repository, configs.set(config.dir, config));
  }
  return { ...collected, configsByRepository: byRepository };
}

export function disabledFor(collected: Collected, entryId: string, path: string, tree: Tree): boolean {
  const dir = dirOf(path);
  const governed = configsOf(collected, "repo");
  if (listsId(applying(governed, dir, loreRootOf(governed, dir, ROOT)), entryId)) return true;
  if (tree === "repo") return false;
  const { repository, marked } = collected.trees[tree]!;
  const own = configsOf(collected, repository);
  const stands = join(marked, dir);
  return listsId(applying(own, stands, loreRootOf(own, stands, marked)), entryId);
}

function collectSource(source: Source, remotes: readonly string[], out: Collected): void {
  const { configs, excluded, marks } = readConfigs(source, remotes, out.diagnostics);
  const roots: { marked: string; tree: Tree }[] = source.folders === null
    ? [{ marked: ROOT, tree: "repo" }]
    : marks.map((marked) => ({ marked, tree: out.trees.push({ repository: source.repository as number, marked }) - 1 }));

  for (const { marked, tree } of roots) {
    for (const file of source.files) {
      const dir = dirOf(file.path);
      if (!within(dir, marked) || excluded.some((gone) => within(dir, gone))) continue;
      const base = baseOf(marked === ROOT ? file.path : file.path.slice(marked.length + 1));
      if (base === null) continue;
      const loreRoot = loreRootOf(configs, dir, marked);
      out.files.push({
        file: source.prefix + file.path, base, loreRoot,
        categories: [...new Set([...FIXED_CATEGORIES, ...applying(configs, dir, loreRoot).flatMap((c) => c.categories)])],
        tree, content: file.content,
      });
    }
  }

  for (const config of configs.values()) {
    const trees = roots
      .filter(({ marked }) => within(config.dir, marked) || applying(configs, marked, loreRootOf(configs, marked, marked)).includes(config))
      .map(({ tree }) => tree);
    out.configs.push({ ...config, trees });
  }
}

// Read top down, so a directory excluded by repo-inside-repo or nested-repo hides everything below it.
function readConfigs(
  source: Source,
  remotes: readonly string[],
  diagnostics: Diagnostic[],
): { configs: Configs; excluded: string[]; marks: string[] } {
  const configs = new Map<string, Config>();
  const excluded: string[] = [];
  const marked: string[] = [];
  const marks: string[] = [];
  const candidates = source.files
    .filter((file) => isConfigPath(file.path) && readable(dirOf(file.path), source.folders))
    .sort((a, b) => depth(a.path) - depth(b.path) || compareCodePoints(a.path, b.path));

  for (const file of candidates) {
    const dir = dirOf(file.path);
    if (excluded.some((gone) => within(dir, gone))) continue;
    const name = source.prefix + file.path;
    const read = readLoreconfig(file.content);
    const report = (problem: string, line: number) =>
      diagnostics.push({ name: problem, file: name, entry: null, line, range: lineRange(read.lines, line) });
    if (read.config === null) {
      report("invalid-loreconfig", read.problem);
      continue;
    }
    const { root, repo, categories, disable } = read.config;
    if (repo !== null) {
      const problem = source.folders === null ? "repo-inside-repo"
        : marked.some((above) => above !== dir && within(dir, above)) ? "nested-repo"
        : null;
      if (problem !== null) {
        report(problem, repo.line);
        excluded.push(dir);
        continue;
      }
      marked.push(dir);
      if (source.folders!.some((folder) => within(dir, folder)) && namesRepo(repo.value, remotes)) marks.push(dir);
    }
    configs.set(dir, { file: name, dir, repository: source.repository, root, categories, disable });
  }
  return { configs, excluded, marks };
}

// Given folders of one repository are read together, so a file they both reach is read once.
function repositories(given: readonly GivenFolder[]): { files: InputFile[]; folders: string[] }[] {
  const groups: { first: GivenFolder; files: InputFile[]; folders: string[] }[] = [];
  for (const folder of given) {
    const trimmed = folder.folder.replace(/\/+$/, "");
    const group = groups.find((g) => sameRepository(g.first, folder));
    if (group === undefined) groups.push({ first: folder, files: folder.files, folders: [trimmed] });
    else group.folders.push(trimmed);
  }
  return groups.map(({ files, folders }) => ({ files, folders }));
}

function sameRepository(a: GivenFolder, b: GivenFolder): boolean {
  if (a.repository !== undefined && b.repository !== undefined) return a.repository === b.repository;
  return sameFiles(a.files, b.files);
}

function sameFiles(a: readonly InputFile[], b: readonly InputFile[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const contents = new Map(a.map((file) => [file.path, file.content]));
  return b.every((file) => contents.get(file.path) === file.content);
}

function readable(dir: string, folders: readonly string[] | null): boolean {
  return folders === null || folders.some((folder) => within(dir, folder) || within(folder, dir));
}

function isConfigPath(path: string): boolean {
  const segments = path.split("/");
  return segments.at(-1) === CONFIG_NAME && !segments.slice(0, -1).includes(LORE_FOLDER);
}

function baseOf(path: string): string | null {
  const segments = path.split("/");
  if (!segments.at(-1)!.endsWith(".lore")) return null;
  const folder = segments.indexOf(LORE_FOLDER);
  if (folder === -1 || folder === segments.length - 1) return null;
  return segments.slice(0, folder).join("/");
}

function loreRootOf(configs: Configs, dir: string, floor: string): string {
  for (const at of ancestors(dir)) if (configs.get(at)?.root === true) return at;
  return floor;
}

function applying(configs: Configs, dir: string, loreRoot: string): Config[] {
  const found: Config[] = [];
  for (const at of ancestors(dir)) {
    const config = configs.get(at);
    if (config !== undefined) found.push(config);
    if (at === loreRoot) break;
  }
  return found.reverse();
}

function configsOf(collected: Collected, repository: Repository): Configs {
  return collected.configsByRepository.get(repository) ?? NO_CONFIGS;
}

function listsId(configs: Config[], id: string): boolean {
  return configs.some((config) => config.disable.some((item) => item.id === id));
}

function ancestors(dir: string): string[] {
  const found = [dir];
  for (let at = dir; at !== ROOT; ) {
    at = dirOf(at);
    found.push(at);
  }
  return found;
}

function within(dir: string, ancestor: string): boolean {
  return ancestor === ROOT || dir === ancestor || dir.startsWith(`${ancestor}/`);
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? ROOT : path.slice(0, slash);
}

function join(dir: string, path: string): string {
  if (dir === ROOT) return path;
  return path === ROOT ? dir : `${dir}/${path}`;
}

function depth(path: string): number {
  return path.split("/").length;
}
