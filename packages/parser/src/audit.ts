import { EXTERNAL, LOOSE, RULES, auditSettingsFor, loreRootIn, type AuditSettings, type Collected, type CollectedFile, type Repository, type Tree } from "./collect";
import { FINDINGS, type FindingName, type Level } from "./loreconfig";
import type { EntryPlace, ParsedInput } from "./model";
import { LOCK_NAME, sameSource, type ReviewRecord } from "./reviews";
import { resolveSource, type Resolved, type SourceContent } from "./sources";
import { compareCodePoints } from "./text";
import type { Diagnostic, Source } from "./types";

export interface Finding {
  name: FindingName;
  level: "error" | "warn";
  rule: string | null;
  // The rule's Lore file, or the lock file for orphan-review.
  file: string;
  source: Source | null;
  reason: string | null;
}

export interface AuditResult {
  findings: Finding[];
  summary: { counts: Partial<Record<FindingName, number>>; rulesWithSource: number; rulesWithoutSource: number };
  excluded: Diagnostic[];
}

// Trees of different repositories can give the same path, so a lock file is named by both.
export interface LockRef { tree: Tree; path: string }
export interface LockFile extends LockRef { records: ReviewRecord[] }

export interface AuditOptions {
  today: string;
  // null when the file does not exist, undefined when the files could not be looked at.
  readSource(place: EntryPlace, file: string): SourceContent | undefined;
  locks: readonly LockFile[];
  maxAgeDays?: number;
  levels?: Partial<Record<FindingName, Level>>;
  // Lock files whose records are never orphan-review: a Lore or .loreconfig file under their Lore root could not be read.
  withheld?: readonly LockRef[];
}

type Found = Omit<Finding, "level">;

const DAY_MS = 86_400_000;
const CONFIG_NAME = ".loreconfig";

export function lockPathFor(place: EntryPlace): LockRef {
  return { tree: place.tree, path: lockPath(place.prefix, place.loreRoot) };
}

// The lock files an audit reads: one for each Lore root that holds a collected Lore file.
export function lockRefs(parsed: ParsedInput): LockRef[] {
  return [...lockRoots(parsed.collected).values()].map(({ ref }) => ref);
}

// The lock files of the Lore roots that would hold a file at this prefixed path, in each tree of its repository that reaches it.
// A .loreconfig that no tree reaches may be what would have marked its directory, so it also names the lock file that
// directory's Lore root would have, in each tree of its repository.
export function lockRefsHolding(collected: Collected, file: string, repository: Repository): LockRef[] {
  const prefix = [EXTERNAL, LOOSE, RULES].find((candidate) => file.startsWith(candidate)) ?? "";
  const path = file.slice(prefix.length);
  const dir = dirOf(path);
  if (repository === "repo") return [{ tree: "repo", path: lockPath(prefix, loreRootIn(collected, dir, repository, "")) }];
  const trees = collected.trees.flatMap((info, tree) => (info.repository === repository ? [{ tree, marked: info.marked }] : []));
  const reaching = trees.filter(({ marked }) => within(dir, marked));
  if (reaching.length > 0 || path.split("/").at(-1) !== CONFIG_NAME) {
    return reaching.map(({ tree, marked }) => ({ tree, path: lockPath(prefix, loreRootIn(collected, dir, repository, marked)) }));
  }
  const unmarked = lockPath(prefix, loreRootIn(collected, dir, repository, dir));
  return trees.map(({ tree }) => ({ tree, path: unmarked }));
}

export function audit(parsed: ParsedInput, options: AuditOptions): AuditResult {
  const { model, collected, placeOf } = parsed;
  const findings: Finding[] = [];
  const recordsOf = new Map<string, ReviewRecord[]>();
  for (const lock of options.locks) if (!recordsOf.has(lockKey(lock))) recordsOf.set(lockKey(lock), lock.records);
  let rulesWithSource = 0;
  let rulesWithoutSource = 0;

  for (const entry of model.entries) {
    if (entry.kind !== "rule") continue;
    const place = placeOf.get(entry)!;
    const lock = lockKey(lockPathFor(place));
    const dir = dirOf(entry.file.slice(place.prefix.length));
    const settings = settingsFor(collected, options, dir, repositoryOf(collected, place.tree), place.loreRoot);
    const add = (name: FindingName, source: Source | null, reason: string | null = null) =>
      report(findings, settings, { name, rule: entry.id, file: entry.file, source, reason });

    if (entry.sources.length === 0) {
      rulesWithoutSource++;
      if (entry.meta !== null && Object.hasOwn(entry.meta, "source")) add("meta-source", null);
      continue;
    }
    rulesWithSource++;
    const records = recordsOf.get(lock) ?? [];
    for (const source of entry.sources) {
      const content = options.readSource(place, source.file);
      if (content === undefined) {
        add("source-unchecked", source);
        continue;
      }
      const resolved = resolveSource(source, content);
      if (!resolved.ok) {
        add("source-missing", source, missingReason(source, resolved.reason));
        continue;
      }
      if (resolved.ambiguous) add("ambiguous-heading", source);
      const record = records.find((candidate) => sameSource(candidate, entry.id, source));
      if (record === undefined) {
        add("never-reviewed", source);
        continue;
      }
      if (record.hash !== resolved.hash) add("source-changed", source);
      if (settings.maxAgeDays !== null && dayOf(options.today) - dayOf(record.reviewed) > settings.maxAgeDays) {
        add("review-overdue", source);
      }
    }
  }

  findings.push(...orphans(parsed, options));
  findings.sort(compareFindings);
  const counts: Partial<Record<FindingName, number>> = {};
  for (const name of FINDINGS) {
    const count = findings.filter((finding) => finding.name === name).length;
    if (count > 0) counts[name] = count;
  }
  return { findings, summary: { counts, rulesWithSource, rulesWithoutSource }, excluded: model.errors };
}

