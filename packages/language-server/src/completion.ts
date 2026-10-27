import { FIXED_CATEGORIES } from "@lore/parser";
import {
  CompletionItemKind, InsertTextFormat, MarkupKind, type CompletionItem, type Position,
} from "vscode-languageserver/node";
import type { Analysis } from "./diagnostics";
import {
  ATTRIBUTE_DOCS, BARE_ATTRIBUTES, CHECK_LANGUAGES, CHILD_TAGS, SEVERITIES, TAG_ATTRIBUTES, TAG_DOCS, TOP_LEVEL_TAGS,
  WHEN_DOCS, WHEN_KEYS, type EntryKind,
} from "./docs";

export interface CompletionFacts { categories: readonly string[]; ids: readonly string[] }

// Where a line sits: the entry around it, and the innermost element still open above it.
export interface Place { entry: EntryKind | null; open: string | null }

export const TAG_LINE = /^([ \t]*)<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:[ \t].*)?)>[ \t]*$/;
const TAGS_WITH_ATTRIBUTES = new Set(Object.keys(TAG_ATTRIBUTES));

export function factsFor(analysis: Analysis, name: string): CompletionFacts {
  const file = analysis.collected.files.find((collected) => collected.file === name);
  const ids = [...new Set(analysis.model.entries.map((entry) => entry.id))].sort();
  return { categories: file?.categories ?? [...FIXED_CATEGORIES], ids };
}

export function complete(text: string, position: Position, kind: "lore" | "config", facts: CompletionFacts): CompletionItem[] {
  const lines = linesOf(text);
  const before = (lines[position.line] ?? "").slice(0, position.character);
  return kind === "config"
    ? disableIds(lines, position, before, facts)
    : loreItems(lines, position, before, facts);
}

export function linesOf(text: string): string[] {
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

// Scans upward: a column-0 closing entry tag ends the search at the top level.
export function placeOf(lines: readonly string[], line: number): Place {
  let open: string | null | undefined;
  for (let at = line - 1; at >= 0; at--) {
    const tag = TAG_LINE.exec(lines[at]!);
    if (tag === null) continue;
    const [, indent, closing, name] = tag as unknown as [string, string, string, string];
    const entry = indent === "" && (name === "rule" || name === "context");
    if (entry) return { entry: closing === "/" ? null : name as EntryKind, open: open ?? null };
    if (open === undefined) open = closing === "/" ? null : name;
  }
  return { entry: null, open: open ?? null };
}

function loreItems(lines: readonly string[], position: Position, before: string, facts: CompletionFacts): CompletionItem[] {
  const place = placeOf(lines, position.line);
  const replace = (length: number) => ({
    start: { line: position.line, character: position.character - length },
    end: position,
  });

  const tag = /^([ \t]*)<([A-Za-z-]*)$/.exec(before);
  if (tag !== null) {
    const [, indent, typed] = tag as unknown as [string, string, string];
    const names = place.entry !== null && place.open === null ? CHILD_TAGS[place.entry]
      : place.entry === null && indent === "" && place.open === null ? TOP_LEVEL_TAGS
      : [];
    return names.map((name) => ({
      label: name,
      kind: CompletionItemKind.Keyword,
      documentation: markdown(TAG_DOCS[name]),
      textEdit: { range: replace(typed.length), newText: TAGS_WITH_ATTRIBUTES.has(name) ? name : `${name}>` },
    }));
  }

  const value = /^[ \t]*<(rule|context|check)\b.*[ \t]([a-z]+)="([^"]*)$/.exec(before);
  if (value !== null) {
    const [, element, attribute, typed] = value as unknown as [string, string, string, string];
    const values = element === "rule" && attribute === "category" ? facts.categories
      : element === "rule" && attribute === "severity" ? SEVERITIES
      : element === "check" && attribute === "lang" ? CHECK_LANGUAGES
      : [];
    return values.map((label) => valueItem(label, replace(typed.length)));
  }

  const attribute = /^[ \t]*<(rule|context|check)((?:[ \t]+[A-Za-z][A-Za-z0-9-]*(?:="[^"]*")?)*)[ \t]+([A-Za-z-]*)$/.exec(before);
  if (attribute !== null) {
    const [, element, written, typed] = attribute as unknown as [string, string, string, string];
    const present = new Set([...written.matchAll(/([A-Za-z][A-Za-z0-9-]*)(?:="[^"]*")?/g)].map((match) => match[1]));
    return TAG_ATTRIBUTES[element]!.filter((name) => !present.has(name)).map((name) => ({
      label: name,
      kind: CompletionItemKind.Property,
      documentation: markdown(ATTRIBUTE_DOCS[name]),
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { range: replace(typed.length), newText: BARE_ATTRIBUTES.has(name) ? name : `${name}="$1"$0` },
    }));
  }

  if (place.entry === null && place.open === "defaults") {
    const field = /^[ \t]*(category|severity):[ \t]*([a-z0-9_]*)$/.exec(before);
    if (field === null) return [];
    const [, key, typed] = field as unknown as [string, string, string];
    return (key === "category" ? facts.categories : SEVERITIES).map((label) => valueItem(label, replace(typed.length)));
  }

  if (place.entry !== null && place.open === "when") {
    const key = /^[ \t]*([A-Za-z]*)$/.exec(before);
    if (key === null) return [];
    return WHEN_KEYS.map((name) => ({
      label: name,
      kind: CompletionItemKind.Property,
      documentation: markdown(WHEN_DOCS[name]),
      textEdit: { range: replace(key[1]!.length), newText: name },
    }));
  }
  return [];
}

function disableIds(lines: readonly string[], position: Position, before: string, facts: CompletionFacts): CompletionItem[] {
  const flow = /^disable:[ \t]*\[(?:[^\]]*,)?[ \t]*([a-z0-9-]*)$/.exec(before);
  const item = /^[ \t]*-[ \t]+([a-z0-9-]*)$/.exec(before);
  const typed = flow?.[1] ?? (item !== null && underDisable(lines, position.line) ? item[1] : undefined);
  if (typed === undefined) return [];
  const range = { start: { line: position.line, character: position.character - typed.length }, end: position };
  return facts.ids.map((id) => ({ label: id, kind: CompletionItemKind.Value, textEdit: { range, newText: id } }));
}

// The nearest key above at column 0 is the list's key.
function underDisable(lines: readonly string[], line: number): boolean {
  for (let at = line - 1; at >= 0; at--) {
    const text = lines[at]!;
    if (/^([ \t-]|#|$)/.test(text)) continue;
    return /^disable:[ \t]*(#.*)?$/.test(text);
  }
  return false;
}

function valueItem(label: string, range: { start: Position; end: Position }): CompletionItem {
  return { label, kind: CompletionItemKind.EnumMember, textEdit: { range, newText: label } };
}

function markdown(value: string | undefined): CompletionItem["documentation"] {
  return value === undefined ? undefined : { kind: MarkupKind.Markdown, value };
}
