import { basename } from "node:path";
import { workspace, type ExtensionContext, type TextDocument } from "vscode";
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  // The server runs git in the opened folder, so it waits for the workspace to be trusted.
  if (workspace.isTrusted) start(context);
  else context.subscriptions.push(workspace.onDidGrantWorkspaceTrust(() => start(context)));
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}

// Other files are sent to the server only for the could-apply lens.
function isLoreDocument(document: TextDocument): boolean {
  return document.languageId === "lore" || basename(document.uri.fsPath) === ".loreconfig";
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
