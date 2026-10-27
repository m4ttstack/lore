import { strict as assert } from "node:assert";
import { join } from "node:path";
import * as vscode from "vscode";

const TIMEOUT_MS = 30_000;

// Runs inside the extension host that scripts/smoke.ts launches; LORE_SMOKE_WORKSPACE is the folder it opened.
export async function run(): Promise<void> {
  const folder = process.env.LORE_SMOKE_WORKSPACE;
  assert.ok(folder, "LORE_SMOKE_WORKSPACE is not set");
  const extension = vscode.extensions.getExtension("lore.lore-vscode");
  assert.ok(extension, "lore.lore-vscode is not loaded");
  await extension.activate();

  const good = await open(join(folder, ".lore/checkout.lore"));
  report("languageId", good.languageId);
  assert.equal(good.languageId, "lore");

  const broken = await open(join(folder, ".lore/broken.lore"));
  const diagnostics = await waitFor(() => {
    const found = vscode.languages.getDiagnostics(broken.uri);
    return found.length > 0 ? found : undefined;
  }, "diagnostics on broken.lore");
  report("diagnostics", diagnostics.map((d) => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.code ?? ""} ${d.message}`));
  assert.ok(diagnostics.some((d) => d.code === "top-level-text"));

  const completion = await waitFor(async () => {
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider", good.uri, new vscode.Position(0, 6),
    );
    return list.items.length > 0 ? list : undefined;
  }, "completion items");
  report("completion", completion.items.slice(0, 12).map((item) => typeof item.label === "string" ? item.label : item.label.label));

  const hovers = await waitFor(async () => {
    const found = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", good.uri, new vscode.Position(0, 2));
    return found.length > 0 ? found : undefined;
  }, "hover");
  const hoverText = hovers.flatMap((hover) => hover.contents.map((content) => typeof content === "string" ? content : content.value));
  report("hover", hoverText);
  assert.ok(hoverText.join("").length > 0);

  const source = await open(join(folder, "src/app.ts"));
  const lenses = await waitFor(async () => {
    const found = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", source.uri);
    return found.length > 0 ? found : undefined;
  }, "could-apply lens");
  const titles = lenses.map((lens) => lens.command?.title ?? "(unresolved)");
  report("lens", titles);
  assert.ok(titles.some((title) => title.includes("price-from-quote")));
}

async function open(path: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(path);
  await vscode.window.showTextDocument(document);
  return document;
}

async function waitFor<T>(probe: () => T | undefined | Promise<T | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function report(name: string, value: unknown): void {
  console.log(`[smoke] ${name}: ${JSON.stringify(value)}`);
}
