import { closesFence, opensFence, parseFile, readEntry, readFileBlocks, type Entry, type FileContext } from "@lore/parser";
import type { AstPath, Doc, Options, Printer } from "prettier";
import { builders, printer } from "prettier/doc";

const { join, literalline } = builders;

// The formatter sees one file, not the .loreconfig, so it cannot tell a configured category from an unknown one.
// The parser only asks a category set has().
export const ANY_CATEGORY = { has: () => true } as unknown as ReadonlySet<string>;

export const CONTEXT: FileContext = {
  base: "", prefix: "", loreRoot: "", categories: ANY_CATEGORY,
  defaults: {}, scope: { files: ["**"], ignores: [] },
};

interface Span { start: number; end: number }

// A file-level error leaves `elements` null and the text is printed unchanged.
export interface Root extends Span { type: "root"; text: string; elements: Element[] | null }
// Lines printed exactly as written: comments and entries with an entry-level error.
export interface Raw extends Span { type: "raw"; lines: string[] }
// `written` is printed when formatting fails or would change what the parser reads.
export interface BlockElement extends Span {
  type: "block"; name: "defaults" | "scope"; lines: string[]; value: unknown; path: string; written: string[];
}
export interface ChildElement { name: string; attributes: string[]; lines: string[]; yaml: boolean }
export interface EntryElement extends Span {
  type: "entry"; name: "rule" | "context"; attributes: string[]; children: ChildElement[];
  first: string[]; rest: string[] | null; model: Entry; path: string; written: string[];
}

export type Element = Raw | BlockElement | EntryElement;
export type LoreNode = Root | Element;

type TextToDoc = (text: string, options: Options) => Promise<Doc>;

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

function fencesClose(lines: string[]): boolean {
  let fence: ReturnType<typeof opensFence> = null;
  for (const line of lines) {
    if (fence === null) fence = opensFence(line);
    else if (closesFence(line, fence)) fence = null;
  }
  return fence === null;
}

function unit(options: Options): string {
  return options.useTabs ? "\t" : "  ";
}

function widthAt(options: Options, depth: number): number {
  const step = options.useTabs ? (options.tabWidth ?? 2) : 2;
  return Math.max((options.printWidth ?? 80) - depth * step, 1);
}

function indented(lines: string[], prefix: string): string[] {
  return lines.map((line) => (line === "" ? "" : prefix + line));
}

// Literal breaks, because Prettier trims trailing spaces before an ordinary line break.
function linesDoc(lines: string[]): Doc {
  return join(literalline, lines);
}

function docLines(doc: Doc, options: Options): string[] {
  const text = printer.printDocToString(doc, { ...options, endOfLine: "lf" } as printer.Options).formatted;
  const trimmed = text.replace(/\n+$/, "");
  return trimmed === "" ? [] : trimmed.split("\n");
}

async function yamlLines(lines: string[], textToDoc: TextToDoc, options: Options, depth: number): Promise<string[]> {
  if (lines.every((line) => line === "")) return [];
  const doc = await textToDoc(lines.join("\n"), { parser: "yaml", useTabs: false });
  return docLines(doc, { ...options, useTabs: false, printWidth: widthAt(options, depth) });
}

function markdownPrinter(textToDoc: TextToDoc, options: Options): (lines: string[]) => Promise<string[]> {
  const printed = new Map<string, Promise<string[]>>();
  return (lines) => {
    const text = lines.join("\n");
    if (!printed.has(text)) {
      printed.set(text, textToDoc(text, { parser: "markdown", proseWrap: "preserve", embeddedLanguageFormatting: "off" })
        .then((doc) => docLines(doc, { ...options, printWidth: widthAt(options, 1) })));
    }
    return printed.get(text)!;
  };
}

function tagWith(name: string, attributes: string[]): string {
  return `<${[name, ...attributes].join(" ")}>`;
}

function blockLines(node: BlockElement, body: string[], indent: string): string[] {
  return [`<${node.name}>`, ...indented(body, indent), `</${node.name}>`];
}

