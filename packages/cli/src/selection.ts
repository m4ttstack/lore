import type { Change, Diagnostic, DocumentModel, EligibilityResult, Entry } from "@lore/parser";

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

export function toSelection(
  model: DocumentModel,
  result: EligibilityResult,
  change: Change,
  readSrc: (file: string) => string | null,
): Selection {
  const entries = new Map<string, Entry>(model.entries.map((entry) => [entry.id, entry]));
  const rules: SelectedRule[] = [];
  const context: SelectedContext[] = [];
  for (const id of result.eligible) {
    const entry = entries.get(id)!;
    if (entry.kind === "context") {
      context.push({
        id, file: entry.file, summary: entry.summary, prose: entry.prose,
        src: entry.src, srcText: entry.src === null ? null : readSrc(entry.src),
      });
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
    warnings: result.warnings,
  };
}
