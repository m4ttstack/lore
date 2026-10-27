import { closesFence, opensFence, parseFile, type TopNode } from "@lore/parser";
import type { EntryKind } from "./docs";

type Fence = NonNullable<ReturnType<typeof opensFence>>;

// What the lines above a line make of it, read forward as the spec's Top level and Entries sections read a file.
// In an entry's children, `children` lists every child tag the entry has, above and below the line.
export type Place =
  | { at: "top" }
  | { at: "comment" }
  | { at: "block"; name: string }
  | { at: "children"; entry: EntryKind; child: string | null; children: readonly string[] }
  | { at: "prose"; entry: EntryKind; fence: Fence | null };

export interface TagLine { indent: string; closing: boolean; name: string; rest: string }

const TAG = /^([ \t]*)<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:[ \t].*)?)>[ \t]*$/;
const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";
const TOP: Place = { at: "top" };

export function linesOf(text: string): string[] {
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

export function tagLine(line: string): TagLine | null {
  const match = TAG.exec(line);
  if (match === null) return null;
  const [, indent, closing, name, rest] = match as unknown as [string, string, string, string, string];
  return { indent, closing: closing === "/", name, rest };
}

// The line itself is left out: it is the one being written.
export function placeAt(lines: readonly string[], line: number): Place {
  const intact = parseFile("", lines.slice(0, line).join("\n")).nodes.filter((node) => node.kind !== "text");
  const last = intact.at(-1);
  let place = TOP;
  for (let at = last === undefined ? 0 : endOf(last); at < line; at++) place = step(place, lines[at]!);
  if (place.at !== "children") return place;
  let children = place.children;
  let after: Place = place;
  for (let at = line + 1; at < lines.length; at++) {
    after = step(after, lines[at]!);
    if (after.at !== "children") break;
    children = after.children;
  }
  return { ...place, children };
}

// Whether the line is read as structure where it stands, rather than as prose, a comment or a block's contents.
export function isStructure(place: Place, line: string): boolean {
  const tag = tagLine(line);
  if (tag === null) return false;
  switch (place.at) {
    case "top":
      return tag.indent === "" && !tag.closing;
    case "block":
      return closesAtTop(line, place.name);
    case "children":
      return place.child === null || line.trim() === `</${place.child}>` || closesAtTop(line, place.entry);
    case "prose":
      return place.fence === null && closesAtTop(line, place.entry);
    case "comment":
      return false;
  }
}

function step(place: Place, line: string): Place {
  switch (place.at) {
    case "top": {
      if (line.startsWith(COMMENT_OPEN)) return line.includes(COMMENT_CLOSE, COMMENT_OPEN.length) ? TOP : { at: "comment" };
      const tag = tagLine(line);
      if (tag === null || tag.indent !== "" || tag.closing) return TOP;
      if (tag.name === "rule" || tag.name === "context") return { at: "children", entry: tag.name, child: null, children: [] };
      return tag.name === "defaults" || tag.name === "scope" ? { at: "block", name: tag.name } : TOP;
    }
    case "comment":
      return line.includes(COMMENT_CLOSE) ? TOP : place;
    case "block":
      return closesAtTop(line, place.name) ? TOP : place;
    case "children": {
      if (closesAtTop(line, place.entry)) return TOP;
      if (place.child !== null) return line.trim() === `</${place.child}>` ? { ...place, child: null } : place;
      if (line.trim() === "") return place;
      const tag = tagLine(line);
      if (tag === null) return { at: "prose", entry: place.entry, fence: opensFence(line) };
      return tag.closing ? place : { ...place, child: tag.name, children: [...place.children, tag.name] };
    }
    case "prose":
      if (place.fence !== null) return closesFence(line, place.fence) ? { ...place, fence: null } : place;
      return closesAtTop(line, place.entry) ? TOP : { ...place, fence: opensFence(line) };
  }
}

function closesAtTop(line: string, name: string): boolean {
  return !/^[ \t]/.test(line) && line.replace(/[ \t]+$/, "") === `</${name}>`;
}

function endOf(node: TopNode): number {
  return node.kind === "text" ? node.line : node.closeLine;
}
