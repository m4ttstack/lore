import { compareDiagnostics, type Change, type Diagnostic, type DocumentModel, type EligibilityResult, type Entry, type ParsedInput } from "@lore/parser";

export interface SelectedRule {
  id: string;
  file: string;
  category: string | null;
  severity: "blocking" | "advisory";
  summary: string;
  prose: string;
  meta: Record<string, unknown> | null;
  hits: { file: string; line: number; text: string }[];
}
export interface SelectedContext {
  id: string;
  file: string;
  summary: string;
  prose: string;
  src: string | null;
  srcText: string | null;
}
export interface Selection {
  lore: "1";
  rules: SelectedRule[];
  context: SelectedContext[];
  conditional: string[];
  change: { kind: "A" | "M" | "D" | "R"; path: string; oldPath: string | null; added: number[] }[];
  excluded: Diagnostic[];
  warnings: Diagnostic[];
}

export interface EntrySources {
  read(entry: Entry): string | null;
  line(entry: Entry): number;
}

// A context's src is read from the given folder its own entry came from, so equal paths in two places do not collide.
export function entrySources(parsed: ParsedInput, readSrc: (file: string, given?: number) => string | null): EntrySources {
  const { collected, placeOf } = parsed;
  return {
    read(entry) {
      if (entry.src === null) return null;
      const tree = placeOf.get(entry)?.tree;
      const given = tree === undefined || tree === "repo" ? undefined : collected.repositoryGiven[collected.trees[tree]!.repository];
      return readSrc(entry.src, given);
    },
    line: (entry) => placeOf.get(entry)?.diagnostic("src-not-read").line ?? 1,
  };
}

export function toSelection(
  model: DocumentModel,
  result: EligibilityResult,
  change: Change,
  sources: EntrySources,
  unread: Diagnostic[] = [],
): Selection {
  const missing = new Set(result.warnings.filter((warning) => warning.name === "missing-src-target").map((warning) => `${warning.file}\0${warning.entry}`));
  const notRead: Diagnostic[] = [];
  const entries = new Map<string, Entry>(model.entries.map((entry) => [entry.id, entry]));
  const rules: SelectedRule[] = [];
  const context: SelectedContext[] = [];
  for (const id of result.eligible) {
    const entry = entries.get(id)!;
    if (entry.kind === "context") {
      const srcText = sources.read(entry);
      if (entry.src !== null && srcText === null && !missing.has(`${entry.file}\0${id}`)) {
        notRead.push({ name: "src-not-read", file: entry.file, entry: id, line: sources.line(entry) });
      }
      context.push({ id, file: entry.file, summary: entry.summary, prose: entry.prose, src: entry.src, srcText });
      continue;
    }
    rules.push({
      id, file: entry.file, category: entry.category, severity: entry.severity ?? "advisory",
      summary: entry.summary, prose: entry.prose, meta: entry.meta,
      hits: result.hits.filter((hit) => hit.rule === id).map(({ file, line, text }) => ({ file, line, text })),
    });
  }
  return {
    lore: "1",
    rules,
    context,
    conditional: [],
    change: change.files.map((file) => ({
      kind: file.kind,
      path: file.path,
      oldPath: file.kind === "R" ? file.oldPath : null,
      added: file.added.map((added) => added.line),
    })),
    excluded: result.excluded,
    warnings: [...result.warnings, ...notRead, ...unread].sort(compareDiagnostics),
  };
}
