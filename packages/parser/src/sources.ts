import { createHash } from "node:crypto";
import { MARKDOWN } from "./blocks";
import { closesFence, opensFence } from "./scan";
import type { Source } from "./types";

export type SourceContent = string | Uint8Array | null;
export type Resolved =
  | { ok: true; hash: string; ambiguous: boolean }
  | { ok: false; reason: "file" | "heading" | "phrase" };

interface Heading { line: number; level: number; text: string }

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const LINE_BREAK = /\r\n|\r|\n/;

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, "").replace(/ /g, "-");
}

export function normalizeText(text: string): string {
  const out: string[] = [];
  for (const line of text.split(LINE_BREAK)) {
    const trimmed = line.trimEnd();
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

function headingsOf(lines: string[]): Heading[] {
  const found: Heading[] = [];
  let fence: { char: string; length: number } | null = null;
  lines.forEach((line, index) => {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      return;
    }
    fence = opensFence(line);
    if (fence !== null) return;
    const match = HEADING.exec(line);
    if (match === null) return;
    const rest = (match[2] ?? "").trimEnd().replace(/(?:^|[ \t]+)#+$/, "").trim();
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
      if (/\s/.test(char)) {
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
  return text.replace(/\s+/g, " ");
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
    const matchLine = lineAt[at]!;
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
