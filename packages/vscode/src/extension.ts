import { basename } from "node:path";
import { workspace, type ExtensionContext, type TextDocument } from "vscode";
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node";

const LORE_FILES = "**/{*.lore,.loreconfig}";
const SKIPPED = "**/node_modules/**";

let client: LanguageClient | undefined;

// The extension activates in every workspace, so the server starts only where Lore is in play.
export function activate(context: ExtensionContext): void {
  const consider = () => void startIfWanted(context);
  context.subscriptions.push(
    workspace.onDidGrantWorkspaceTrust(consider),
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("lore.externalFolders")) consider();
    }),
    workspace.onDidOpenTextDocument((document) => {
      if (isLoreDocument(document)) consider();
    }),
  );
  consider();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}

// Other files are sent to the server only for the could-apply lens.
function isLoreDocument(document: TextDocument): boolean {
  return document.languageId === "lore" || basename(document.uri.fsPath) === ".loreconfig";
}

// The server runs git in the opened folder, so it waits for the workspace to be trusted.
async function startIfWanted(context: ExtensionContext): Promise<void> {
  if (client !== undefined || !workspace.isTrusted) return;
  const wanted = hasExternalFolders()
    || workspace.textDocuments.some(isLoreDocument)
    || (await workspace.findFiles(LORE_FILES, SKIPPED, 1)).length > 0;
  if (wanted) start(context);
}

function hasExternalFolders(): boolean {
  const scopes = [undefined, ...(workspace.workspaceFolders ?? []).map((folder) => folder.uri)];
  return scopes.some((scope) => (workspace.getConfiguration("lore", scope).get<unknown[]>("externalFolders") ?? []).length > 0);
}

function start(context: ExtensionContext): void {
  if (client !== undefined) return;
  const module = context.asAbsolutePath("dist/server.js");
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.stdio },
    debug: { module, transport: TransportKind.stdio },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: "lore" }, { pattern: "**/.loreconfig" }, { scheme: "file" }],
    synchronize: { configurationSection: "lore" },
    middleware: {
      provideCompletionItem: (document, position, completion, token, next) =>
        isLoreDocument(document) ? next(document, position, completion, token) : undefined,
      provideHover: (document, position, token, next) =>
        isLoreDocument(document) ? next(document, position, token) : undefined,
    },
  };
  const started = new LanguageClient("lore", "Lore", serverOptions, clientOptions);
  client = started;
  started.start().catch((error: unknown) => {
    started.outputChannel.appendLine(`Lore language server failed to start: ${String(error)}`);
  });
}
