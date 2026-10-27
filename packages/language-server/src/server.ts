import { existsSync } from "node:fs";
import { basename, dirname, sep } from "node:path";
import {
  CodeLensRefreshRequest, createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind,
  type Diagnostic as LspDiagnostic,
} from "vscode-languageserver/node";
import { FIXED_CATEGORIES, type LoreInput } from "@lore/parser";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { complete, factsFor, type CompletionFacts } from "./completion";
import { collectedNames, diagnose, structureDiagnostics, type Analysis } from "./diagnostics";
import { buildInput, canonicalPath, isLorePath, pathWithin, repositoryRoot } from "./files";
import { hover } from "./hover";
import { couldApply, OPEN_ENTRY } from "./lens";
import { externalName, governs, markOver, marksOf, repoKey, rulesInput, type Mark } from "./marks";
import { debounced } from "./schedule";

const DEBOUNCE_MS = 150;
const LORE_FOLDER = ".lore";
const LORE_EXTENSION = ".lore";
const CONFIG_NAME = ".loreconfig";
const FALLBACK_FACTS: CompletionFacts = { categories: [...FIXED_CATEGORIES], ids: [] };

interface OpenFile { uri: string; path: string }

// What the latest refresh found for an open document: a Lore file under its parser name, or a source file under its path.
type DocumentState =
  | { kind: "lore"; name: string; analysis: Analysis; diagnostics: LspDiagnostic[] }
  | { kind: "source"; root: string; path: string; analysis: Analysis };

const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
const documents = new TextDocuments(TextDocument);
let workspaceFolders: string[] = [];
let configurationSupport = false;
let lensRefreshSupport = false;
let showDocumentSupport = false;
let pushedSettings: unknown;
let states = new Map<string, DocumentState>();
const warnedFolders = new Set<string>();
// A source document's root, found once while it stays open.
const sourceRoots = new Map<string, Promise<string>>();
const schedule = debounced(refresh, DEBOUNCE_MS, logFailure);

connection.onInitialize(async (params) => {
  const folders = params.workspaceFolders?.map((folder) => folder.uri) ?? (params.rootUri === null ? [] : [params.rootUri]);
  workspaceFolders = await Promise.all(folders.flatMap((uri) => pathOf(uri) ?? []).map(canonicalPath));
  configurationSupport = params.capabilities.workspace?.configuration === true;
  lensRefreshSupport = params.capabilities.workspace?.codeLens?.refreshSupport === true;
  showDocumentSupport = params.capabilities.window?.showDocument?.support === true;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ["<", " ", "\""] },
      hoverProvider: true,
      codeLensProvider: { resolveProvider: false },
      executeCommandProvider: { commands: [OPEN_ENTRY] },
    },
  };
});

connection.onDidChangeConfiguration((change) => {
  pushedSettings = change.settings;
  schedule();
});

// A source file's text never changes which entries cover it, so only its opening and closing count.
documents.onDidOpen(schedule);
documents.onDidChangeContent(({ document }) => {
  if (isLoreUri(document.uri)) schedule();
});
documents.onDidSave(schedule);
documents.onDidClose(({ document }) => {
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  sourceRoots.delete(document.uri);
  schedule();
});

