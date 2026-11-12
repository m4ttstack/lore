import { createHash } from "node:crypto";
import { MARKDOWN } from "./blocks";
import type { Source } from "./types";

export type SourceContent = string | Uint8Array | null;
export type Resolved =
  | { ok: true; hash: string; ambiguous: boolean }
  | { ok: false; reason: "file" | "heading" | "phrase" };

interface Heading { line: number; level: number; text: string }
interface Fence { char: string; length: number }

// Only spaces and tabs are whitespace; the s flag lets a heading's text hold U+2028 and U+2029.
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/s;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/s;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const LINE_BREAK = /\r\n|\r|\n/;
const BLANK_RUN = /[ \t\r\n]+/g;

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, "").replace(/ /g, "-");
}

function trimEnd(line: string): string {
  return line.replace(/[ \t]+$/, "");
}

function isSpace(char: string): boolean {
  return char === " " || char === "\t";
}

export function normalizeText(text: string): string {
  const out: string[] = [];
  for (const line of text.split(LINE_BREAK)) {
    const trimmed = trimEnd(line);
    if (trimmed === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(trimmed);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

function digest(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 12);
}

export function fingerprint(text: string | Uint8Array): string {
  return digest(typeof text === "string" ? normalizeText(text) : text);
}

function opensFence(line: string): Fence | null {
  const match = FENCE_OPEN.exec(line);
  if (match === null) return null;
  const run = match[1]!;
  if (run[0] === "`" && match[2]!.includes("`")) return null;
  return { char: run[0]!, length: run.length };
}

function closesFence(line: string, fence: Fence): boolean {
  const run = FENCE_CLOSE.exec(line)?.[1];
  return run !== undefined && run[0] === fence.char && run.length >= fence.length;
}

function headingsOf(lines: string[]): Heading[] {
  const found: Heading[] = [];
  let fence: Fence | null = null;
  lines.forEach((line, index) => {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      return;
    }
    fence = opensFence(line);
    if (fence !== null) return;
    const match = HEADING.exec(line);
    if (match === null) return;
    const rest = trimEnd(match[2] ?? "").replace(/(?:^|[ \t]+)#+$/, "");
    found.push({ line: index, level: match[1]!.length, text: rest });
  });
  return found;
}

function sectionEnd(headings: Heading[], at: number, lineCount: number): number {
  const heading = headings[at]!;
  const next = headings.slice(at + 1).find((candidate) => candidate.level <= heading.level);
  return next === undefined ? lineCount : next.line;
}

function headingMatches(heading: Heading, value: string): boolean {
  if (heading.text === value) return true;
  const wanted = slug(value);
  return wanted !== "" && slug(heading.text) === wanted;
}

function collapse(lines: string[]): { flat: string; lineAt: number[] } {
  let flat = "";
  const lineAt: number[] = [];
  let pendingSpace = -1;
  lines.forEach((line, index) => {
    if (index > 0 && pendingSpace < 0) pendingSpace = index - 1;
    for (const char of line) {
      if (isSpace(char)) {
        if (pendingSpace < 0) pendingSpace = index;
        continue;
      }
      if (pendingSpace >= 0) {
        flat += " ";
        lineAt.push(pendingSpace);
        pendingSpace = -1;
      }
      flat += char;
      for (let unit = 0; unit < char.length; unit++) lineAt.push(index);
    }
  });
  if (pendingSpace >= 0) {
    flat += " ";
    lineAt.push(pendingSpace);
  }
  return { flat, lineAt };
}

function collapseWhitespace(text: string): string {
  return text.replace(BLANK_RUN, " ");
}

export function resolveSource(source: Source, content: SourceContent): Resolved {
  if (content === null) return { ok: false, reason: "file" };
  if (typeof content !== "string") {
    if (source.heading !== null) return { ok: false, reason: "heading" };
    if (source.phrase !== null) return { ok: false, reason: "phrase" };
    return { ok: true, hash: fingerprint(content), ambiguous: false };
  }
  const lines = content.split(LINE_BREAK);
  const whole: Resolved = { ok: true, hash: fingerprint(content), ambiguous: false };
  const markdown = MARKDOWN.test(source.file);
  if (source.heading === null && source.phrase === null) return whole;

  if (source.heading === null) {
    const phrase = collapseWhitespace(source.phrase!);
    const { flat, lineAt } = collapse(lines);
    const at = flat.indexOf(phrase);
    if (at < 0) return { ok: false, reason: "phrase" };
    if (!markdown) return whole;
    const headings = headingsOf(lines);
    let begin = at;
    while (begin < at + phrase.length - 1 && flat[begin] === " ") begin++;
    const matchLine = lineAt[begin]!;
    let owner = -1;
    headings.forEach((heading, index) => { if (heading.line <= matchLine) owner = index; });
    if (owner < 0) return whole;
    const section = lines.slice(headings[owner]!.line, sectionEnd(headings, owner, lines.length));
    return { ok: true, hash: fingerprint(section.join("\n")), ambiguous: false };
  }

  if (!markdown) return { ok: false, reason: "heading" };
  const headings = headingsOf(lines);
  const matching = headings.flatMap((heading, index) => (headingMatches(heading, source.heading!) ? [index] : []));
  if (matching.length === 0) return { ok: false, reason: "heading" };
  const first = matching[0]!;
  const section = lines.slice(headings[first]!.line, sectionEnd(headings, first, lines.length));
  if (source.phrase !== null && !collapse(section).flat.includes(collapseWhitespace(source.phrase))) {
    return { ok: false, reason: "phrase" };
  }
  return { ok: true, hash: fingerprint(section.join("\n")), ambiguous: matching.length > 1 };
}