function orphans(parsed: ParsedInput, options: AuditOptions): Finding[] {
  const roots = lockRoots(parsed.collected);
  const found: Finding[] = [];
  for (const { lock, records } of orphanRecords(parsed, options.locks, options.withheld)) {
    const { repository, loreRoot } = roots.get(lockKey(lock))!;
    const settings = settingsFor(parsed.collected, options, loreRoot, repository, loreRoot);
    for (const record of records) {
      const source = { file: record.file, heading: record.heading, phrase: record.phrase };
      report(found, settings, { name: "orphan-review", rule: record.rule, file: lock.path, source, reason: null });
    }
  }
  return found;
}

// The records of each lock file that name no rule source of the model. A record is no orphan while the rule it names
// might only be excluded: an excluded Lore file, an excluded entry with no readable id, and a .loreconfig error that may
// leave Lore files uncollected hide every rule of the Lore roots that could hold them. A withheld lock file, or one no
// collected Lore file maps to, has none.
export function orphanRecords(
  parsed: ParsedInput, locks: readonly LockFile[], withheld: readonly LockRef[] = [],
): { lock: LockFile; records: ReviewRecord[] }[] {
  const { model, collected, placeOf } = parsed;
  const roots = lockRoots(collected);
  const held = new Set(withheld.map(lockKey));
  const live = new Map<string, Set<string>>();
  for (const entry of model.entries) {
    if (entry.kind !== "rule") continue;
    const known = setIn(live, lockKey(lockPathFor(placeOf.get(entry)!)));
    for (const source of entry.sources) known.add(identity(entry.id, source));
  }
  const excluded = new Map<string, Set<string | null>>();
  for (const error of model.errors) {
    const file = collected.files.find((candidate) => candidate.file === error.file);
    if (file !== undefined) setIn(excluded, lockKey(fileLock(file))).add(error.entry);
  }
  for (const { file, repository } of collected.hiding) {
    for (const ref of lockRefsHolding(collected, file, repository)) setIn(excluded, lockKey(ref)).add(null);
  }

  const found: { lock: LockFile; records: ReviewRecord[] }[] = [];
  for (const lock of locks) {
    const key = lockKey(lock);
    const hidden = excluded.get(key);
    if (!roots.has(key) || hidden?.has(null) || held.has(key)) continue;
    const records = lock.records.filter((record) => !live.get(key)?.has(identity(record.rule, record)) && !hidden?.has(record.rule));
    if (records.length > 0) found.push({ lock, records });
  }
  return found;
}

function lockRoots(collected: Collected): Map<string, { ref: LockRef; repository: Repository; loreRoot: string }> {
  const roots = new Map<string, { ref: LockRef; repository: Repository; loreRoot: string }>();
  for (const file of collected.files) {
    const ref = fileLock(file);
    roots.set(lockKey(ref), { ref, repository: repositoryOf(collected, file.tree), loreRoot: file.loreRoot });
  }
  return roots;
}

function fileLock(file: CollectedFile): LockRef {
  return { tree: file.tree, path: lockPath(file.prefix, file.loreRoot) };
}

function lockKey(ref: LockRef): string {
  return JSON.stringify([ref.tree, ref.path]);
}

function settingsFor(collected: Collected, options: AuditOptions, dir: string, repository: Repository, loreRoot: string): AuditSettings {
  const settings = auditSettingsFor(collected, dir, repository, loreRoot);
  const levels = { ...settings.levels };
  for (const name of FINDINGS) levels[name] = options.levels?.[name] ?? levels[name];
  return { maxAgeDays: options.maxAgeDays ?? settings.maxAgeDays, levels };
}

function report(findings: Finding[], settings: AuditSettings, found: Found): void {
  const level = settings.levels[found.name];
  if (level === "off") return;
  findings.push({ name: found.name, level, rule: found.rule, file: found.file, source: found.source, reason: found.reason });
}

export function missingReason(source: Source, reason: (Resolved & { ok: false })["reason"]): string {
  if (reason === "file") return `file not found: ${source.file}`;
  return reason === "heading" ? `heading not found: "${source.heading}"` : `phrase not found: "${source.phrase}"`;
}

function compareFindings(a: Finding, b: Finding): number {
  const rule = a.rule === b.rule ? 0 : a.rule === null ? -1 : b.rule === null ? 1 : compareCodePoints(a.rule, b.rule);
  return compareCodePoints(a.file, b.file) || rule || FINDINGS.indexOf(a.name) - FINDINGS.indexOf(b.name);
}

function identity(rule: string, source: Source): string {
  return JSON.stringify([rule, source.file, source.heading, source.phrase]);
}

function setIn<T>(map: Map<string, Set<T>>, key: string): Set<T> {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = new Set<T>();
  map.set(key, created);
  return created;
}

function lockPath(prefix: string, loreRoot: string): string {
  return prefix + (loreRoot === "" ? LOCK_NAME : `${loreRoot}/${LOCK_NAME}`);
}

function repositoryOf(collected: Collected, tree: Tree): Repository {
  return tree === "repo" ? "repo" : collected.trees[tree]!.repository;
}

function within(dir: string, ancestor: string): boolean {
  return ancestor === "" || dir === ancestor || dir.startsWith(`${ancestor}/`);
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function dayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / DAY_MS;
}
