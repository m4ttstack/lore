import { astGrepAvailable, astGrepLanguage, astGrepSpans } from "./astgrep";
import { EXTERNAL, LOOSE, collect, disabledFor, type Collected, type Tree } from "./collect";
import { matchFromBase } from "./glob";
import { compareDiagnostics, parseWithContext, parsedContextOf, type EntryPlace, type ParsedInput } from "./model";
import { RegexLimitError, shown, toRegExp } from "./regex";
import { compareCodePoints } from "./text";
import type {
  Change, ChangedFile, ChangedLine, Diagnostic, DocumentModel, EligibilityResult, Entry, Hit, LoreInput, SelectOptions, Untriggered,
} from "./types";

// newPath is null for a deleted file, which has no added lines; oldPath is null for an added file, which has no removed lines.
interface Changed { paths: string[]; newPath: string | null; oldPath: string | null; added: ChangedLine[]; removed: ChangedLine[] }
interface Selected { entry: Entry; place: EntryPlace; counted: Changed[] }
type Place = Pick<EntryPlace, "base" | "tree">;
type Regexes = (pattern: string) => RegExp;
type LineTest = (text: string) => boolean;

const DEFAULT_BINARY = "ast-grep";
const AST_GREP_RUNS_AT_ONCE = 8;

export async function select(input: LoreInput, change: Change, options: SelectOptions = {}): Promise<EligibilityResult> {
  return selectParsed(input, parseWithContext(input), change, options);
}

// select for a caller that parsed the input already; parsed must come from parseWithContext(input).
export async function selectParsed(input: LoreInput, parsed: ParsedInput, change: Change, options: SelectOptions = {}): Promise<EligibilityResult> {
  return (await selectDetailed(input, parsed, change, options)).result;
}

