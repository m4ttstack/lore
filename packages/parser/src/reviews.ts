import { compareCodePoints } from "./text";
import type { Source } from "./types";

export const LOCK_NAME = "lore-reviews.lock";

export interface ReviewRecord {
  rule: string;
  file: string;
  heading: string | null;
  phrase: string | null;
  reviewed: string;
  hash: string;
}

const HEADER = '{"lore-reviews":1}';
const KEYS = ["rule", "file", "heading", "phrase", "reviewed", "hash"] as const;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HASH = /^[0-9a-f]{12}$/;

function compareNullable(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return compareCodePoints(a, b);
}

function compareRecords(a: ReviewRecord, b: ReviewRecord): number {
  return (
    compareCodePoints(a.rule, b.rule) ||
    compareCodePoints(a.file, b.file) ||
    compareNullable(a.heading, b.heading) ||
    compareNullable(a.phrase, b.phrase)
  );
}

export function writeReviews(records: readonly ReviewRecord[]): string {
  const lines = [...records].sort(compareRecords).map((r) =>
    JSON.stringify({
      rule: r.rule,
      file: r.file,
      heading: r.heading,
      phrase: r.phrase,
      reviewed: r.reviewed,
      hash: r.hash,
    }),
  );
  return [HEADER, ...lines].join("\n") + "\n";
}

export function isRealDate(text: string): boolean {
  const match = DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

function recordProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "a record must be a JSON object";
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  const missing = KEYS.filter((key) => !(key in object));
  if (missing.length > 0) return `record is missing "${missing[0]}"`;
  const extra = keys.find((key) => !(KEYS as readonly string[]).includes(key));
  if (extra !== undefined) return `record has an unexpected key "${extra}"`;
  for (const key of ["rule", "file"] as const) {
    if (typeof object[key] !== "string") return `"${key}" must be a string`;
  }
  for (const key of ["heading", "phrase"] as const) {
    if (object[key] !== null && typeof object[key] !== "string") return `"${key}" must be a string or null`;
  }
  if (typeof object.reviewed !== "string" || !isRealDate(object.reviewed)) {
    return '"reviewed" must be a real date written YYYY-MM-DD';
  }
  if (typeof object.hash !== "string" || !HASH.test(object.hash)) {
    return '"hash" must be 12 lower-case hexadecimal characters';
  }
  return null;
}

function identity(record: ReviewRecord): string {
  return JSON.stringify([record.rule, record.file, record.heading, record.phrase]);
}

export function readReviews(content: string): { records: ReviewRecord[] } | { problem: string; line: number } {
  const lines = content.split("\n").map((text) => (text.endsWith("\r") ? text.slice(0, -1) : text));
  if (lines[lines.length - 1] === "" && lines.length > 1) lines.pop();

  const header = parseJson(lines[0]!);
  const headerValue = header?.value as Record<string, unknown> | null | undefined;
  const headerOk =
    typeof headerValue === "object" &&
    headerValue !== null &&
    !Array.isArray(headerValue) &&
    Object.keys(headerValue).length === 1 &&
    headerValue["lore-reviews"] === 1;
  if (!headerOk) return { problem: `the first line must be ${HEADER}`, line: 1 };

  const records: ReviewRecord[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const text = lines[i]!;
    const line = i + 1;
    if (text.trim() === "") return { problem: "blank lines are not allowed", line };
    const parsed = parseJson(text);
    if (!parsed) return { problem: "the line is not valid JSON", line };
    const problem = recordProblem(parsed.value);
    if (problem) return { problem, line };
    const record = parsed.value as ReviewRecord;
    const key = identity(record);
    if (seen.has(key)) return { problem: `a second record for rule "${record.rule}" and the same source`, line };
    seen.add(key);
    records.push({
      rule: record.rule,
      file: record.file,
      heading: record.heading,
      phrase: record.phrase,
      reviewed: record.reviewed,
      hash: record.hash,
    });
  }
  return { records };
}

export function sameSource(record: ReviewRecord, rule: string, source: Source): boolean {
  return (
    record.rule === rule &&
    record.file === source.file &&
    record.heading === source.heading &&
    record.phrase === source.phrase
  );
}
