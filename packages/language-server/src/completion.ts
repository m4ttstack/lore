import { FIXED_CATEGORIES } from "@lore/parser";
import {
  CompletionItemKind, InsertTextFormat, MarkupKind, type CompletionItem, type Position,
} from "vscode-languageserver/node";
import type { Analysis } from "./diagnostics";
import {
  ATTRIBUTE_DOCS, BARE_ATTRIBUTES, CHECK_LANGUAGES, CHILD_TAGS, SEVERITIES, SINGLE_CHILDREN, TAG_ATTRIBUTES, TAG_DOCS,
  TOP_LEVEL_TAGS, WHEN_DOCS, WHEN_KEYS,
} from "./docs";
import { linesOf, placeAt, type Place } from "./structure";

export interface CompletionFacts { categories: readonly string[]; ids: readonly string[] }

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
    : loreItems(placeAt(lines, position.line), position, before, facts);
}

function loreItems(place: Place, position: Position, before: string, facts: CompletionFacts): CompletionItem[] {
  const replace = (length: number) => ({
    start: { line: position.line, character: position.character - length },
    end: position,
  });
  const inChildren = place.at === "children" && place.child === null;

  const tag = /^([ \t]*)<([A-Za-z-]*)$/.exec(before);
  if (tag !== null) {
    const [, indent, typed] = tag as unknown as [string, string, string];
    const names = inChildren ? CHILD_TAGS[place.entry].filter((name) => !(SINGLE_CHILDREN.has(name) && place.children.includes(name)))
      : place.at === "top" && indent === "" ? TOP_LEVEL_TAGS
      : [];
    return names.map((name) => ({
      label: name,
      kind: CompletionItemKind.Keyword,
      documentation: markdown(TAG_DOCS[name]),
      textEdit: { range: replace(typed.length), newText: TAGS_WITH_ATTRIBUTES.has(name) ? name : `${name}>` },
    }));
  }

  // An entry's opening tag stands at column 0 of the top level; a check's among a rule's children.
  const opening = /^([ \t]*)<(rule|context|check)\b/.exec(before);
  const element = opening === null ? null
    : opening[2] === "check" ? (inChildren && place.entry === "rule" ? "check" : null)
    : place.at === "top" && opening[1] === "" ? opening[2]!
    : null;

  const value = /[ \t]([a-z]+)="([^"]*)$/.exec(before);
  if (element !== null && value !== null) {
    const [, attribute, typed] = value as unknown as [string, string, string];
    const values = element === "rule" && attribute === "category" ? facts.categories
      : element === "rule" && attribute === "severity" ? SEVERITIES
      : element === "check" && attribute === "lang" ? CHECK_LANGUAGES
      : [];
    return values.map((label) => valueItem(label, replace(typed.length)));
  }

  const attribute = /^[ \t]*<[a-z]+((?:[ \t]+[A-Za-z][A-Za-z0-9-]*(?:="[^"]*")?)*)[ \t]+([A-Za-z-]*)$/.exec(before);
  if (element !== null && attribute !== null) {
    const [, written, typed] = attribute as unknown as [string, string, string];
    const present = new Set([...written.matchAll(/([A-Za-z][A-Za-z0-9-]*)(?:="[^"]*")?/g)].map((match) => match[1]));
    return TAG_ATTRIBUTES[element]!.filter((name) => !present.has(name)).map((name) => ({
      label: name,
      kind: CompletionItemKind.Property,
      documentation: markdown(ATTRIBUTE_DOCS[name]),
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { range: replace(typed.length), newText: BARE_ATTRIBUTES.has(name) ? name : `${name}="$1"$0` },
    }));
  }

  if (place.at === "block" && place.name === "defaults") {
    const field = /^[ \t]*(category|severity):[ \t]*([a-z0-9_]*)$/.exec(before);
    if (field === null) return [];
    const [, key, typed] = field as unknown as [string, string, string];
    return (key === "category" ? facts.categories : SEVERITIES).map((label) => valueItem(label, replace(typed.length)));
  }

  if (place.at === "children" && place.child === "when") {
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
