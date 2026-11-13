import {
  FINDINGS, lockRefs, lockRefsHolding, readReviews, type AuditResult, type Finding, type LockFile, type LockRef, type ParsedInput, type Withheld,
} from "@lore/parser";
import { InputError } from "./errors";
import { unreadWarnings, type UnreadFile } from "./input";

export function loadLocks(parsed: ParsedInput, readLock: (ref: LockRef) => string | null): LockFile[] {
  const locks: LockFile[] = [];
  for (const ref of lockRefs(parsed)) {
    const content = readLock(ref);
    if (content === null) continue;
    const read = readReviews(content);
    if ("problem" in read) throw new InputError(`malformed lock file ${ref.path} line ${read.line}: ${read.problem}`);
    locks.push({ ...ref, records: read.records });
  }
  return locks;
}

// The lock files whose records must not be taken for orphans: a file warned lore-file-not-read lies under their Lore root.
export function withheldLocks(parsed: ParsedInput, unread: readonly UnreadFile[]): Withheld[] {
  const { collected } = parsed;
  const warned = new Set(unreadWarnings(unread, collected).map(({ file }) => file));
  return unread
    .filter(({ file }) => warned.has(file))
    .flatMap(({ file, given }) =>
      lockRefsHolding(collected, file, given === null ? "repo" : collected.repositoryGiven.indexOf(given)).map((ref) => ({ ...ref, file })));
}

export function unjudgedLines(result: Pick<AuditResult, "unjudged">): string {
  return result.unjudged.map(({ file, reason }) => `lore: orphan-review not checked in ${file}: its Lore root is not wholly collected (${reason})\n`).join("");
}

export function renderAudit(result: AuditResult): string {
  const groups: string[] = [];
  let file: string | null = null;
  let lines: string[] = [];
  for (const finding of result.findings) {
    if (finding.file !== file) {
      if (file !== null) groups.push(lines.join("\n"));
      file = finding.file;
      lines = [file];
    }
    lines.push(`  ${findingLine(finding)}`);
  }
  if (file !== null) groups.push(lines.join("\n"));
  const { counts, rulesWithSource, rulesWithoutSource } = result.summary;
  const summary = FINDINGS.flatMap((name) => (counts[name] === undefined ? [] : [`${name}: ${counts[name]}`]));
  summary.push(`rules with a source: ${rulesWithSource}, without: ${rulesWithoutSource}`);
  return `${[...groups, summary.join("\n")].join("\n\n")}\n`;
}

export function findingLine({ level, name, rule, source, reason }: Finding): string {
  const parts: string[] = [level, name, rule ?? "-"];
  if (source !== null) {
    const heading = source.heading === null ? "" : `#${source.heading}`;
    const phrase = source.phrase === null ? "" : ` "${source.phrase}"`;
    parts.push(`${source.file}${heading}${phrase}`);
  }
  if (reason !== null) parts.push(reason);
  return parts.join("  ");
}