// selectParsed's result, with the rules whose scope covers a changed path but whose <when> did not hold.
export async function selectDetailed(
  input: LoreInput,
  parsed: ParsedInput,
  change: Change,
  options: SelectOptions = {},
): Promise<{ result: EligibilityResult; untriggered: Untriggered[] }> {
  const { model, collected, placeOf } = parsed;
  const capabilities = new Set(options.capabilities ?? []);
  const candidates = model.entries.filter((entry) => !neverEligible(entry, placeOf.get(entry)!));
  const regexes = compileRegexes(candidates, capabilities.has("regex"));
  const changed = change.files.map(toChanged);
  const everyPath = changed.flatMap((file) => file.paths);

  const selected: Selected[] = [];
  const untriggered: Untriggered[] = [];
  for (const entry of candidates) {
    const place = placeOf.get(entry)!;
    const counted = changed.filter((file) => counts(collected, entry, place, file.paths));
    if (counted.length === 0) continue;
    if (entry.when !== null && !conditionsHold(entry.when, place.base, counted, everyPath, regexes)) {
      if (entry.kind === "rule") untriggered.push({ id: entry.id, paths: countedPaths(collected, entry, place, counted) });
      continue;
    }
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
  const result = {
    eligible: selected.map(({ entry }) => entry.id).sort(compareCodePoints),
    hits: checks.hits.sort(compareHits),
    excluded: model.errors,
    warnings: warnings.sort(compareDiagnostics),
  };
  return { result, untriggered: untriggered.sort((a, b) => compareCodePoints(a.id, b.id)) };
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
  if (file.kind === "R") return { paths: [file.oldPath, file.path], newPath: file.path, oldPath: file.oldPath, added: file.added, removed: file.removed };
  if (file.kind === "D") return { paths: [file.path], newPath: null, oldPath: file.path, added: [], removed: file.removed };
  if (file.kind === "A") return { paths: [file.path], newPath: file.path, oldPath: null, added: file.added, removed: [] };
  return { paths: [file.path], newPath: file.path, oldPath: file.path, added: file.added, removed: file.removed };
}

// A file counts when one of its paths is in scope and the entry is not switched off for every such path.
function counts(collected: Collected, entry: Entry, place: Place, paths: readonly string[]): boolean {
  const scoped = paths.filter((path) => inScope(entry, place.base, path));
  return scoped.length > 0 && !scoped.every((path) => disabledFor(collected, entry.id, path, place.tree));
}

function countedPaths(collected: Collected, entry: Entry, place: Place, counted: readonly Changed[]): string[] {
  const paths = counted.flatMap((file) => file.paths).filter((path) => inScope(entry, place.base, path) && !disabledFor(collected, entry.id, path, place.tree));
  return [...new Set(paths)].sort(compareCodePoints);
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
  const onLine = (side: "added" | "removed", test: (text: string) => boolean) =>
    counted.some((file) => file[side].some(({ text }) => test(text)));
  const anyChanged = (globs: readonly string[]) => everyPath.some((path) => globs.some((glob) => matchFromBase(base, glob, path)));
  return Object.entries(when).every(([condition, values]) => {
    switch (condition) {
      case "addedContains":
      case "removedContains":
        return onLine(condition === "addedContains" ? "added" : "removed", (text) => values.some((value) => text.includes(value)));
      case "addedMatches":
      case "removedMatches": {
        const patterns = values.map(regexes);
        return onLine(condition === "addedMatches" ? "added" : "removed", (text) => patterns.some((pattern) => pattern.test(text)));
      }
      case "droppedContains":
      case "droppedMatches": {
        const items = condition === "droppedContains" ? itemTests(values, [], regexes) : itemTests([], values, regexes);
        return counted.some((file) => dropped(file, items).length > 0);
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

// The number of unchanged lines before a changed line of the file; lines with the same number are in the same edit.
function editOf(file: Changed): (side: "added" | "removed", line: ChangedLine) => number {
  const numbers = {
    added: file.added.map(({ line }) => line).sort((a, b) => a - b),
    removed: file.removed.map(({ line }) => line).sort((a, b) => a - b),
  };
  return (side, { line }) => line - 1 - countBelow(numbers[side], line);
}

function countBelow(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

// The file's removed lines that an item finds while no added line of the same edit matches that item.
function dropped(file: Changed, items: readonly LineTest[]): ChangedLine[] {
  if (items.length === 0 || file.removed.length === 0) return [];
  const edit = editOf(file);
  const addedBack = items.map((test) => new Set(file.added.filter(({ text }) => test(text)).map((line) => edit("added", line))));
  return file.removed.filter((line) => items.some((test, n) => test(line.text) && !addedBack[n]!.has(edit("removed", line))));
}

function itemTests(contains: readonly string[] = [], matches: readonly string[] = [], regexes: Regexes): LineTest[] {
  return [
    ...contains.map((value): LineTest => (text) => text.includes(value)),
    ...matches.map(regexes).map((pattern): LineTest => (text) => pattern.test(text)),
  ];
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
    const patterns = [
      ...(entry.when?.addedMatches ?? []),
      ...(entry.when?.removedMatches ?? []),
      ...(entry.when?.droppedMatches ?? []),
      ...(regexChecks ? entry.checks.filter((check) => check.lang === "regex").map((check) => check.body) : []),
    ];
    for (const pattern of patterns) {
      try {
        compile(pattern);
      } catch (error) {
        if (!(error instanceof RegexLimitError)) throw error;
        throw new RegexLimitError(`${shown(entry.file)} entry ${shown(entry.id)}: ${error.message}`, { cause: error });
      }
    }
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
  const hit = (rule: string, file: string, { line, text }: ChangedLine, side?: "old") =>
    hits.set(`${rule}\0${side ?? "new"}\0${file}\0${line}`, side === undefined ? { rule, file, line, text } : { rule, file, line, text, side });
  let available: Promise<boolean> | undefined;
  const astGrep = support.astGrep;
  const astGrepReady = () => (available ??= astGrep === null ? Promise.resolve(false) : astGrepAvailable(astGrep));

  for (const { entry, place, counted } of selected) {
    const searched = counted.filter((file) => file.newPath !== null && file.added.length > 0) as (Changed & { newPath: string })[];
    if (entry.kind === "rule") {
      const found = lineConditions(entry.when?.addedContains, entry.when?.addedMatches, support.regexes);
      if (found !== null) for (const file of searched) for (const added of file.added) if (found(added.text)) hit(entry.id, file.newPath, added);
      const foundRemoved = lineConditions(entry.when?.removedContains, entry.when?.removedMatches, support.regexes);
      if (foundRemoved !== null) {
        for (const file of counted) {
          if (file.oldPath === null) continue;
          for (const removed of file.removed) if (foundRemoved(removed.text)) hit(entry.id, file.oldPath, removed, "old");
        }
      }
      const droppedItems = itemTests(entry.when?.droppedContains, entry.when?.droppedMatches, support.regexes);
      for (const file of counted) {
        if (file.oldPath === null) continue;
        for (const removed of dropped(file, droppedItems)) hit(entry.id, file.oldPath, removed, "old");
      }
    }
    const unknownLanguage = new Set<string>();
    const failedFiles = new Set<string>();
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
              if (!failedFiles.has(file.newPath)) warnings.push({ name: "ast-grep-failed", file: file.newPath, entry: entry.id, line: 1 });
              failedFiles.add(file.newPath);
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

// A line that a contains or matches condition of its side finds is a hit, as a check's would be.
function lineConditions(contains: readonly string[] = [], matches: readonly string[] = [], regexes: Regexes): ((text: string) => boolean) | null {
  const patterns = matches.map(regexes);
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
  const givenTrees = new Map<Tree, Set<string>>();
  const givenPaths = (tree: Tree) => {
    let paths = givenTrees.get(tree);
    if (paths === undefined) {
      const files = tree === "repo" ? [] : collected.repositoryFiles[collected.trees[tree]!.repository]!;
      givenTrees.set(tree, (paths = new Set(files.map((file) => file.path))));
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
      ? givenPaths(place.tree).has(src.slice(outside.length))
      : governed.has(src);
    if (!found) missing.push(place.diagnostic("missing-src-target"));
  }
  return missing;
}

function compareHits(a: Hit, b: Hit): number {
  const side = (hit: Hit) => (hit.side === "old" ? 1 : 0);
  return compareCodePoints(a.rule, b.rule) || compareCodePoints(a.file, b.file) || side(a) - side(b) || a.line - b.line;
}
