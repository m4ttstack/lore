import { astGrepAvailable, astGrepLanguage, astGrepSpans } from "./astgrep";
import { EXTERNAL, LOOSE, collect, disabledFor, type Collected, type Tree } from "./collect";
import { matchFromBase } from "./glob";
import { compareDiagnostics, parseWithContext, parsedContextOf, type EntryPlace } from "./model";
import { toRegExp } from "./regex";
import { compareCodePoints } from "./text";
import type {
  AddedLine, Change, ChangedFile, Diagnostic, DocumentModel, EligibilityResult, Entry, Hit, LoreInput, SelectOptions,
} from "./types";

// newPath is null for a deleted file, which has no added lines.
interface Changed { paths: string[]; newPath: string | null; added: AddedLine[] }
interface Selected { entry: Entry; place: EntryPlace; counted: Changed[] }
type Place = Pick<EntryPlace, "base" | "tree">;
type Regexes = (pattern: string) => RegExp;

const DEFAULT_BINARY = "ast-grep";
const AST_GREP_RUNS_AT_ONCE = 8;

export async function select(input: LoreInput, change: Change, options: SelectOptions = {}): Promise<EligibilityResult> {
  const { model, collected, placeOf } = parseWithContext(input);
  const capabilities = new Set(options.capabilities ?? []);
  const candidates = model.entries.filter((entry) => !neverEligible(entry, placeOf.get(entry)!));
  const regexes = compileRegexes(candidates, capabilities.has("regex"));
  const changed = change.files.map(toChanged);
  const everyPath = changed.flatMap((file) => file.paths);

  const selected: Selected[] = [];
  for (const entry of candidates) {
    const place = placeOf.get(entry)!;
    const counted = changed.filter((file) => counts(collected, entry, place, file.paths));
    if (counted.length === 0) continue;
    if (entry.when !== null && !conditionsHold(entry.when, place.base, counted, everyPath, regexes)) continue;
    selected.push({ entry, place, counted });
  }

  const binary = options.astGrepBinary === undefined ? DEFAULT_BINARY : options.astGrepBinary;
  const repoContents = new Map(input.repo.map((file) => [file.path, file.content]));
  const checks = await runChecks(selected, options.fileContent ?? ((path) => repoContents.get(path)), {
    regex: capabilities.has("regex"),
    astGrep: capabilities.has("ast-grep") ? binary : null,
    regexes,
  });
  const warnings = [...model.warnings, ...srcTargetsMissing(model, placeOf, collected, input, changed), ...checks.warnings];
  return {
    eligible: selected.map(({ entry }) => entry.id).sort(compareCodePoints),
    hits: checks.hits.sort(compareHits),
    excluded: model.errors,
    warnings: warnings.sort(compareDiagnostics),
  };
}

export function coveringEntries(input: LoreInput, model: DocumentModel, path: string): Entry[] {
  const parsed = parsedContextOf(model);
  const collected = parsed?.collected ?? collect(input);
  let byFile: Map<string, Place> | undefined;
  // An entry parse did not place here (a copied model) finds its place through its file.
  const placeOf = (entry: Entry): Place | undefined =>
    parsed?.placeOf.get(entry) ??
    (byFile ??= new Map(collected.files.map((file) => [file.file, { base: file.base, tree: file.tree }]))).get(entry.file);
  return model.entries.filter((entry) => {
    if (entry.disabled) return false;
    const place = placeOf(entry);
    return place !== undefined && inScope(entry, place.base, path) && !disabledFor(collected, entry.id, path, place.tree);
  });
}

function neverEligible(entry: Entry, place: EntryPlace): boolean {
  return entry.disabled || place.emptyScope;
}

function toChanged(file: ChangedFile): Changed {
  if (file.kind === "R") return { paths: [file.oldPath, file.path], newPath: file.path, added: file.added };
  if (file.kind === "D") return { paths: [file.path], newPath: null, added: [] };
  return { paths: [file.path], newPath: file.path, added: file.added };
}

