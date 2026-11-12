import { lstatSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  lockPathFor, missingReason, orphanRecords, resolveSource, writeReviews,
  type Entry, type Finding, type LockFile, type LockRef, type ParsedInput, type ReviewRecord,
} from "@lore/parser";
import type { ReviewCommand } from "./args";
import { findingLine, loadLocks, withheldLocks } from "./audit";
import { InputError, UsageError } from "./errors";
import { readContained } from "./git";
import type { BuiltInput } from "./input";

export interface Reviewed { out: string; err: string; refused: boolean }

// Every usage error and every lock file is checked before anything is written.
export function review(parsed: ParsedInput, built: BuiltInput, command: ReviewCommand, date: string): Reviewed {
  const { collected, placeOf } = parsed;
  const rules = namedRules(parsed, command);
  const onDisk = (ref: LockRef) => built.onDisk(ref, collected);
  const locks = new Map(loadLocks(parsed, (ref) => readOnDisk(onDisk(ref), ref.path)).map((lock) => [keyOf(lock), lock]));

  const out: string[] = [];
  const err: string[] = [];
  const fresh = new Map<string, { ref: LockRef; records: ReviewRecord[]; rules: Set<string> }>();
  const refused = new Set<string>();
  for (const rule of rules) {
    const place = placeOf.get(rule)!;
    const records: ReviewRecord[] = [];
    const problems: Finding[] = [];
    for (const source of rule.sources) {
      const found = (name: Finding["name"], level: Finding["level"], reason: string | null = null): Finding =>
        ({ name, level, rule: rule.id, file: rule.file, source, reason });
      const content = built.readSourceContent(place, source.file, collected);
      if (content === undefined) {
        problems.push(found("source-unchecked", "error"));
        continue;
      }
      const resolved = resolveSource(source, content);
      if (!resolved.ok) {
        problems.push(found("source-missing", "error", missingReason(source, resolved.reason)));
        continue;
      }
      if (resolved.ambiguous) err.push(`lore: ${findingLine(found("ambiguous-heading", "warn"))}\n`);
      records.push({ rule: rule.id, ...source, reviewed: date, hash: resolved.hash });
    }
    err.push(...problems.map((problem) => `lore: ${findingLine(problem)}\n`));
    if (problems.length > 0) {
      refused.add(rule.id);
      out.push(`refused ${rule.id} (${count(problems.length, "source does not", "sources do not")} resolve)\n`);
      continue;
    }
    const ref = lockPathFor(place);
    const lock = fresh.get(keyOf(ref)) ?? { ref, records: [], rules: new Set<string>() };
    lock.records.push(...records);
    lock.rules.add(rule.id);
    fresh.set(keyOf(ref), lock);
    out.push(`reviewed ${rule.id} (${count(records.length, "source", "sources")})\n`);
  }

  const orphans = new Map(
    orphanRecords(parsed, [...locks.values()], withheldLocks(parsed, built.unread))
      .map(({ lock, records }) => [keyOf(lock), new Set(records.filter((record) => !refused.has(record.rule)))]),
  );
  const writes: { ref: LockRef; text: string }[] = [];
  for (const key of new Set([...locks.keys(), ...fresh.keys()])) {
    const lock: LockFile | undefined = locks.get(key);
    const written = fresh.get(key);
    const ref = lock ?? written!.ref;
    const current = lock?.records ?? [];
    const pruned = current.filter((record) => orphans.get(key)?.has(record) && !written?.rules.has(record.rule));
    const next = [...current.filter((record) => !orphans.get(key)?.has(record) && !written?.rules.has(record.rule)), ...(written?.records ?? [])];
    const text = writeReviews(next);
    if (lock === undefined ? next.length === 0 : text === writeReviews(current)) continue;
    writes.push({ ref, text });
    if (pruned.length > 0) out.push(`pruned ${count(pruned.length, "record", "records")} from ${ref.path}\n`);
  }
  for (const { ref, text } of writes) writeAtomically(onDisk(ref), ref.path, text);
  return { out: out.join(""), err: err.join(""), refused: refused.size > 0 };
}

function namedRules(parsed: ParsedInput, command: ReviewCommand): Entry[] {
  const { model, collected } = parsed;
  const rules = model.entries.filter((entry) => entry.kind === "rule");
  const named: Entry[] = [];
  for (const id of command.ids) {
    const rule = rules.find((candidate) => candidate.id === id);
    if (rule === undefined) {
      const error = model.errors.find((candidate) => candidate.entry === id);
      if (error === undefined) throw new UsageError(`no rule with id ${id}`);
      throw new UsageError(`rule ${id} was excluded: ${error.name} in ${error.file} line ${error.line}`);
    }
    if (rule.sources.length === 0) throw new UsageError(`rule ${id} has no <source>`);
    named.push(rule);
  }
  for (const file of command.files) {
    if (!collected.files.some((candidate) => candidate.file === file)) throw new UsageError(`not a collected Lore file: ${file}`);
    named.push(...rules.filter((rule) => rule.file === file && rule.sources.length > 0));
  }
  return [...new Set(named)];
}

// The working tree's lock file, tracked or not, since an earlier run may not be staged yet.
function readOnDisk(at: { root: string; path: string } | undefined, shown: string): string | null {
  if (at === undefined) throw new InputError(`cannot read lock file ${shown}`);
  try {
    lstatSync(join(at.root, at.path));
  } catch {
    return null;
  }
  const text = readContained(at.root, at.path);
  if (text === null) throw new InputError(`cannot read lock file ${shown}`);
  return text;
}

// Written beside the lock file and renamed over it, so an interrupted run leaves the old file or the new one.
function writeAtomically(at: { root: string; path: string } | undefined, shown: string, text: string): void {
  if (at === undefined) throw new InputError(`cannot write lock file ${shown}`);
  const target = join(at.root, at.path);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, text);
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new InputError(`cannot write lock file ${shown}: ${(error as Error).message}`);
  }
}

function keyOf(ref: LockRef): string {
  return JSON.stringify([ref.tree, ref.path]);
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