function entryLines(node: EntryElement, bodies: string[][], rest: string[] | null, indent: string): string[] {
  const lines = [tagWith(node.name, node.attributes)];
  node.children.forEach((child, n) => {
    lines.push(indent + tagWith(child.name, child.attributes), ...indented(bodies[n]!, indent + indent), `${indent}</${child.name}>`);
  });
  lines.push(...indented(node.first, indent));
  if (rest !== null) lines.push("", ...indented(rest, indent));
  lines.push(`</${node.name}>`);
  return lines;
}

function sameBlock(node: BlockElement, lines: string[]): boolean {
  const lore = parseFile(node.path, lines.join("\n"));
  if (lore.diagnostics.length > 0 || lore.nodes.length !== 1) return false;
  const read = readFileBlocks(lore, ANY_CATEGORY);
  return !("error" in read) && JSON.stringify(read[node.name]) === JSON.stringify(node.value);
}

// The design's comparison: every field equal, except the prose after its first blank line, compared once printed.
async function sameEntry(node: EntryElement, lines: string[], markdown: (lines: string[]) => Promise<string[]>): Promise<boolean> {
  const lore = parseFile(node.path, lines.join("\n"));
  const only = lore.nodes[0];
  if (lore.diagnostics.length > 0 || lore.nodes.length !== 1 || only?.kind !== "entry") return false;
  const read = readEntry(lore, only, CONTEXT);
  if ("error" in read) return false;
  const after = splitProse(read.entry.prose.split("\n"));
  const before = splitProse(node.model.prose.split("\n"));
  if (JSON.stringify({ ...read.entry, prose: after.first }) !== JSON.stringify({ ...node.model, prose: before.first })) return false;
  if (after.rest === null || before.rest === null) return after.rest === before.rest;
  return (await markdown(after.rest)).join("\n") === (await markdown(before.rest)).join("\n");
}

async function formatBlock(node: BlockElement, textToDoc: TextToDoc, options: Options): Promise<Doc> {
  const lines = blockLines(node, await yamlLines(node.lines, textToDoc, options, 1), unit(options));
  return linesDoc(sameBlock(node, lines) ? lines : node.written);
}

async function formatEntry(node: EntryElement, textToDoc: TextToDoc, options: Options): Promise<Doc> {
  const markdown = markdownPrinter(textToDoc, options);
  const bodies = await Promise.all(node.children.map((child) =>
    child.yaml ? yamlLines(child.lines, textToDoc, options, 2) : child.lines));
  const rests: (string[] | null)[] = [];
  // An indented first line continues the summary's Markdown, which the printer would read on its own.
  if (node.rest !== null && !/^[ \t]/.test(node.rest[0]!)) {
    const printed = await markdown(node.rest);
    if (fencesClose(printed)) rests.push(printed);
  }
  rests.push(node.rest);
  for (const rest of rests) {
    const lines = entryLines(node, bodies, rest, unit(options));
    if (await sameEntry(node, lines, markdown)) return linesDoc(lines);
  }
  return linesDoc(node.written);
}

const print: Printer<LoreNode>["print"] = (path, _options, print) => {
  const node = path.node;
  switch (node.type) {
    case "root":
      if (node.elements === null) return linesDoc(node.text.split("\n"));
      if (node.elements.length === 0) return "";
      return [join([literalline, literalline], path.map(print, "elements")), literalline];
    case "raw":
      return linesDoc(node.lines);
    case "block":
    case "entry":
      return linesDoc(node.written);
  }
};

function embed(path: AstPath<LoreNode>, options: Options) {
  const node = path.node;
  if (node.type === "block") return (textToDoc: TextToDoc) => formatBlock(node, textToDoc, options);
  if (node.type === "entry") return (textToDoc: TextToDoc) => formatEntry(node, textToDoc, options);
  return null;
}

export const lorePrinter: Printer<LoreNode> = {
  print,
  embed,
  getVisitorKeys: (node: LoreNode) => (node.type === "root" ? ["elements"] : []),
};
