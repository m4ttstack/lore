import { existsSync } from "node:fs";
import { basename, dirname, sep } from "node:path";
import { createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { diagnose } from "./diagnostics";
import { buildInput, canonicalPath, isLorePath, pathWithin, repositoryRoot } from "./files";

const DEBOUNCE_MS = 150;
const LORE_FOLDER = ".lore";
const CONFIG_NAME = ".loreconfig";

interface OpenLoreFile { uri: string; path: string }

const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
const documents = new TextDocuments(TextDocument);
let workspaceFolders: string[] = [];
let configurationSupport = false;
let pushedSettings: unknown;
let timer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<void> = Promise.resolve();

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

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    queue = queue.then(refresh).catch(logFailure);
  }, DEBOUNCE_MS);
}

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

  for (const [root, files] of byRoot) {
    try {
      const found = diagnose(await buildInput(root, open, await externalFolders(root)));
      for (const { uri, path } of files) {
        if (documents.get(uri) === undefined) continue;
        connection.sendDiagnostics({ uri, diagnostics: found.get(pathWithin(root, path) ?? "") ?? [] });
      }
    } catch (error) {
      logFailure(error);
    }
  }
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

function logFailure(error: unknown): void {
  connection.console.error(`lore: diagnostics failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
}
