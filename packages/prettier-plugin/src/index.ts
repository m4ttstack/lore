import {
  dedent, dedentEntry, parseFile, readAttributes, readEntry, readFileBlocks,
  type BlockNode, type EntryNode, type LoreFile, type RawAttributes,
} from "@lore/parser";
import type { Parser, Plugin, SupportLanguage } from "prettier";
import { ANY_CATEGORY, CONTEXT, lorePrinter, splitProse, type ChildElement, type Element, type LoreNode, type Root } from "./print";

const ATTRIBUTE_ORDER = ["id", "category", "severity", "src", "lang", "disabled"];

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

function writtenLines(lore: LoreFile, openLine: number, closeLine: number): string[] {
  return lore.text.lines.slice(openLine - 1, closeLine);
}

function block(lore: LoreFile, node: BlockNode, values: { defaults: unknown; scope: unknown }): Element {
  return {
    type: "block", name: node.name, lines: dedent(node.body).lines, value: values[node.name], path: lore.path,
    written: writtenLines(lore, node.openLine, node.closeLine), ...spanOf(lore, node.openLine, node.closeLine),
  };
}

function entry(lore: LoreFile, node: EntryNode): Element {
  const span = spanOf(lore, node.openLine, node.closeLine);
  const written = writtenLines(lore, node.openLine, node.closeLine);
  const read = readEntry(lore, node, CONTEXT);
  if ("error" in read) return { type: "raw", lines: written, ...span };
  const contents = dedentEntry(lore.text.lines, node);
  const children = node.children.map((child, n): ChildElement => ({
    name: child.name, attributes: orderedAttributes(child.attributes),
    lines: contents.children[n]!.lines, yaml: child.name !== "check",
  }));
  let end = contents.prose.length;
  while (end > 0 && contents.prose[end - 1] === "") end--;
  const { first, rest } = splitProse(contents.prose.slice(0, end));
  return {
    type: "entry", name: node.name, attributes: orderedAttributes(node.attributes), children,
    first, rest, model: read.entry, path: lore.path, written, ...span,
  };
}

export function toTree(text: string, path = ""): Root {
  const lore = parseFile(path, text);
  const unchanged: Root = { type: "root", text, elements: null, start: 0, end: text.length };
  if (lore.diagnostics.length > 0) return unchanged;
  const values = readFileBlocks(lore, ANY_CATEGORY);
  if ("error" in values) return unchanged;
  const elements = lore.nodes.map((node): Element => {
    switch (node.kind) {
      case "comment":
        return { type: "raw", lines: writtenLines(lore, node.openLine, node.closeLine), ...spanOf(lore, node.openLine, node.closeLine) };
      case "block":
        return block(lore, node, values);
      case "entry":
        return entry(lore, node);
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