connection.onCompletion(async ({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  const path = pathOf(textDocument.uri);
  if (document === undefined || path === null || !isLorePath(path)) return [];
  const state = await stateOf(textDocument.uri);
  const facts = state?.kind === "lore" ? factsFor(state.analysis, state.name) : FALLBACK_FACTS;
  return complete(document.getText(), position, basename(path) === CONFIG_NAME ? "config" : "lore", facts);
});

connection.onHover(async ({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  if (document === undefined || !isLoreUri(textDocument.uri)) return null;
  const state = await stateOf(textDocument.uri);
  if (state?.kind !== "lore") return hover(document.getText(), position, { diagnostics: [], entries: [] });
  const entries = state.analysis.model.entries.filter((entry) => entry.file === state.name);
  return hover(document.getText(), position, { diagnostics: state.diagnostics, entries });
});

connection.onCodeLens(async ({ textDocument }) => {
  await schedule.settled();
  const state = states.get(textDocument.uri);
  return state?.kind === "source" ? couldApply(state.analysis, state.root, state.path, showDocumentSupport) : [];
});

connection.onExecuteCommand(async ({ command, arguments: args }) => {
  const [uri, line] = args ?? [];
  if (command !== OPEN_ENTRY || typeof uri !== "string" || !isLoreUri(uri) || !Number.isInteger(line) || line < 0) return;
  const at = { line, character: 0 };
  await connection.window.showDocument({ uri, selection: { start: at, end: at }, takeFocus: true });
});

documents.listen(connection);
connection.listen();

// The latest refresh's state, waiting for a pending refresh when the document has none yet.
async function stateOf(uri: string): Promise<DocumentState | undefined> {
  if (!states.has(uri)) await schedule.settled();
  return states.get(uri);
}

async function refresh(): Promise<void> {
  const open = new Map<string, string>();
  const byRoot = new Map<string, { lore: OpenFile[]; source: OpenFile[] }>();
  const repositories = new Map<string, Promise<string | null>>();
  const repositoryOf = (dir: string) => {
    let found = repositories.get(dir);
    if (found === undefined) repositories.set(dir, (found = repositoryRoot(dir)));
    return found;
  };
  const found = await Promise.all(documents.all().map(async ({ uri }) => {
    const raw = pathOf(uri);
    if (raw === null) return null;
    const path = await canonicalPath(raw);
    const lore = isLorePath(path);
    let root = lore ? undefined : sourceRoots.get(uri);
    if (root === undefined) {
      root = rootOf(path, repositoryOf);
      if (!lore && documents.get(uri) !== undefined) sourceRoots.set(uri, root);
    }
    return { uri, path, lore, root: await root };
  }));
  for (const file of found) {
    if (file === null) continue;
    const document = documents.get(file.uri);
    if (document === undefined) continue;
    open.set(file.path, document.getText());
    const group = byRoot.get(file.root) ?? { lore: [], source: [] };
    byRoot.set(file.root, group);
    group[file.lore ? "lore" : "source"].push({ uri: file.uri, path: file.path });
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
  // A key names one input, so each is parsed once per refresh.
  const analyses = new Map<string, Analysis>();
  const analysisOf = (key: string, input: LoreInput): Analysis => {
    let analysis = analyses.get(key);
    if (analysis === undefined) analyses.set(key, (analysis = diagnose(input)));
    return analysis;
  };
  const governed = await governedRoots();
  const next = new Map<string, DocumentState>();

  for (const [root, { lore, source }] of byRoot) {
    try {
      const input = await inputOf(root);
      for (const { uri, path } of source) {
        const name = pathWithin(root, path);
        if (name !== null) next.set(uri, { kind: "source", root, path: name, analysis: analysisOf(root, input) });
      }
      const marks = marksOf(input.repo);
      const parses = new Map<string, { input: LoreInput; named: { uri: string; name: string }[] }>();
      const add = (key: string, parseInput: LoreInput, uri: string, name: string) => {
        const parse = parses.get(key) ?? { input: parseInput, named: [] };
        parses.set(key, parse);
        parse.named.push({ uri, name });
      };
      for (const { uri, path } of lore) {
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
      for (const [key, { input: parseInput, named }] of parses) {
        const analysis = analysisOf(key, parseInput);
        let collected: ReadonlySet<string> | undefined;
        for (const { uri, name } of named) {
          const document = documents.get(uri);
          if (document === undefined) continue;
          let diagnostics = analysis.byFile.get(name) ?? [];
          if (diagnostics.length === 0 && name.endsWith(LORE_EXTENSION)) {
            collected ??= collectedNames(analysis.collected);
            if (!collected.has(name)) diagnostics = structureDiagnostics(name, document.getText());
          }
          connection.sendDiagnostics({ uri, diagnostics });
          next.set(uri, { kind: "lore", name, analysis, diagnostics });
        }
      }
    } catch (error) {
      logFailure(error);
    }
  }
  states = next;
  if (lensRefreshSupport && [...next.values()].some((state) => state.kind === "source")) {
    connection.sendRequest(CodeLensRefreshRequest.type).catch(logFailure);
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
async function rootOf(path: string, repositoryOf: (dir: string) => Promise<string | null>): Promise<string> {
  let dir = dirname(path);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  const repository = await repositoryOf(dir);
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

function isLoreUri(uri: string): boolean {
  const path = pathOf(uri);
  return path !== null && isLorePath(path);
}

function warnSkipped(folder: string): void {
  if (warnedFolders.has(folder)) return;
  warnedFolders.add(folder);
  connection.console.warn(`lore: lore.externalFolders entry ${folder} is missing or not inside a git repository; it is skipped`);
}

function logFailure(error: unknown): void {
  connection.console.error(`lore: refresh failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
}
