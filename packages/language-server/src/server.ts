import { existsSync } from "node:fs";
import { basename, dirname, sep } from "node:path";
import { createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind } from "vscode-languageserver/node";
import type { LoreInput } from "@lore/parser";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { collectedNames, diagnose, structureDiagnostics } from "./diagnostics";
import { buildInput, canonicalPath, isLorePath, pathWithin, repositoryRoot } from "./files";
import { externalName, governs, markOver, marksOf, repoKey, rulesInput, type Mark } from "./marks";
import { debounced } from "./schedule";

const DEBOUNCE_MS = 150;
const LORE_FOLDER = ".lore";
const LORE_EXTENSION = ".lore";
const CONFIG_NAME = ".loreconfig";

interface OpenLoreFile { uri: string; path: string }

const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
const documents = new TextDocuments(TextDocument);
let workspaceFolders: string[] = [];
let configurationSupport = false;
let pushedSettings: unknown;
const warnedFolders = new Set<string>();
const schedule = debounced(refresh, DEBOUNCE_MS, logFailure);

connection.onInitialize(async (params) => {
  const folders = params.workspaceFolders?.map((folder) => folder.uri) ?? (params.rootUri === null ? [] : [params.rootUri]);
  workspaceFolders = await Promise.all(folders.flatMap((uri) => pathOf(uri) ?? []).map(canonicalPath));
  configurationSupport = params.capabilities.workspace?.configuration === true;
  return { capabilities: { textDocumentSync: TextDocumentSyncKind.Incremental } };
});

connection.onDidChangeConfiguration((change) => {
  pushedSettings = change.settings;
  schedule();
});

documents.onDidChangeContent(schedule);
documents.onDidSave(schedule);
documents.onDidClose(({ document }) => {
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  schedule();
});

documents.listen(connection);
connection.listen();

async function refresh(): Promise<void> {
  const open = new Map<string, string>();
  const loreFiles: OpenLoreFile[] = [];
  for (const document of documents.all()) {
    const raw = pathOf(document.uri);
    if (raw === null) continue;
    const path = await canonicalPath(raw);
    open.set(path, document.getText());
    if (isLorePath(path)) loreFiles.push({ uri: document.uri, path });
  }

  const byRoot = new Map<string, OpenLoreFile[]>();
  for (const file of loreFiles) {
    const root = await rootOf(file.path);
    byRoot.set(root, [...(byRoot.get(root) ?? []), file]);
  }

  const inputs = new Map<string, Promise<LoreInput>>();
  const inputOf = (root: string): Promise<LoreInput> => {
    let input = inputs.get(root);
    if (input === undefined) {
      input = externalFolders(root).then((folders) => buildInput(root, open, folders, warnSkipped));
      inputs.set(root, input);
    }
    return input;
  };
  const governed = await governedRoots();

  for (const [root, files] of byRoot) {
    try {
      const input = await inputOf(root);
      const marks = marksOf(input.repo);
      const parses = new Map<string, { input: LoreInput; named: { uri: string; name: string }[] }>();
      const add = (key: string, parseInput: LoreInput, uri: string, name: string) => {
        const parse = parses.get(key) ?? { input: parseInput, named: [] };
        parses.set(key, parse);
        parse.named.push({ uri, name });
      };
      for (const { uri, path } of files) {
        const name = pathWithin(root, path) ?? "";
        const mark = markOver(marks, name);
        if (mark === undefined) {
          add(root, input, uri, name);
          continue;
        }
        const governing = await findGoverning(governed.filter((other) => other !== root), inputOf, root, mark);
        if (governing === undefined) add(`rules:${root}:${repoKey(mark.repo)}`, rulesInput(root, input.repo, mark), uri, externalName(name));
        else add(governing.root, governing.input, uri, externalName(name));
      }
      for (const { input: parseInput, named } of parses.values()) {
        const found = diagnose(parseInput);
        let collected: ReadonlySet<string> | undefined;
        for (const { uri, name } of named) {
          const document = documents.get(uri);
          if (document === undefined) continue;
          let diagnostics = found.get(name) ?? [];
          if (diagnostics.length === 0 && name.endsWith(LORE_EXTENSION)) {
            collected ??= collectedNames(parseInput);
            if (!collected.has(name)) diagnostics = structureDiagnostics(name, document.getText());
          }
          connection.sendDiagnostics({ uri, diagnostics });
        }
      }
    } catch (error) {
      logFailure(error);
    }
  }
}

async function findGoverning(
  candidates: readonly string[],
  inputOf: (root: string) => Promise<LoreInput>,
  repository: string,
  mark: Mark,
): Promise<{ root: string; input: LoreInput } | undefined> {
  for (const root of candidates) {
    const input = await inputOf(root);
    if (governs(input, repository, mark)) return { root, input };
  }
  return undefined;
}

async function governedRoots(): Promise<string[]> {
  const roots = await Promise.all(workspaceFolders.map(async (folder) => (await repositoryRoot(folder)) ?? folder));
  return [...new Set(roots)];
}

// The repository holding the file; else the workspace folder holding it; else the folder above its Lore folder.
async function rootOf(path: string): Promise<string> {
  let dir = dirname(path);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  const repository = await repositoryRoot(dir);
  if (repository !== null) return repository;
  const folder = workspaceFolders
    .filter((candidate) => pathWithin(candidate, path) !== null)
    .sort((a, b) => b.length - a.length)[0];
  if (folder !== undefined) return folder;
  if (basename(path) === CONFIG_NAME) return dirname(path);
  const segments = dirname(path).split(sep);
  const lore = segments.indexOf(LORE_FOLDER);
  return lore === -1 ? dirname(path) : segments.slice(0, lore).join(sep) || sep;
}

async function externalFolders(root: string): Promise<string[]> {
  const settings = configurationSupport
    ? await connection.workspace.getConfiguration({ scopeUri: URI.file(root).toString(), section: "lore" })
    : (pushedSettings as { lore?: unknown } | null | undefined)?.lore;
  const folders = (settings as { externalFolders?: unknown } | null | undefined)?.externalFolders;
  return Array.isArray(folders) ? folders.filter((folder): folder is string => typeof folder === "string") : [];
}

function pathOf(uri: string): string | null {
  const parsed = URI.parse(uri);
  return parsed.scheme === "file" ? parsed.fsPath : null;
}

function warnSkipped(folder: string): void {
  if (warnedFolders.has(folder)) return;
  warnedFolders.add(folder);
  connection.console.warn(`lore: lore.externalFolders entry ${folder} is not inside a git repository; it is skipped`);
}

function logFailure(error: unknown): void {
  connection.console.error(`lore: diagnostics failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
}