// A file counts when one of its paths is in scope and the entry is not switched off for every such path.
function counts(collected: Collected, entry: Entry, place: Place, paths: readonly string[]): boolean {
  const scoped = paths.filter((path) => inScope(entry, place.base, path));
  return scoped.length > 0 && !scoped.every((path) => disabledFor(collected, entry.id, path, place.tree));
}

function inScope(entry: Entry, base: string, path: string): boolean {
  const matches = (resolved: string) => matchFromBase(base, written(base, resolved), path);
  return entry.scopes.every((scope) => scope.files.some(matches) && !scope.ignores.some(matches));
}

// Scopes hold base/glob strings; the base is matched literally, so the written glob is split back off.
function written(base: string, resolved: string): string {
  return base === "" ? resolved : resolved.slice(base.length + 1);
}

function conditionsHold(
  when: Record<string, string[]>,
  base: string,
  counted: readonly Changed[],
  everyPath: readonly string[],
  regexes: Regexes,
): boolean {
  const addedLine = (test: (text: string) => boolean) => counted.some((file) => file.added.some(({ text }) => test(text)));
  const anyChanged = (globs: readonly string[]) => everyPath.some((path) => globs.some((glob) => matchFromBase(base, glob, path)));
  return Object.entries(when).every(([condition, values]) => {
    switch (condition) {
      case "addedContains":
        return addedLine((text) => values.some((value) => text.includes(value)));
      case "addedMatches": {
        const patterns = values.map(regexes);
        return addedLine((text) => patterns.some((pattern) => pattern.test(text)));
      }
      case "changed":
        return anyChanged(values);
      case "unchanged":
        return !anyChanged(values);
      default:
        return false;
    }
  });
}

// Each pattern of an entry that can be eligible compiles before selection, so one past the engine's limits
// fails every run, not only some.
function compileRegexes(entries: readonly Entry[], regexChecks: boolean): Regexes {
  const compiled = new Map<string, RegExp>();
  const compile = (pattern: string): RegExp => {
    let regex = compiled.get(pattern);
    if (regex === undefined) compiled.set(pattern, (regex = toRegExp(pattern)));
    return regex;
  };
  for (const entry of entries) {
    for (const pattern of entry.when?.addedMatches ?? []) compile(pattern);
    if (regexChecks) for (const check of entry.checks) if (check.lang === "regex") compile(check.body);
  }
  return compile;
}

interface CheckSupport { regex: boolean; astGrep: string | null; regexes: Regexes }

async function runChecks(
  selected: readonly Selected[],
  contentOf: (path: string) => string | null | undefined,
  support: CheckSupport,
): Promise<{ hits: Hit[]; warnings: Diagnostic[] }> {
  const hits = new Map<string, Hit>();
  const warnings: Diagnostic[] = [];
  const runs: (() => Promise<void>)[] = [];
  const hit = (rule: string, file: string, { line, text }: AddedLine) => hits.set(`${rule}\0${file}\0${line}`, { rule, file, line, text });
  let available: Promise<boolean> | undefined;
  const astGrep = support.astGrep;
  const astGrepReady = () => (available ??= astGrep === null ? Promise.resolve(false) : astGrepAvailable(astGrep));

  for (const { entry, place, counted } of selected) {
    const searched = counted.filter((file) => file.newPath !== null && file.added.length > 0) as (Changed & { newPath: string })[];
    if (entry.kind === "rule") {
      const found = addedLineConditions(entry.when, support.regexes);
      if (found !== null) for (const file of searched) for (const added of file.added) if (found(added.text)) hit(entry.id, file.newPath, added);
    }
    const unknownLanguage = new Set<string>();
    for (const [n, check] of entry.checks.entries()) {
      if (check.lang === "regex" && support.regex) {
        const regex = support.regexes(check.body);
        for (const file of searched) for (const added of file.added) if (regex.test(added.text)) hit(entry.id, file.newPath, added);
      } else if (check.lang === "ast-grep" && (await astGrepReady())) {
        let needsFile = false;
        for (const file of searched) {
          const language = astGrepLanguage(file.newPath);
          if (language === null) {
            if (!unknownLanguage.has(file.newPath)) warnings.push({ name: "ast-grep-no-language", file: file.newPath, entry: entry.id, line: 1 });
            unknownLanguage.add(file.newPath);
            continue;
          }
          const content = contentOf(file.newPath);
          if (content === undefined) continue;
          if (content === null) {
            if (!needsFile) warnings.push(place.diagnostic("check-needs-file", place.checkLines[n]));
            needsFile = true;
            continue;
          }
          runs.push(async () => {
            const spans = await astGrepSpans(astGrep!, check.body, language, content);
            if (spans === null) {
              warnings.push({ name: "ast-grep-failed", file: file.newPath, entry: entry.id, line: 1 });
              return;
            }
            for (const added of file.added) if (spans.some(({ first, last }) => first <= added.line && added.line <= last)) hit(entry.id, file.newPath, added);
          });
        }
      } else {
        warnings.push(place.diagnostic("unsupported-check-language", place.checkLines[n]));
      }
    }
  }
  await runAtOnce(runs, AST_GREP_RUNS_AT_ONCE);
  return { hits: [...hits.values()], warnings };
}

