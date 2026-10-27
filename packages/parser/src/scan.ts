import { decode, firstInvalidLine, type DecodedText } from "./text";
import type { Diagnostic, Range } from "./types";

export interface RawAttributes {
  text: string;
  offset: number;
}

export interface Attribute {
  name: string;
  value: string | null;
  offset: number;
}

export interface AttributeList {
  attributes: Attribute[];
  malformedAt: number | null;
}

export interface CommentNode { kind: "comment"; openLine: number; closeLine: number; range: Range }
export interface BlockNode {
  kind: "block"; name: "defaults" | "scope"; attributes: RawAttributes;
  openLine: number; closeLine: number; body: string[]; range: Range;
}
export interface ChildNode {
  name: string; attributes: RawAttributes;
  openLine: number; closeLine: number; body: string[]; range: Range;
}
export interface EntryNode {
  kind: "entry"; name: "rule" | "context"; attributes: RawAttributes;
  openLine: number; closeLine: number; children: ChildNode[];
  prose: string[]; proseLine: number | null; range: Range;
}
export interface TextNode { kind: "text"; line: number; range: Range }
export type TopNode = CommentNode | BlockNode | EntryNode | TextNode;

// nodes: every element read before the first file-level error the scan meets, then a TextNode when that error is top-level-text.
export interface LoreFile {
  path: string;
  text: DecodedText;
  nodes: TopNode[];
  diagnostics: Diagnostic[];
}

export interface TagLine {
  closing: boolean;
  name: string;
  attributes: RawAttributes;
}

const NAME = /^[A-Za-z][A-Za-z0-9-]*/;
const BLANK = /^[ \t]*$/;
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";

function isBlank(line: string): boolean {
  return BLANK.test(line);
}

function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

function trimSpaces(line: string): { start: number; end: number } {
  let start = 0;
  let end = line.length;
  while (start < end && isSpace(line[start])) start++;
  while (end > start && isSpace(line[end - 1])) end--;
  return { start, end };
}

export function looksLikeTag(line: string): TagLine | null {
  const { start, end } = trimSpaces(line);
  if (line[start] !== "<") return null;
  const closing = line[start + 1] === "/";
  const nameStart = start + (closing ? 2 : 1);
  const name = NAME.exec(line.slice(nameStart, end))?.[0];
  if (name === undefined) return null;
  const after = nameStart + name.length;
  if (line[end - 1] !== ">") return null;
  if (after !== end - 1 && !isSpace(line[after])) return null;
  return { closing, name, attributes: { text: line.slice(after, Math.max(after, end - 1)), offset: after } };
}

export function readAttributes(text: string): AttributeList {
  const attributes: Attribute[] = [];
  let at = 0;
  while (at < text.length) {
    if (!isSpace(text[at])) return { attributes, malformedAt: at };
    while (isSpace(text[at])) at++;
    if (at === text.length) break;
    const name = NAME.exec(text.slice(at))?.[0];
    if (name === undefined) return { attributes, malformedAt: at };
    const offset = at;
    at += name.length;
    if (text[at] !== "=") {
      attributes.push({ name, value: null, offset });
      continue;
    }
    at++;
    if (text[at] !== "\"") return { attributes, malformedAt: at };
    const close = text.indexOf("\"", at + 1);
    if (close === -1) return { attributes, malformedAt: text.length };
    attributes.push({ name, value: text.slice(at + 1, close), offset });
    at = close + 1;
  }
  return { attributes, malformedAt: null };
}

class Stop {
  constructor(readonly diagnostic: Diagnostic) {}
}

export function parseFile(path: string, content: string): LoreFile {
  const text = decode(content);
  const nodes: TopNode[] = [];
  const diagnostics: Diagnostic[] = [];
  try {
    const invalid = firstInvalidLine(text);
    if (invalid !== null) throw new Stop(problem(path, text, "unreadable-structure", invalid));
    new Scanner(path, text, nodes).run();
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    diagnostics.push(error.diagnostic);
  }
  return { path, text, nodes, diagnostics };
}

function lineRange(text: DecodedText, line: number, from = 0): Range {
  const content = text.lines[line - 1] ?? "";
  const trimmed = trimSpaces(content.slice(from));
  return {
    start: { line: line - 1, character: from + trimmed.start },
    end: { line: line - 1, character: from + trimmed.end },
  };
}

function spanRange(text: DecodedText, openLine: number, closeLine: number): Range {
  return {
    start: lineRange(text, openLine).start,
    end: lineRange(text, closeLine).end,
  };
}

function problem(path: string, text: DecodedText, name: string, line: number, range = lineRange(text, line)): Diagnostic {
  return { name, file: path, entry: null, line, range };
}

class Scanner {
  private seenEntry = false;
  private readonly seenBlocks = new Set<string>();

  constructor(
    private readonly path: string,
    private readonly text: DecodedText,
    private readonly nodes: TopNode[],
  ) {}

  private get lines(): string[] {
    return this.text.lines;
  }

  private stop(name: string, line: number, range?: Range): never {
    throw new Stop(problem(this.path, this.text, name, line, range));
  }

  private strayText(line: number, from = 0): never {
    const range = lineRange(this.text, line, from);
    this.nodes.push({ kind: "text", line, range });
    this.stop("top-level-text", line, range);
  }

