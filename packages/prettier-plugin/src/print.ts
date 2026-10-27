import { closesFence, opensFence } from "@lore/parser";
import type { AstPath, Doc, Options, Printer } from "prettier";
import { builders, printer } from "prettier/doc";

const { join, literalline } = builders;

interface Span { start: number; end: number }

// A file-level error leaves `elements` null and the text is printed unchanged.
export interface Root extends Span { type: "root"; text: string; elements: Element[] | null }
// Lines printed exactly as written at column 0: comments and entries with an entry-level error.
export interface Raw extends Span { type: "raw"; lines: string[] }
export interface Block extends Span { type: "block"; name: string; body: Yaml | null }
export interface Entry extends Span {
  type: "entry"; name: string; attributes: string[];
  children: Child[]; first: Verbatim | null; rest: Markdown | null;
}
export interface Child extends Span { type: "child"; name: string; attributes: string[]; body: Yaml | Verbatim | null }
// Dedented lines, re-indented `depth` levels and otherwise kept as written.
export interface Verbatim extends Span { type: "verbatim"; lines: string[]; depth: number }
export interface Yaml extends Span { type: "yaml"; lines: string[]; depth: number }
export interface Markdown extends Span { type: "markdown"; lines: string[]; depth: number }

export type Element = Raw | Block | Entry;
export type LoreNode = Root | Element | Child | Verbatim | Yaml | Markdown;

export function splitProse(lines: string[]): { first: string[]; rest: string[] | null } {
  let fence: ReturnType<typeof opensFence> = null;
  for (const [index, line] of lines.entries()) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (line === "") {
      let start = index;
      while (lines[start] === "") start++;
      return { first: lines.slice(0, index), rest: start === lines.length ? null : lines.slice(start) };
    }
    fence = opensFence(line);
  }
  return { first: lines, rest: null };
}

function unit(options: Options): string {
  return options.useTabs ? "\t" : "  ";
}

function widthAt(options: Options, depth: number): number {
  const step = options.useTabs ? (options.tabWidth ?? 2) : 2;
  return Math.max((options.printWidth ?? 80) - depth * step, 1);
}

// Each line comes after a line break, so an empty list prints nothing; literal breaks keep trailing spaces.
function linesAt(lines: string[], depth: number, options: Options): Doc[] {
  const prefix = unit(options).repeat(depth);
  return lines.map((line) => [literalline, line === "" ? "" : prefix + line]);
}

function docLines(doc: Doc, options: Options): string[] {
  const text = printer.printDocToString(doc, { ...options, endOfLine: "lf" } as printer.Options).formatted;
  const trimmed = text.replace(/\n+$/, "");
  return trimmed === "" ? [] : trimmed.split("\n");
}

function tagWith(name: string, attributes: string[]): string {
  return `<${[name, ...attributes].join(" ")}>`;
}

const print: Printer<LoreNode>["print"] = (path, options, print) => {
  const node = path.node;
  const indent = unit(options);
  switch (node.type) {
    case "root":
      if (node.elements === null) return join(literalline, node.text.split("\n"));
      if (node.elements.length === 0) return "";
      return [join([literalline, literalline], path.map(print, "elements")), literalline];
    case "raw":
      return join(literalline, node.lines);
    case "block":
      return [`<${node.name}>`, node.body === null ? "" : print("body"), literalline, `</${node.name}>`];
    case "entry":
      return [
        tagWith(node.name, node.attributes),
        path.map(print, "children"),
        node.first === null ? "" : print("first"),
        node.rest === null ? "" : [literalline, print("rest")],
        literalline, `</${node.name}>`,
      ];
    case "child":
      return [
        literalline, indent, tagWith(node.name, node.attributes),
        node.body === null ? "" : print("body"),
        literalline, indent, `</${node.name}>`,
      ];
    case "verbatim":
    case "yaml":
    case "markdown":
      return linesAt(node.lines, node.depth, options);
  }
};

function embed(path: AstPath<LoreNode>, options: Options) {
  const node = path.node;
  if (node.type === "yaml") {
    return async (textToDoc: (text: string, options: Options) => Promise<Doc>) => {
      const doc = await textToDoc(node.lines.join("\n"), { parser: "yaml", useTabs: false });
      return linesAt(docLines(doc, { ...options, useTabs: false, printWidth: widthAt(options, node.depth) }), node.depth, options);
    };
  }
  if (node.type === "markdown") {
    return async (textToDoc: (text: string, options: Options) => Promise<Doc>) => {
      const doc = await textToDoc(node.lines.join("\n"), { parser: "markdown", proseWrap: "preserve" });
      return linesAt(docLines(doc, { ...options, printWidth: widthAt(options, node.depth) }), node.depth, options);
    };
  }
  return null;
}

const VISITOR_KEYS: Record<LoreNode["type"], string[]> = {
  root: ["elements"], raw: [], block: ["body"], entry: ["children", "first", "rest"], child: ["body"],
  verbatim: [], yaml: [], markdown: [],
};

export const lorePrinter: Printer<LoreNode> = {
  print,
  embed,
  getVisitorKeys: (node: LoreNode) => VISITOR_KEYS[node.type],
};
