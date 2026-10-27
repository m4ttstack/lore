import { checkDefaults, checkScope } from "./blocks";
import { lineDiagnostic, readEntry, resolveScope, type EntryResult, type FileContext } from "./entries";
import { dedent } from "./indent";
import { parseFile, type BlockNode, type LoreFile } from "./scan";
import type { Diagnostic, DocumentModel, Entry, InputFile, LoreInput } from "./types";
import { readBlock, type BlockProblem } from "./yaml";

const LORE_FOLDER = ".lore";
const REPO_ROOT = "";
export const FIXED_CATEGORIES: ReadonlySet<string> = new Set([
  "functional_correctness", "test_coverage", "security", "performance", "accessibility",
  "observability", "backwards_compatibility", "documentation", "code_style",
]);

export function parse(input: LoreInput): DocumentModel {
  const errors: Diagnostic[] = [];
  const read: EntryResult[] = [];
  for (const { file, base } of loreFiles(input.repo)) {
    const lore = parseFile(file.path, file.content);
    const blocks = readFileBlocks(lore, FIXED_CATEGORIES);
    if ("error" in blocks || lore.diagnostics.length > 0) {
      errors.push("error" in blocks ? blocks.error : lore.diagnostics[0]!);
      continue;
    }
    const context: FileContext = {
      base, loreRoot: REPO_ROOT, categories: FIXED_CATEGORIES,
      defaults: blocks.defaults, scope: resolveScope(base, blocks.scope),
    };
    for (const node of lore.nodes) if (node.kind === "entry") read.push(readEntry(lore, node, context));
  }

  const uses = new Map<string, number>();
  for (const { id } of read) if (id !== null) uses.set(id, (uses.get(id) ?? 0) + 1);
  const entries: Entry[] = [];
  const warnings: Diagnostic[] = [];
  for (const result of read) {
    if ("error" in result) errors.push(result.error);
    else if (uses.get(result.id)! > 1) errors.push(result.diagnostic("duplicate-id"));
    else {
      entries.push(result.entry);
      if (result.entry.kind === "rule" && result.entry.category === null) warnings.push(result.diagnostic("missing-category"));
    }
  }
  return { entries, errors: errors.sort(compareDiagnostics), warnings: warnings.sort(compareDiagnostics) };
}

function loreFiles(repo: InputFile[]): { file: InputFile; base: string }[] {
  return repo
    .flatMap((file) => {
      const base = baseOf(file.path);
      return base === null ? [] : [{ file, base }];
    })
    .sort((a, b) => compareCodePoints(a.file.path, b.file.path));
}

function baseOf(path: string): string | null {
  const segments = path.split("/");
  if (!segments.at(-1)!.endsWith(".lore")) return null;
  const folder = segments.indexOf(LORE_FOLDER);
  if (folder === -1 || folder === segments.length - 1) return null;
  return segments.slice(0, folder).join("/");
}

type FileBlocks =
  | { error: Diagnostic }
  | { defaults: FileContext["defaults"]; scope: { files?: string[]; ignores?: string[] } };

// The scan keeps only the elements before its own error, so any block error comes first.
function readFileBlocks(lore: LoreFile, categories: ReadonlySet<string>): FileBlocks {
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

function compareCodePoints(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const diff = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    compareCodePoints(a.file, b.file) ||
    a.line - b.line ||
    compareCodePoints(a.name, b.name) ||
    (a.entry === b.entry ? 0 : a.entry === null ? -1 : b.entry === null ? 1 : compareCodePoints(a.entry, b.entry))
  );
}