  run(): void {
    let index = 0;
    while (index < this.lines.length) {
      const line = this.lines[index]!;
      if (isBlank(line)) index++;
      else if (isSpace(line[0])) this.strayText(index + 1);
      else if (line.startsWith(COMMENT_OPEN)) index = this.comment(index);
      else index = this.element(index);
    }
  }

  private comment(index: number): number {
    let close = this.lines[index]!.indexOf(COMMENT_CLOSE, COMMENT_OPEN.length);
    let last = index;
    while (close === -1) {
      last++;
      if (last >= this.lines.length) this.stop("unreadable-structure", index + 1);
      close = this.lines[last]!.indexOf(COMMENT_CLOSE);
    }
    this.nodes.push({ kind: "comment", openLine: index + 1, closeLine: last + 1, range: spanRange(this.text, index + 1, last + 1) });
    const restStart = close + COMMENT_CLOSE.length;
    if (!isBlank(this.lines[last]!.slice(restStart))) this.strayText(last + 1, restStart);
    return last + 1;
  }

  private element(index: number): number {
    const openLine = index + 1;
    const tag = looksLikeTag(this.lines[index]!);
    if (tag === null) this.strayText(openLine);
    if (tag.closing) this.stop("unreadable-structure", openLine);
    switch (tag.name) {
      case "defaults":
      case "scope":
        return this.block(index, tag.name, tag.attributes);
      case "rule":
      case "context":
        return this.entry(index, tag.name, tag.attributes);
      default:
        this.stop("unknown-element", openLine);
    }
  }

  private block(index: number, name: "defaults" | "scope", attributes: RawAttributes): number {
    const openLine = index + 1;
    if (this.seenEntry) this.stop("file-block-after-entry", openLine);
    if (this.seenBlocks.has(name)) this.stop("duplicate-file-block", openLine);
    const list = readAttributes(attributes.text);
    if (list.attributes.length > 0) this.stop("unknown-attribute", openLine);
    if (list.malformedAt !== null) this.stop("invalid-attribute-value", openLine);
    for (let close = index + 1; close < this.lines.length; close++) {
      if (!this.isTopClose(this.lines[close]!, name)) continue;
      this.seenBlocks.add(name);
      this.nodes.push({
        kind: "block", name, attributes, openLine, closeLine: close + 1,
        body: this.lines.slice(index + 1, close), range: spanRange(this.text, openLine, close + 1),
      });
      return close + 1;
    }
    this.stop("unreadable-structure", openLine);
  }

  private isTopClose(line: string, name: string): boolean {
    return !isSpace(line[0]) && line.slice(0, trimSpaces(line).end) === `</${name}>`;
  }

  private entry(index: number, name: "rule" | "context", attributes: RawAttributes): number {
    const openLine = index + 1;
    this.seenEntry = true;
    const children: ChildNode[] = [];
    let open: { name: string; attributes: RawAttributes; openLine: number } | null = null;
    let at = index + 1;

    for (; at < this.lines.length; at++) {
      const line = this.lines[at]!;
      if (this.isTopClose(line, name)) {
        if (open !== null) this.stop("unreadable-structure", open.openLine);
        return this.finishEntry(name, attributes, openLine, at, children, null);
      }
      if (open !== null) {
        const { start, end } = trimSpaces(line);
        if (line.slice(start, end) !== `</${open.name}>`) continue;
        children.push({
          ...open, closeLine: at + 1,
          body: this.lines.slice(open.openLine, at), range: spanRange(this.text, open.openLine, at + 1),
        });
        open = null;
        continue;
      }
      if (isBlank(line)) continue;
      const tag = looksLikeTag(line);
      if (tag === null) break;
      if (tag.closing) this.stop("unreadable-structure", at + 1);
      open = { name: tag.name, attributes: tag.attributes, openLine: at + 1 };
    }
    if (open !== null) this.stop("unreadable-structure", open.openLine);

    const proseStart = at;
    let fence: { char: string; length: number } | null = null;
    for (; at < this.lines.length; at++) {
      const line = this.lines[at]!;
      if (fence !== null) {
        if (closesFence(line, fence)) fence = null;
        continue;
      }
      if (this.isTopClose(line, name)) return this.finishEntry(name, attributes, openLine, at, children, proseStart);
      fence = opensFence(line);
    }
    this.stop("unreadable-structure", openLine);
  }

  private finishEntry(
    name: "rule" | "context", attributes: RawAttributes, openLine: number,
    close: number, children: ChildNode[], proseStart: number | null,
  ): number {
    this.nodes.push({
      kind: "entry", name, attributes, openLine, closeLine: close + 1, children,
      prose: proseStart === null ? [] : this.lines.slice(proseStart, close),
      proseLine: proseStart === null ? null : proseStart + 1,
      range: spanRange(this.text, openLine, close + 1),
    });
    return close + 1;
  }
}

function opensFence(line: string): { char: string; length: number } | null {
  const match = FENCE.exec(line);
  if (match === null) return null;
  const run = match[1]!;
  if (run[0] === "`" && match[2]!.includes("`")) return null;
  return { char: run[0]!, length: run.length };
}

function closesFence(line: string, fence: { char: string; length: number }): boolean {
  const { start, end } = trimSpaces(line);
  if (end - start < fence.length) return false;
  for (let i = start; i < end; i++) if (line[i] !== fence.char) return false;
  return true;
}
