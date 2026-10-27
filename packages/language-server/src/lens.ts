import { join } from "node:path";
import { coveringEntries, parseFile, readAttributes, type DocumentModel, type Entry, type LoreInput } from "@lore/parser";
import type { CodeLens } from "vscode-languageserver/node";
import { URI } from "vscode-uri";

export const OPEN_ENTRY = "lore.openEntry";

const TITLE = "Lore: could apply: ";
const EXTERNAL = "external:";
const TOP: CodeLens["range"] = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

interface Located { uri: string; line: number }

// Per model: entry file name, then id, to where its opening tag is.
const located = new WeakMap<DocumentModel, Map<string, Map<string, Located>>>();

// Scope and disable only: `<when>` depends on a change, so a covering entry could apply, not does.
// One lens per entry, so each opens its own entry; read together, their titles are "Lore: could apply: a, b".
// Without `openable` (a client that cannot show a document), a lens command has an empty id, which VS Code shows as plain text.
export function couldApply(
  analysis: { input: LoreInput; model: DocumentModel },
  root: string,
  path: string,
  openable = true,
): CodeLens[] {
  const found = coveringEntries(analysis.input, analysis.model, path).flatMap((entry) => {
    const place = locate(analysis, root, entry);
    return place === undefined ? [] : [{ id: entry.id, place }];
  });
  return found.map(({ id, place }, n) => {
    const title = n === 0 ? TITLE + id : id;
    return { range: TOP, command: openable ? { title, command: OPEN_ENTRY, arguments: [place.uri, place.line] } : { title, command: "" } };
  });
}

function locate({ input, model }: { input: LoreInput; model: DocumentModel }, root: string, entry: Entry): Located | undefined {
  let byFile = located.get(model);
  if (byFile === undefined) located.set(model, (byFile = new Map()));
  let byId = byFile.get(entry.file);
  if (byId === undefined) {
    byId = openingTags(input, root, entry.file);
    byFile.set(entry.file, byId);
  }
  return byId.get(entry.id);
}

function openingTags(input: LoreInput, root: string, name: string): Map<string, Located> {
  const found = new Map<string, Located>();
  const source = sourceOf(input, root, name);
  if (source === undefined) return found;
  const uri = URI.file(source.full).toString();
  for (const node of parseFile(name, source.content).nodes) {
    if (node.kind !== "entry") continue;
    const id = readAttributes(node.attributes.text).attributes.find((attribute) => attribute.name === "id")?.value;
    if (id != null && !found.has(id)) found.set(id, { uri, line: node.openLine - 1 });
  }
  return found;
}

// An `external:` name is a path in a given folder's repository.
function sourceOf(input: LoreInput, root: string, name: string): { full: string; content: string } | undefined {
  if (!name.startsWith(EXTERNAL)) {
    const file = input.repo.find((candidate) => candidate.path === name);
    return file === undefined ? undefined : { full: join(root, name), content: file.content };
  }
  const path = name.slice(EXTERNAL.length);
  for (const given of input.given) {
    const file = given.files.find((candidate) => candidate.path === path);
    if (file !== undefined && given.repository !== undefined) return { full: join(given.repository, path), content: file.content };
  }
  return undefined;
}