// An added line that an addedContains or addedMatches condition finds is a hit, as a check's would be.
function addedLineConditions(when: Record<string, string[]> | null, regexes: Regexes): ((text: string) => boolean) | null {
  const contains = when?.addedContains ?? [];
  const patterns = (when?.addedMatches ?? []).map(regexes);
  if (contains.length === 0 && patterns.length === 0) return null;
  return (text) => contains.some((value) => text.includes(value)) || patterns.some((pattern) => pattern.test(text));
}

async function runAtOnce(runs: readonly (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < runs.length) await runs[next++]!();
  };
  await Promise.all(Array.from({ length: Math.min(limit, runs.length) }, worker));
}

// The missing-src-target warnings with no change: input.repo must list the governed repository's files.
export function missingSrcTargets(input: LoreInput, model: DocumentModel): Diagnostic[] {
  const parsed = parsedContextOf(model) ?? parseWithContext(input);
  return srcTargetsMissing(parsed.model, parsed.placeOf, parsed.collected, input, []);
}

// A target counts when the governed repo, as the change leaves it (or the rules revision, when given), or the context's own repository tracks it.
function srcTargetsMissing(
  model: DocumentModel,
  placeOf: WeakMap<Entry, EntryPlace>,
  collected: Collected,
  input: LoreInput,
  changed: readonly Changed[],
): Diagnostic[] {
  const governed = new Set((input.rules ?? input.repo).map((file) => file.path));
  if (input.rules === undefined) for (const { newPath } of changed) if (newPath !== null) governed.add(newPath);
  const external = new Map<Tree, Set<string>>();
  const externalPaths = (tree: Tree) => {
    let paths = external.get(tree);
    if (paths === undefined) {
      const files = tree === "repo" ? [] : collected.repositoryFiles[collected.trees[tree]!.repository]!;
      external.set(tree, (paths = new Set(files.map((file) => file.path))));
    }
    return paths;
  };
  const missing: Diagnostic[] = [];
  for (const entry of model.entries) {
    if (entry.src === null) continue;
    const place = placeOf.get(entry)!;
    const src = entry.src;
    const outside = [EXTERNAL, LOOSE].find((prefix) => src.startsWith(prefix));
    const found = outside !== undefined
      ? externalPaths(place.tree).has(src.slice(outside.length))
      : governed.has(src);
    if (!found) missing.push(place.diagnostic("missing-src-target"));
  }
  return missing;
}

function compareHits(a: Hit, b: Hit): number {
  return compareCodePoints(a.rule, b.rule) || compareCodePoints(a.file, b.file) || a.line - b.line;
}
