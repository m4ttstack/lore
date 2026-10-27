import { readAttributes, type Entry, type Scope } from "@lore/parser";
import { MarkupKind, type Diagnostic as LspDiagnostic, type Hover, type Position, type Range } from "vscode-languageserver/node";
import { linesOf, placeOf, TAG_LINE } from "./completion";
import { registryDescription } from "./diagnostics";
import { ATTRIBUTE_DOCS, TAG_DOCS, WHEN_DOCS } from "./docs";

// entries: the model's entries read from this file.
export interface HoverFacts { diagnostics: readonly LspDiagnostic[]; entries: readonly Entry[] }

export function hover(text: string, position: Position, facts: HoverFacts): Hover | null {
  const sections = [
    ...facts.diagnostics.filter((diagnostic) => contains(diagnostic.range, position))
      .map((diagnostic) => `**${String(diagnostic.code)}**: ${registryDescription(String(diagnostic.code))}`),
    ...meaning(linesOf(text), position, facts.entries),
  ];
  return sections.length === 0 ? null : { contents: { kind: MarkupKind.Markdown, value: sections.join("\n\n---\n\n") } };
}

function meaning(lines: readonly string[], { line, character }: Position, entries: readonly Entry[]): string[] {
  const text = lines[line] ?? "";
  const tag = TAG_LINE.exec(text);
  if (tag !== null) {
    const [, indent, closing, name, rest] = tag as unknown as [string, string, string, string, string];
    const nameStart = indent.length + 1 + closing.length;
    const nameEnd = nameStart + name.length;
    if (closing === "") {
      for (const attribute of readAttributes(rest).attributes) {
        const start = nameEnd + attribute.offset;
        if (character >= start && character <= start + attribute.name.length) return described(attribute.name, ATTRIBUTE_DOCS);
      }
      const opensEntry = indent === "" && (name === "rule" || name === "context");
      if (opensEntry) return [...described(`<${name}>`, TAG_DOCS, name), ...scopeOf(rest, entries)];
    }
    return character >= nameStart && character <= nameEnd ? described(`<${name}>`, TAG_DOCS, name) : [];
  }
  const key = /^([ \t]*)([A-Za-z]+)[ \t]*:/.exec(text);
  if (key === null) return [];
  const [, indent, name] = key as unknown as [string, string, string];
  const onKey = character >= indent.length && character <= indent.length + name.length;
  const place = placeOf(lines, line);
  return onKey && place.entry !== null && place.open === "when" ? described(name, WHEN_DOCS) : [];
}

function described(label: string, docs: Readonly<Record<string, string>>, key = label): string[] {
  const doc = docs[key];
  return doc === undefined ? [] : [`\`${label}\`: ${doc}`];
}

function scopeOf(rest: string, entries: readonly Entry[]): string[] {
  const id = readAttributes(rest).attributes.find((attribute) => attribute.name === "id")?.value;
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry === undefined) return [];
  return [["**Resolved scope** (a file must match every line):", ...entry.scopes.map(scopeLine)].join("\n")];
}

function scopeLine(scope: Scope): string {
  const files = `- files ${scope.files.map(code).join(", ")}`;
  return scope.ignores.length === 0 ? files : `${files}, ignoring ${scope.ignores.map(code).join(", ")}`;
}

function code(glob: string): string {
  return `\`${glob}\``;
}

function contains(range: Range, { line, character }: Position): boolean {
  const after = line > range.start.line || (line === range.start.line && character >= range.start.character);
  const before = line < range.end.line || (line === range.end.line && character <= range.end.character);
  return after && before;
}
