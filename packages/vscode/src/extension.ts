import { workspace, type ExtensionContext } from "vscode";
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
  };
  client = new LanguageClient("lore", "Lore", serverOptions, clientOptions);
  context.subscriptions.push(client);
  void client.start();
}
