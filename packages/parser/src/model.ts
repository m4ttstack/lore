import { checkDefaults, checkScope } from "./blocks";
import { EXTERNAL, RULES, collect, type Collected, type Tree } from "./collect";
import { DEFAULT_FILES, lineDiagnostic, readEntry, resolveScope, type EntryResult, type FileContext } from "./entries";
import { disjoint } from "./glob";
import { dedent } from "./indent";
import { parseFile, type BlockNode, type LoreFile } from "./scan";
import { compareCodePoints } from "./text";
import type { Diagnostic, DocumentModel, Entry, LoreInput } from "./types";
import { readBlock, type BlockProblem } from "./yaml";

export interface EntryPlace {
  base: string;
  tree: Tree;
  // True when the entry got empty-scope: it stays in the model and is never eligible.
  emptyScope: boolean;
  checkLines: readonly number[];
  diagnostic(name: string, line?: number): Diagnostic;
}

export interface ParsedInput {
  model: DocumentModel;
  collected: Collected;
  placeOf: WeakMap<Entry, EntryPlace>;
}

interface ReadEntry { result: EntryResult; fileFiles: readonly string[]; place: FilePlace }
type FilePlace = Pick<EntryPlace, "base" | "tree">;

const parsedModels = new WeakMap<DocumentModel, ParsedInput>();

export function parse(input: LoreInput): DocumentModel {
  return parseWithContext(input).model;
}

// The context parse or parseWithContext built a model with, while that model object lives.
export function parsedContextOf(model: DocumentModel): ParsedInput | undefined {
  return parsedModels.get(model);
}

export function parseWithContext(input: LoreInput): ParsedInput {
  const collected = collect(input);
  const errors: Diagnostic[] = [...collected.diagnostics];
  const read: ReadEntry[] = [];
  for (const file of collected.files) {
    const lore = parseFile(file.file, file.content);
    const categories = new Set(file.categories);
    const blocks = readFileBlocks(lore, categories);
    if ("error" in blocks || lore.diagnostics.length > 0) {
      errors.push("error" in blocks ? blocks.error : lore.diagnostics[0]!);
      continue;
    }
    const context: FileContext = {
      base: file.base, filePrefix: filePrefixOf(file.file), prefix: file.tree === "repo" ? "" : EXTERNAL, loreRoot: file.loreRoot, categories,
      defaults: blocks.defaults, scope: resolveScope(file.base, blocks.scope),
    };
    const fileFiles = blocks.scope.files ?? DEFAULT_FILES;
    const place = { base: file.base, tree: file.tree };
    for (const node of lore.nodes) if (node.kind === "entry") read.push({ result: readEntry(lore, node, context), fileFiles, place });
  }

  const uses = new Map<string, number>();
  for (const { result: { id } } of read) if (id !== null) uses.set(id, (uses.get(id) ?? 0) + 1);
  const entries: Entry[] = [];
  const warnings: Diagnostic[] = [];
  const placeOf = new WeakMap<Entry, EntryPlace>();
  for (const { result, fileFiles, place } of read) {
    if ("error" in result) errors.push(result.error);
    else if (uses.get(result.id)! > 1) errors.push(result.diagnostic("duplicate-id"));
    else {
      entries.push(result.entry);
      if (result.entry.kind === "rule" && result.entry.category === null) warnings.push(result.diagnostic("missing-category"));
      const own = result.ownScope;
      const emptyScope = own !== null && own.files.every((glob) => fileFiles.every((outer) => disjoint(glob, outer)));
      if (emptyScope) warnings.push(result.diagnostic("empty-scope", own.line));
      placeOf.set(result.entry, { ...place, emptyScope, checkLines: result.checkLines, diagnostic: result.diagnostic });
    }
  }
  warnings.push(...unknownDisabledIds(collected, read));
  const model = { entries, errors: errors.sort(compareDiagnostics), warnings: warnings.sort(compareDiagnostics) };
  const parsed = { model, collected, placeOf };
  parsedModels.set(model, parsed);
  return parsed;
}

function filePrefixOf(name: string): string {
  return name.startsWith(RULES) ? RULES : name.startsWith(EXTERNAL) ? EXTERNAL : "";
}

// A governed list can switch off every entry whose id counts; a given folder's list only those of its trees.
function unknownDisabledIds(collected: Collected, read: readonly ReadEntry[]): Diagnostic[] {
  const counted = read.filter(({ result }) => result.id !== null);
  const idsOf = (trees: readonly Tree[]) =>
    new Set(counted.filter(({ place }) => trees.includes("repo") || trees.includes(place.tree)).map(({ result }) => result.id!));
  const found: Diagnostic[] = [];
  for (const config of collected.configs) {
    if (config.trees.length === 0 || config.disable.length === 0) continue;
    const known = idsOf(config.trees);
    for (const item of config.disable) {
      if (!known.has(item.id)) found.push({ name: "unknown-disabled-id", file: config.file, entry: null, line: item.line, range: item.range });
    }
  }
  return found;
}

export type FileBlocks =
  | { error: Diagnostic }
  | { defaults: FileContext["defaults"]; scope: { files?: string[]; ignores?: string[] } };

// The scan keeps only the elements before its own error, so any block error comes first.
export function readFileBlocks(lore: LoreFile, categories: ReadonlySet<string>): FileBlocks {
  const values: Record<string, unknown> = {};
  for (const node of lore.nodes) {
    if (node.kind !== "block") continue;
    const read = readFileBlock(node, categories);
    if ("problem" in read) return { error: lineDiagnostic(read.problem.name, lore, null, read.problem.line) };
    values[node.name] = read.value;
  }
  return {
    defaults: (values.defaults as FileContext["defaults"] | undefined) ?? {},
    scope: (values.scope as { files?: string[]; ignores?: string[] } | undefined) ?? {},
  };
}

function readFileBlock(node: BlockNode, categories: ReadonlySet<string>): { problem: BlockProblem } | { value: unknown } {
  const contents = dedent(node.body);
  if (contents.error !== null) return { problem: { name: contents.error, line: node.openLine } };
  const read = readBlock(contents.lines, node.openLine + 1, node.closeLine);
  if (read.diagnostic !== null) return { problem: read.diagnostic };
  const problem = node.name === "defaults" ? checkDefaults(read.value, node.openLine) : checkScope(read.value, node.openLine);
  if (problem !== null) return { problem };
  const category = node.name === "defaults" ? (read.value as FileContext["defaults"]).category : undefined;
  if (category !== undefined && !categories.has(category)) return { problem: { name: "unknown-category", line: node.openLine } };
  return { value: read.value };
}

export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    compareCodePoints(a.file, b.file) ||
    a.line - b.line ||
    compareCodePoints(a.name, b.name) ||
    (a.entry === b.entry ? 0 : a.entry === null ? -1 : b.entry === null ? 1 : compareCodePoints(a.entry, b.entry))
  );
}
