import { auditSettingsFor, type AuditSettings, type Collected, type CollectedFile, type Repository, type Tree } from "./collect";
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
}

type Found = Omit<Finding, "level">;

const DAY_MS = 86_400_000;

export function lockPathFor(place: EntryPlace): LockRef {
  return { tree: place.tree, path: lockPath(place.prefix, place.loreRoot) };
}

// The lock files an audit reads: one for each Lore root that holds a collected Lore file.
export function lockRefs(parsed: ParsedInput): LockRef[] {
  return [...lockRoots(parsed.collected).values()].map(({ ref }) => ref);
}

export function audit(parsed: ParsedInput, options: AuditOptions): AuditResult {
  const { model, collected, placeOf } = parsed;
  const findings: Finding[] = [];
  const recordsOf = new Map<string, ReviewRecord[]>();
  for (const lock of options.locks) if (!recordsOf.has(lockKey(lock))) recordsOf.set(lockKey(lock), lock.records);
  const live = new Map<string, Set<string>>();
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
    const known = setIn(live, lock);
    for (const source of entry.sources) {
      known.add(identity(entry.id, source));
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

  findings.push(...orphans(parsed, options, live));
  findings.sort(compareFindings);
  const counts: Partial<Record<FindingName, number>> = {};
  for (const name of FINDINGS) {
    const count = findings.filter((finding) => finding.name === name).length;
    if (count > 0) counts[name] = count;
  }
  return { findings, summary: { counts, rulesWithSource, rulesWithoutSource }, excluded: model.errors };
}

// A record is no orphan while the rule it names might only be excluded: an excluded entry with no readable id hides every rule of its Lore root.
function orphans(parsed: ParsedInput, options: AuditOptions, live: ReadonlyMap<string, Set<string>>): Finding[] {
  const { model, collected } = parsed;
  const roots = lockRoots(collected);
  const excluded = new Map<string, Set<string | null>>();
  for (const error of model.errors) {
    const file = collected.files.find((candidate) => candidate.file === error.file);
    if (file !== undefined) setIn(excluded, lockKey(fileLock(file))).add(error.entry);
  }

  const found: Finding[] = [];
  for (const lock of options.locks) {
    const key = lockKey(lock);
    const root = roots.get(key);
    const hidden = excluded.get(key);
    if (root === undefined || hidden?.has(null)) continue;
    const settings = settingsFor(collected, options, root.loreRoot, root.repository, root.loreRoot);
    for (const record of lock.records) {
      if (live.get(key)?.has(identity(record.rule, record)) || hidden?.has(record.rule)) continue;
      const source = { file: record.file, heading: record.heading, phrase: record.phrase };
      report(found, settings, { name: "orphan-review", rule: record.rule, file: lock.path, source, reason: null });
    }
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

function missingReason(source: Source, reason: (Resolved & { ok: false })["reason"]): string {
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

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function dayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / DAY_MS;
}
