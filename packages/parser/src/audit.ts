import { EXTERNAL, LOOSE, RULES, auditSettingsFor, loreRootIn, type AuditSettings, type Collected, type Repository, type Tree } from "./collect";
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
  // The lock files with records no collected rule has that cover a Lore file the run may not have collected, so that
  // no orphan-review was judged there, each with the reason.
  unjudged: { file: string; reason: string }[];
}

// Given folders of different repositories can give the same path, so a lock file is named by both.
export interface LockRef { repository: Repository; path: string }
export interface LockFile extends LockRef { records: ReviewRecord[] }
// A lock file the caller knows covers a Lore file the run did not collect, such as an unread one.
export interface Withheld extends LockRef { reason: string }
// records: those that belong to no source of a collected rule and name no excluded entry. partial: null when the run
// collected every Lore file the lock file covers, so the records are orphans; otherwise why it may not have.
export interface LockRecords { lock: LockFile; records: ReviewRecord[]; partial: string | null }

export interface AuditOptions {
  today: string;
  // null when the file does not exist, undefined when the files could not be looked at.
  readSource(place: EntryPlace, file: string): SourceContent | undefined;
  locks: readonly LockFile[];
  maxAgeDays?: number;
  levels?: Partial<Record<FindingName, Level>>;
  withheld?: readonly Withheld[];
}

type Found = Omit<Finding, "level">;

const DAY_MS = 86_400_000;

export function lockPathFor(collected: Collected, place: EntryPlace): LockRef {
  return lockOf(collected, place.tree, place.prefix, place.loreRoot);
}

// Two refs name one lock file exactly when their keys are equal.
export function lockKey(ref: LockRef): string {
  return JSON.stringify([ref.repository, ref.path]);
}

// The lock files an audit reads: one for each that covers a collected Lore file.
export function lockRefs(parsed: ParsedInput): LockRef[] {
  return [...lockScopes(parsed.collected).values()].map(({ ref }) => ref);
}

// The lock file that would cover a Lore file at this prefixed path. Null below a directory that a repo key excludes, and
// in a given folder's repository outside every directory marked for the governed repo: no lock file the run reads
// covers a file there.
export function lockRefHolding(collected: Collected, file: string, repository: Repository): LockRef | null {
  const prefix = [EXTERNAL, LOOSE, RULES].find((candidate) => file.startsWith(candidate)) ?? "";
  const dir = dirOf(file.slice(prefix.length));
  if (collected.excluded.some((gone) => gone.repository === repository && within(dir, gone.dir))) return null;
  const tree: Tree = repository === "repo" ? "repo" : collected.trees.findIndex((info) => info.repository === repository && within(dir, info.marked));
  if (tree === -1) return null;
  return lockOf(collected, tree, prefix, loreRootIn(collected, dir, repository, markedOf(collected, tree)));
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
    const lock = lockKey(lockPathFor(collected, place));
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

  const judged = orphanRecords(parsed, options.locks, options.withheld);
  findings.push(...orphans(parsed, options, judged));
  findings.sort(compareFindings);
  const unjudged = judged
    .flatMap(({ lock, partial }) => (partial === null ? [] : [{ file: lock.path, reason: partial }]))
    .sort((a, b) => compareCodePoints(a.file, b.file));
  const counts: Partial<Record<FindingName, number>> = {};
  for (const name of FINDINGS) {
    const count = findings.filter((finding) => finding.name === name).length;
    if (count > 0) counts[name] = count;
  }
  return { findings, summary: { counts, rulesWithSource, rulesWithoutSource }, excluded: model.errors, unjudged };
}

function orphans(parsed: ParsedInput, options: AuditOptions, judged: readonly LockRecords[]): Finding[] {
  const scopes = lockScopes(parsed.collected);
  const found: Finding[] = [];
  for (const { lock, records, partial } of judged) {
    if (partial !== null) continue;
    const { dir, loreRoot } = scopes.get(lockKey(lock))!;
    const settings = settingsFor(parsed.collected, options, dir, lock.repository, loreRoot);
    for (const record of records) {
      const source = { file: record.file, heading: record.heading, phrase: record.phrase };
      report(found, settings, { name: "orphan-review", rule: record.rule, file: lock.path, source, reason: null });
    }
  }
  return found;
}

// The records of each lock file that name no rule source of the model, leaving out those of an excluded entry's id,
// with whether the run collected every Lore file the lock file covers. Only then are they orphans: a rule the run did
// not collect may still exist. A lock file that covers no collected Lore file is left out.
export function orphanRecords(parsed: ParsedInput, locks: readonly LockFile[], withheld: readonly Withheld[] = []): LockRecords[] {
  const { model, collected, placeOf } = parsed;
  const scopes = lockScopes(collected);
  const live = new Map<string, Set<string>>();
  for (const entry of model.entries) {
    if (entry.kind !== "rule") continue;
    const known = setIn(live, lockKey(lockPathFor(collected, placeOf.get(entry)!)));
    for (const source of entry.sources) known.add(identity(entry.id, source));
  }
  const named = new Map<string, Set<string>>();
  const errors = new Map<string, Set<string>>();
  for (const error of model.errors) {
    const file = collected.files.find((candidate) => candidate.file === error.file);
    if (file === undefined) continue;
    const key = lockKey(lockOf(collected, file.tree, file.prefix, file.loreRoot));
    if (error.entry === null) setIn(errors, key).add(error.file);
    else setIn(named, key).add(error.entry);
  }
  const held = new Map<string, Set<string>>();
  for (const lock of withheld) setIn(held, lockKey(lock)).add(lock.reason);

  const found: LockRecords[] = [];
  for (const lock of locks) {
    const key = lockKey(lock);
    if (!scopes.has(key)) continue;
    const records = lock.records.filter((record) => !live.get(key)?.has(identity(record.rule, record)) && !named.get(key)?.has(record.rule));
    if (records.length === 0) continue;
    const error = first(errors.get(key));
    found.push({ lock, records, partial: error === undefined ? (first(held.get(key)) ?? null) : `an error in ${error} may hide rules` });
  }
  return found;
}

function first(files: Set<string> | undefined): string | undefined {
  return files === undefined ? undefined : [...files].sort(compareCodePoints)[0];
}

function lockScopes(collected: Collected): Map<string, { ref: LockRef; dir: string; loreRoot: string }> {
  const scopes = new Map<string, { ref: LockRef; dir: string; loreRoot: string }>();
  for (const file of collected.files) {
    const dir = lockDir(collected, file.tree, file.loreRoot);
    const ref = { repository: repositoryOf(collected, file.tree), path: lockPath(file.prefix, dir) };
    scopes.set(lockKey(ref), { ref, dir, loreRoot: file.loreRoot });
  }
  return scopes;
}

function lockOf(collected: Collected, tree: Tree, prefix: string, loreRoot: string): LockRef {
  return { repository: repositoryOf(collected, tree), path: lockPath(prefix, lockDir(collected, tree, loreRoot)) };
}

// A marked directory starts a lock file's scope as a Lore root does, so the lock file is in the nearer of the two. In
// the governed repo a repo key excludes its directory, so no collected Lore file is below a mark.
function lockDir(collected: Collected, tree: Tree, loreRoot: string): string {
  const marked = markedOf(collected, tree);
  return within(loreRoot, marked) ? loreRoot : marked;
}

function markedOf(collected: Collected, tree: Tree): string {
  return tree === "repo" ? "" : collected.trees[tree]!.marked;
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
