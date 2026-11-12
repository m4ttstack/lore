import {
  compareCodePoints, compareDiagnostics, type Change, type Diagnostic, type DocumentModel, type EligibilityResult, type Entry, type ParsedInput,
  type Source, type Untriggered,
} from "@lore/parser";
import { UsageError } from "./errors";

export interface SelectedRule {
  id: string;
  file: string;
  category: string | null;
  severity: "blocking" | "advisory";
  summary: string;
  prose: string;
  meta: Record<string, unknown> | null;
  sources: Source[];
  hits: { file: string; line: number; text: string; side?: "old" }[];
  expanded?: true;
}
export interface ListedRule {
  id: string;
  file: string;
  category: string | null;
  severity: "blocking" | "advisory";
  summary: string;
  paths: string[];
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
  change: { kind: "A" | "M" | "D" | "R"; path: string; oldPath: string | null; added: number[]; removed: number[] }[];
  excluded: Diagnostic[];
  warnings: Diagnostic[];
  alsoInScope?: ListedRule[];
}

export interface Listing {
  untriggered: Untriggered[];
  expand: string[];
}

export interface EntrySources {
  read(entry: Entry): string | null;
  diagnostic(entry: Entry, name: string): Diagnostic;
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
    diagnostic: (entry, name) => placeOf.get(entry)!.diagnostic(name),
  };
}

export function toSelection(
  model: DocumentModel,
  result: EligibilityResult,
  change: Change,
  sources: EntrySources,
  unread: Diagnostic[] = [],
  listing?: Listing,
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
        notRead.push(sources.diagnostic(entry, "src-not-read"));
      }
      context.push({ id, file: entry.file, summary: entry.summary, prose: entry.prose, src: entry.src, srcText });
      continue;
    }
    rules.push(selectedRule(entry, result.hits.filter((hit) => hit.rule === id).map(({ file, line, text, side }) => ({ file, line, text, ...(side === undefined ? {} : { side }) }))));
  }
  const selection: Selection = {
    lore: "1",
    rules,
    context,
    conditional: [],
    change: change.files.map((file) => ({
      kind: file.kind,
      path: file.path,
      oldPath: file.kind === "R" ? file.oldPath : null,
      added: file.added.map((added) => added.line),
      removed: file.removed.map((line) => line.line),
    })),
    excluded: result.excluded,
    warnings: [...result.warnings, ...notRead, ...unread].sort(compareDiagnostics),
  };
  if (listing === undefined) return selection;
  const listed = listing.untriggered.map(({ id, paths }) => {
    const entry = entries.get(id)!;
    return { id, file: entry.file, category: entry.category, severity: entry.severity ?? "advisory", summary: entry.summary, paths };
  });
  const unknown = listing.expand.find((id) => !listed.some((rule) => rule.id === id));
  if (unknown !== undefined) {
    if (rules.some((rule) => rule.id === unknown)) throw new UsageError(`--expand ${unknown}: the rule is already selected`);
    throw new UsageError(`--expand ${unknown}: not a rule in scope whose conditions did not hold`);
  }
  const expand = new Set(listing.expand);
  for (const { id } of listed.filter((rule) => expand.has(rule.id))) rules.push({ ...selectedRule(entries.get(id)!, []), expanded: true });
  rules.sort((a, b) => compareCodePoints(a.id, b.id));
  selection.alsoInScope = listed.filter((rule) => !expand.has(rule.id)).sort(compareListed);
  return selection;
}

function selectedRule(entry: Entry, hits: SelectedRule["hits"]): SelectedRule {
  return {
    id: entry.id, file: entry.file, category: entry.category, severity: entry.severity ?? "advisory",
    summary: entry.summary, prose: entry.prose, meta: entry.meta, sources: entry.sources, hits,
  };
}

function compareListed(a: ListedRule, b: ListedRule): number {
  if (a.severity !== b.severity) return a.severity === "blocking" ? -1 : 1;
  return b.paths.length - a.paths.length || compareCodePoints(a.id, b.id);
}
