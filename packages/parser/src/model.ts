import { checkDefaults, checkScope } from "./blocks";
import { dedent, dedentEntry } from "./indent";
import { parseFile, readAttributes, type BlockNode, type EntryNode, type LoreFile } from "./scan";
import type { Diagnostic, DocumentModel, Entry, LoreInput } from "./types";
import { readBlock } from "./yaml";

// Minimal assembly so the Parsing sections' examples can run; Task 4 replaces this module.

const LORE_FOLDER = ".lore";
const ID = /^[a-z][a-z0-9-]*$/;

export function parse(input: LoreInput): DocumentModel {
  const entries: Entry[] = [];
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const files = input.repo
    .map((file) => ({ file, base: baseOf(file.path) }))
    .filter((f): f is { file: { path: string; content: string }; base: string } => f.base !== null)
    .sort((a, b) => compareCodePoints(a.file.path, b.file.path));

  for (const { file, base } of files) {
    const lore = parseFile(file.path, file.content);
    const fileError = firstBlockError(lore) ?? lore.diagnostics[0];
    if (fileError !== undefined) {
      errors.push(fileError);
      continue;
    }
    for (const node of lore.nodes) {
      if (node.kind !== "entry") continue;
      const read = readEntry(lore, node, base);
      if ("error" in read) errors.push(read.error);
      else {
        entries.push(read.entry);
        if (read.entry.kind === "rule" && read.entry.category === null) {
          warnings.push(diagnostic("missing-category", lore, read.entry.id, node.openLine));
        }
      }
    }
  }
  return { entries, errors: errors.sort(compareDiagnostics), warnings: warnings.sort(compareDiagnostics) };
}

function baseOf(path: string): string | null {
  const segments = path.split("/");
  if (!segments.at(-1)!.endsWith(".lore")) return null;
  const folder = segments.indexOf(LORE_FOLDER);
  if (folder === -1 || folder === segments.length - 1) return null;
  return segments.slice(0, folder).join("/");
}

// The scan keeps only the elements before its own error, so any block error comes first.
function firstBlockError(lore: LoreFile): Diagnostic | undefined {
  for (const node of lore.nodes) {
    if (node.kind !== "block") continue;
    const problem = blockProblem(node);
    if (problem !== null) return diagnostic(problem.name, lore, null, problem.line);
  }
  return undefined;
}

function blockProblem(node: BlockNode): { name: string; line: number } | null {
  const contents = dedent(node.body);
  if (contents.error !== null) return { name: contents.error, line: node.openLine };
  const read = readBlock(contents.lines, node.openLine + 1, node.closeLine);
  if (read.diagnostic !== null) return read.diagnostic;
  return node.name === "defaults" ? checkDefaults(read.value, node.openLine) : checkScope(read.value, node.openLine);
}

function readEntry(lore: LoreFile, node: EntryNode, base: string): { entry: Entry } | { error: Diagnostic } {
  const list = readAttributes(node.attributes.text);
  const firstId = list.attributes.find((a) => a.name === "id")?.value;
  const id = firstId !== undefined && firstId !== null && ID.test(firstId) ? firstId : null;
  const fail = (name: string, line = node.openLine) => ({ error: diagnostic(name, lore, id, line) });

  if (list.malformedAt !== null) return fail("invalid-attribute-value");
  if (firstId === undefined) return fail("missing-id");
  if (id === null) return fail("invalid-id");
  const contents = dedentEntry(lore.text.lines, node);
  if (contents.inconsistent) return fail("inconsistent-indentation");
  for (const [n, child] of node.children.entries()) {
    if (readAttributes(child.attributes.text).malformedAt !== null) return fail("invalid-attribute-value", child.openLine);
    if (contents.children[n]!.inconsistent) return fail("inconsistent-indentation", child.openLine);
  }

  const value = (name: string) => list.attributes.find((a) => a.name === name)?.value ?? null;
  const isRule = node.name === "rule";
  const prose = dropTrailingBlank(contents.prose);
  return {
    entry: {
      kind: node.name, id, file: lore.path,
      category: isRule ? value("category") : null,
      severity: isRule ? (value("severity") as Entry["severity"]) ?? "advisory" : null,
      disabled: list.attributes.some((a) => a.name === "disabled"),
      scopes: [{ files: [base === "" ? "**" : `${base}/**`], ignores: [] }],
      when: null, checks: [], meta: null,
      summary: summaryOf(prose), prose: prose.join("\n"), src: null,
    },
  };
}

function dropTrailingBlank(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  return lines.slice(0, end);
}

function summaryOf(prose: string[]): string {
  const blank = prose.indexOf("");
  const paragraph = blank === -1 ? prose : prose.slice(0, blank);
  return paragraph.map((line) => line.replace(/^[ \t]+|[ \t]+$/g, "")).join(" ");
}

function diagnostic(name: string, lore: LoreFile, entry: string | null, line: number): Diagnostic {
  const content = lore.text.lines[line - 1] ?? "";
  return {
    name, file: lore.path, entry, line,
    range: { start: { line: line - 1, character: 0 }, end: { line: line - 1, character: content.length } },
  };
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
