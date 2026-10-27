import type { Position, Range } from "./types";

export interface DecodedText {
  lines: string[];
  lineStarts: number[];
  hadBom: boolean;
  positionAt(offset: number): Position;
  offsetAt(position: Position): number;
}

const BOM = 0xfeff;
const CR = 13;

// Offsets index the content as given; positions skip the BOM and never land on a CRLF's CR, as an editor shows the text.
export function decode(content: string): DecodedText {
  const hadBom = content.charCodeAt(0) === BOM;
  const lines: string[] = [];
  const lineStarts: number[] = [];
  let start = hadBom ? 1 : 0;
  for (;;) {
    lineStarts.push(start);
    const feed = content.indexOf("\n", start);
    if (feed === -1) {
      lines.push(content.slice(start));
      break;
    }
    const end = feed > start && content.charCodeAt(feed - 1) === CR ? feed - 1 : feed;
    lines.push(content.slice(start, end));
    start = feed + 1;
  }

  function positionAt(offset: number): Position {
    const at = Math.min(Math.max(offset, lineStarts[0]!), content.length);
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid]! <= at) low = mid;
      else high = mid - 1;
    }
    return { line: low, character: Math.min(at - lineStarts[low]!, lines[low]!.length) };
  }

  function offsetAt(position: Position): number {
    if (position.line < 0) return lineStarts[0]!;
    if (position.line >= lines.length) return content.length;
    const length = lines[position.line]!.length;
    return lineStarts[position.line]! + Math.min(Math.max(position.character, 0), length);
  }

  return { lines, lineStarts, hadBom, positionAt, offsetAt };
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// A string holds invalid UTF-8 only as a lone surrogate, which no UTF-8 byte sequence decodes to.
export function firstInvalidLine(text: DecodedText): number | null {
  const index = text.lines.findIndex((line) => LONE_SURROGATE.test(line));
  return index === -1 ? null : index + 1;
}

export function compareCodePoints(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const diff = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

export function lineRange(lines: readonly string[], line: number): Range {
  const content = lines[line - 1] ?? "";
  const start = /^[ \t]*/.exec(content)![0].length;
  const end = content.replace(/[ \t]+$/, "").length;
  return { start: { line: line - 1, character: start }, end: { line: line - 1, character: Math.max(start, end) } };
}
