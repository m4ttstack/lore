import {
  dedent, dedentEntry, parseFile, readAttributes, readEntry, readFileBlocks,
  type BlockNode, type EntryNode, type FileContext, type LoreFile, type RawAttributes,
} from "@lore/parser";
import type { Parser, Plugin, SupportLanguage } from "prettier";
import { lorePrinter, splitProse, type Child, type Element, type LoreNode, type Root } from "./print";

const ATTRIBUTE_ORDER = ["id", "category", "severity", "src", "lang", "disabled"];

// The formatter sees one file, not the .loreconfig, so it cannot tell a configured category from an unknown one.
const ANY_CATEGORY: ReadonlySet<string> = Object.assign(new Set<string>(), { has: () => true });

const CONTEXT: FileContext = {
  base: "", prefix: "", loreRoot: "", categories: ANY_CATEGORY,
  defaults: {}, scope: { files: ["**"], ignores: [] },
};

function orderedAttributes(raw: RawAttributes): string[] {
  const rank = (name: string) => {
    const at = ATTRIBUTE_ORDER.indexOf(name);
    return at === -1 ? ATTRIBUTE_ORDER.length : at;
  };
  return [...readAttributes(raw.text).attributes]
    .sort((a, b) => rank(a.name) - rank(b.name))
    .map((a) => (a.value === null ? a.name : `${a.name}="${a.value}"`));
}

function spanOf(lore: LoreFile, openLine: number, closeLine: number): { start: number; end: number } {
  const { lines, lineStarts } = lore.text;
  return { start: lineStarts[openLine - 1]!, end: lineStarts[closeLine - 1]! + lines[closeLine - 1]!.length };
}

function hasText(lines: string[]): boolean {
  return lines.some((line) => line !== "");
}

function block(lore: LoreFile, node: BlockNode): Element {
  const span = spanOf(lore, node.openLine, node.closeLine);
  const lines = dedent(node.body).lines;
  return { type: "block", name: node.name, ...span, body: hasText(lines) ? { type: "yaml", lines, depth: 1, ...span } : null };
}

function entry(lore: LoreFile, node: EntryNode, context: FileContext): Element {
  const span = spanOf(lore, node.openLine, node.closeLine);
  if ("error" in readEntry(lore, node, context)) {
    return { type: "raw", lines: lore.text.lines.slice(node.openLine - 1, node.closeLine), ...span };
  }
  const contents = dedentEntry(lore.text.lines, node);
  const children = node.children.map((child, n): Child => {
    const lines = contents.children[n]!.lines;
    const childSpan = spanOf(lore, child.openLine, child.closeLine);
    const body = child.name === "check"
      ? { type: "verbatim" as const, lines, depth: 2, ...childSpan }
      : hasText(lines) ? { type: "yaml" as const, lines, depth: 2, ...childSpan } : null;
    return { type: "child", name: child.name, attributes: orderedAttributes(child.attributes), body, ...childSpan };
  });
  let end = contents.prose.length;
  while (end > 0 && contents.prose[end - 1] === "") end--;
  const { first, rest } = splitProse(contents.prose.slice(0, end));
  return {
    type: "entry", name: node.name, attributes: orderedAttributes(node.attributes), children, ...span,
    first: first.length === 0 ? null : { type: "verbatim", lines: first, depth: 1, ...span },
    rest: rest === null ? null : { type: "markdown", lines: rest, depth: 1, ...span },
  };
}

export function toTree(text: string, path = ""): Root {
  const lore = parseFile(path, text);
  const unchanged: Root = { type: "root", text, elements: null, start: 0, end: text.length };
  if (lore.diagnostics.length > 0 || "error" in readFileBlocks(lore, ANY_CATEGORY)) return unchanged;
  const elements = lore.nodes.map((node): Element => {
    switch (node.kind) {
      case "comment":
        return { type: "raw", lines: lore.text.lines.slice(node.openLine - 1, node.closeLine), ...spanOf(lore, node.openLine, node.closeLine) };
      case "block":
        return block(lore, node);
      case "entry":
        return entry(lore, node, CONTEXT);
      case "text":
        throw new Error("a text node only follows a file-level error");
    }
  });
  return { ...unchanged, elements };
}

export const languages: SupportLanguage[] = [{ name: "Lore", parsers: ["lore"], extensions: [".lore"] }];

export const parsers: Record<string, Parser<LoreNode>> = {
  lore: {
    parse: (text, options) => toTree(text, options.filepath),
    astFormat: "lore",
    locStart: (node) => node.start,
    locEnd: (node) => node.end,
  },
};

export const printers: Plugin<LoreNode>["printers"] = { lore: lorePrinter };
