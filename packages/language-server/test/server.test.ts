import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from "vscode-jsonrpc/node";
import { diagnose } from "../src/diagnostics";

const PACKAGE = join(import.meta.dir, "..");
const BIN = join(PACKAGE, "bin", "lore-language-server.js");
const NODE = Bun.which("node")!;

interface PublishedDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity: number;
  code: string;
  source: string;
  message: string;
}

interface Client {
  connection: MessageConnection;
  process: ChildProcess;
  open(path: string, text: string): void;
  change(path: string, text: string): void;
  published(path: string, accept?: (diagnostics: PublishedDiagnostic[]) => boolean): Promise<PublishedDiagnostic[]>;
}

const made: string[] = [];
const clients: Client[] = [];

function folder(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-ls-server-")));
  made.push(dir);
  return dir;
}

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function uri(path: string): string {
  return pathToFileURL(path).href;
}

interface StartOptions {
  env?: Record<string, string>; folders?: string[]; externalFolders?: string[]; logs?: string[]; showDocument?: boolean;
}

async function start(workspace: string, { env = {}, folders = [], externalFolders = [], logs = [], showDocument = true }: StartOptions = {}): Promise<Client> {
  const child = spawn(NODE, [BIN, "--stdio"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
  const connection = createMessageConnection(new StreamMessageReader(child.stdout!), new StreamMessageWriter(child.stdin!));
  const latest = new Map<string, PublishedDiagnostic[]>();
  const waiting: { uri: string; accept: (d: PublishedDiagnostic[]) => boolean; done: (d: PublishedDiagnostic[]) => void }[] = [];
  connection.onNotification("textDocument/publishDiagnostics", (params: { uri: string; diagnostics: PublishedDiagnostic[] }) => {
    latest.set(params.uri, params.diagnostics);
    for (const wait of waiting.filter((w) => w.uri === params.uri && w.accept(params.diagnostics))) {
      waiting.splice(waiting.indexOf(wait), 1);
      wait.done(params.diagnostics);
    }
  });
  connection.onNotification("window/logMessage", (params: { message: string }) => logs.push(params.message));
  connection.onRequest("workspace/configuration", (params: { items: { section?: string }[] }) =>
    params.items.map(() => ({ externalFolders })));
  connection.listen();
  await connection.sendRequest("initialize", {
    processId: process.pid,
    rootUri: uri(workspace),
    workspaceFolders: [workspace, ...folders].map((path) => ({ uri: uri(path), name: path })),
    capabilities: { workspace: { configuration: true }, window: { showDocument: { support: showDocument } } },
  });
  connection.sendNotification("initialized", {});
  const versions = new Map<string, number>();
  const client: Client = {
    connection,
    process: child,
    open(path, text) {
      versions.set(path, 1);
      connection.sendNotification("textDocument/didOpen", { textDocument: { uri: uri(path), languageId: "lore", version: 1, text } });
    },
    change(path, text) {
      const version = (versions.get(path) ?? 1) + 1;
      versions.set(path, version);
      connection.sendNotification("textDocument/didChange", { textDocument: { uri: uri(path), version }, contentChanges: [{ text }] });
    },
    published(path, accept = () => true) {
      const known = latest.get(uri(path));
      if (known !== undefined && accept(known)) return Promise.resolve(known);
      return new Promise((done) => waiting.push({ uri: uri(path), accept, done }));
    },
  };
  clients.push(client);
  return client;
}

function names(diagnostics: PublishedDiagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}

beforeAll(() => {
  execFileSync("bun", ["run", "build"], { cwd: PACKAGE, stdio: "ignore" });
});

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.connection.dispose();
    client.process.kill();
  }
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("language server over stdio", () => {
  test("publishes diagnostics with the registry name and description", async () => {
    const root = folder();
    execFileSync("git", ["init", "-q"], { cwd: root });
    const lore = join(root, ".lore/checkout.lore");
    const config = join(root, ".loreconfig");
    const client = await start(root);
    client.open(lore, "<rule id=\"a\" category=\"functional_correctness\">\nText.\n</rule>\n\n<bogus>\n</bogus>\n");
    client.open(config, "lore: 1\nbogus: true\n");
    expect(await client.published(lore, (d) => d.length > 0)).toEqual([{
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 7 } },
      severity: 1,
      code: "unknown-element",
      source: "lore",
      message: "An element name is not part of the format.",
    }]);
    const [problem] = await client.published(config, (d) => d.length > 0);
    expect(problem).toMatchObject({ code: "invalid-loreconfig", severity: 1, range: { start: { line: 1 } } });
  });

  test("warnings publish with warning severity", async () => {
    const root = folder();
    const lore = join(root, ".lore/checkout.lore");
    const client = await start(root);
    client.open(lore, "<rule id=\"a\">\nText.\n</rule>\n");
    const [warning] = await client.published(lore, (d) => d.length > 0);
    expect(warning).toMatchObject({ code: "missing-category", severity: 2 });
  });

  test("half-typed buffer publishes diagnostics", async () => {
    const root = folder();
    const lore = join(root, ".lore/checkout.lore");
    const valid = "<rule id=\"a\" category=\"functional_correctness\">\nText.\n</rule>\n";
    const client = await start(root);
    client.open(lore, valid);
    expect(await client.published(lore)).toEqual([]);
    client.change(lore, `${valid}\n<rule id="b" category="functional_correctness">\nMore`);
    expect(names(await client.published(lore, (d) => d.length > 0))).toEqual(["unreadable-structure"]);
    client.change(lore, valid);
    expect(await client.published(lore, (d) => d.length === 0)).toEqual([]);
    client.change(lore, `${valid}\n<rule`);
    expect(names(await client.published(lore, (d) => d.length > 0))).toEqual(["top-level-text"]);
  });

  test("a .lore file the collection leaves out still gets its structure diagnostics", async () => {
    const root = folder();
    const loose = join(root, "notes/loose.lore");
    const client = await start(root);
    client.open(loose, "stray text\n");
    expect(names(await client.published(loose, (d) => d.length > 0))).toEqual(["top-level-text"]);
  });

  test("works without a git repository", async () => {
    const root = folder();
    const lore = join(root, ".lore/checkout.lore");
    const client = await start(root);
    client.open(lore, "stray text\n");
    expect(names(await client.published(lore, (d) => d.length > 0))).toEqual(["top-level-text"]);
  });

  test("works when the git binary is missing", async () => {
    const root = folder();
    execFileSync("git", ["init", "-q"], { cwd: root });
    const lore = join(root, ".lore/checkout.lore");
    const client = await start(root, { env: { PATH: join(root, "no-binaries-here") } });
    client.open(lore, "stray text\n");
    expect(names(await client.published(lore, (d) => d.length > 0))).toEqual(["top-level-text"]);
  });

  test("an untracked file on disk takes part", async () => {
    const root = folder();
    execFileSync("git", ["init", "-q"], { cwd: root });
    const rule = "<rule id=\"same\" category=\"functional_correctness\">\nText.\n</rule>\n";
    write(root, ".lore/other.lore", rule);
    const lore = join(root, ".lore/checkout.lore");
    const client = await start(root);
    client.open(lore, rule);
    expect(names(await client.published(lore, (d) => d.length > 0))).toEqual(["duplicate-id"]);
  });
});

describe("rules repository", () => {
  const MARK = "lore: 1\nrepo: github.com/acme/shop\n";
  const VALID = "<rule id=\"price-from-quote\" category=\"functional_correctness\">\nText.\n</rule>\n";

  function rules(): string {
    const root = folder();
    execFileSync("git", ["init", "-q"], { cwd: root });
    write(root, ".loreconfig", "lore: 1\nroot: true\ncategories: [data_provenance]\n");
    write(root, "shop/.loreconfig", MARK);
    write(root, "shop/.lore/ok.lore", "<rule id=\"ok\" category=\"data_provenance\">\nText.\n</rule>\n");
    write(root, "shop/.lore/broken.lore", "<rule id=\"broken\" category=\"made_up\">\nText.\n</rule>\n");
    write(root, "own/.lore/own.lore", "stray text\n");
    return root;
  }

  test("a file below a marked directory gets diagnostics without the governed repository", async () => {
    const root = rules();
    const client = await start(root);
    const [ok, broken, mark, own] = ["shop/.lore/ok.lore", "shop/.lore/broken.lore", "shop/.loreconfig", "own/.lore/own.lore"]
      .map((path) => join(root, path)) as [string, string, string, string];
    for (const path of [ok, broken, mark, own]) client.open(path, readFileSync(path, "utf8"));
    expect(names(await client.published(broken, (d) => d.length > 0))).toEqual(["unknown-category"]);
    expect(names(await client.published(own, (d) => d.length > 0))).toEqual(["top-level-text"]);
    expect(await client.published(ok)).toEqual([]);
    expect(await client.published(mark)).toEqual([]);
  });

  test("marks for different repositories are checked apart", async () => {
    const root = rules();
    write(root, "pay/.loreconfig", "lore: 1\nrepo: github.com/acme/payments\n");
    const same = "<rule id=\"same\" category=\"functional_correctness\">\nText.\n</rule>\n";
    const [shopRule, payRule, payBroken] = ["shop/.lore/same.lore", "pay/.lore/same.lore", "pay/.lore/broken.lore"]
      .map((path) => join(root, path)) as [string, string, string];
    write(root, "shop/.lore/same.lore", same);
    write(root, "pay/.lore/same.lore", same);
    write(root, "pay/.lore/broken.lore", "<rule id=\"pay-broken\" category=\"made_up\">\nText.\n</rule>\n");
    const client = await start(root);
    for (const path of [shopRule, payRule, payBroken]) client.open(path, readFileSync(path, "utf8"));
    expect(names(await client.published(payBroken, (d) => d.length > 0))).toEqual(["unknown-category"]);
    expect(await client.published(shopRule)).toEqual([]);
    expect(await client.published(payRule)).toEqual([]);
  });

  test("an open governed repository that names the mark through an external folder is used", async () => {
    const root = rules();
    const shop = folder();
    execFileSync("git", ["init", "-q"], { cwd: shop });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/shop.git"], { cwd: shop });
    write(shop, ".lore/checkout.lore", VALID);
    const ok = join(root, "shop/.lore/ok.lore");
    const client = await start(shop, { folders: [root], externalFolders: [join(root, "shop")] });
    client.open(ok, VALID);
    expect(names(await client.published(ok, (d) => d.length > 0))).toEqual(["duplicate-id"]);
  });
});

describe("completion, hover and the could-apply lens over stdio", () => {
  const RULE = "<rule id=\"price-from-quote\" category=\"functional_correctness\">\n  <scope>\n  files: [\"src/**\"]\n  </scope>\nText.\n</rule>\n";

  test("a source file gets a lens whose command opens the entry at its opening tag", async () => {
    const root = folder();
    execFileSync("git", ["init", "-q"], { cwd: root });
    write(root, ".lore/checkout.lore", `<!-- pricing -->\n\n${RULE}`);
    write(root, "src/app.ts", "export {};\n");
    const lore = join(root, ".lore/checkout.lore");
    const source = join(root, "src/app.ts");
    const readme = join(root, "README.md");
    const client = await start(root);
    const shown: unknown[] = [];
    client.connection.onRequest("window/showDocument", (params: unknown) => {
      shown.push(params);
      return { success: true };
    });
    client.open(source, "export {};\n");
    client.open(readme, "# Shop\n");
    const lenses = await client.connection.sendRequest("textDocument/codeLens", { textDocument: { uri: uri(source) } });
    expect(lenses).toEqual([{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      command: { title: "Lore: could apply: price-from-quote", command: "lore.openEntry", arguments: [uri(lore), 2] },
    }]);
    expect(await client.connection.sendRequest("textDocument/codeLens", { textDocument: { uri: uri(readme) } })).toEqual([]);
    await client.connection.sendRequest("workspace/executeCommand", { command: "lore.openEntry", arguments: [uri(lore), 2] });
    expect(shown).toEqual([{
      uri: uri(lore),
      selection: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
      takeFocus: true,
    }]);
  });

  test("lore.openEntry ignores arguments that do not name a Lore file and a line", async () => {
    const root = folder();
    const lore = join(root, ".lore/checkout.lore");
    const client = await start(root);
    const shown: unknown[] = [];
    client.connection.onRequest("window/showDocument", (params: unknown) => {
      shown.push(params);
      return { success: true };
    });
    for (const args of [[uri(join(root, "src/app.ts")), 2], [uri(lore), -1], [uri(lore), 1.5], ["untitled:Untitled-1", 0], [uri(lore)]]) {
      await client.connection.sendRequest("workspace/executeCommand", { command: "lore.openEntry", arguments: args });
    }
    expect(shown).toEqual([]);
  });

  test("without showDocument support the lens is plain text", async () => {
    const root = folder();
    execFileSync("git", ["init", "-q"], { cwd: root });
    write(root, ".lore/checkout.lore", RULE);
    const source = join(root, "src/app.ts");
    const client = await start(root, { showDocument: false });
    client.open(source, "export {};\n");
    expect(await client.connection.sendRequest("textDocument/codeLens", { textDocument: { uri: uri(source) } })).toEqual([{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      command: { title: "Lore: could apply: price-from-quote", command: "" },
    }]);
  });

  test("open source files in one folder find their repository once across refreshes", async () => {
    const root = folder();
    execFileSync("git", ["init", "-q"], { cwd: root });
    write(root, ".lore/checkout.lore", RULE);
    const bin = join(root, "..", `${root.split("/").at(-1)}-bin`);
    made.push(bin);
    const log = join(bin, "git.log");
    mkdirSync(bin);
    write(bin, "git", `#!/bin/sh\necho "$(pwd -P) $*" >> "${log}"\nexec "${Bun.which("git")}" "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const sources = Array.from({ length: 5 }, (_, n) => join(root, `src/file-${n}.ts`));
    for (const source of sources) write(root, source.slice(root.length + 1), "export {};\n");
    const client = await start(root, { env: { PATH: `${bin}:${process.env.PATH}` } });
    for (const source of sources) client.open(source, "export {};\n");
    const lens = () => client.connection.sendRequest("textDocument/codeLens", { textDocument: { uri: uri(sources[0]!) } }) as Promise<unknown[]>;
    expect(await lens()).toHaveLength(1);
    client.connection.sendNotification("textDocument/didSave", { textDocument: { uri: uri(sources[1]!) } });
    expect(await lens()).toHaveLength(1);
    expect(existsSync(log)).toBe(true);
    const lookups = readFileSync(log, "utf8").split("\n")
      .filter((line) => line.startsWith(`${join(root, "src")} `) && line.includes(" rev-parse "));
    expect(lookups).toHaveLength(1);
  });

  test("completion offers the file's categories and hover describes a diagnostic", async () => {
    const root = folder();
    execFileSync("git", ["init", "-q"], { cwd: root });
    write(root, ".loreconfig", "lore: 1\ncategories: [data_provenance]\n");
    const lore = join(root, ".lore/checkout.lore");
    const client = await start(root);
    client.open(lore, "<rule id=\"a\" category=\"made_up\">\nText.\n</rule>\n");
    const completion = await client.connection.sendRequest("textDocument/completion", {
      textDocument: { uri: uri(lore) }, position: { line: 0, character: 23 },
    }) as { label: string }[];
    expect(completion.map((item) => item.label)).toContain("data_provenance");
    await client.published(lore, (d) => d.length > 0);
    const hover = await client.connection.sendRequest("textDocument/hover", {
      textDocument: { uri: uri(lore) }, position: { line: 0, character: 26 },
    }) as { contents: { value: string } };
    expect(hover.contents.value).toContain("unknown-category");
  });

  test("an external folder outside any repository is reported as missing or not inside one", async () => {
    const root = folder();
    execFileSync("git", ["init", "-q"], { cwd: root });
    const logs: string[] = [];
    const lore = join(root, ".lore/checkout.lore");
    const client = await start(root, { externalFolders: [join(root, "..", "nowhere-lore")], logs });
    client.open(lore, RULE);
    await client.published(lore);
    expect(logs.some((log) => log.includes("is missing or not inside a git repository; it is skipped"))).toBe(true);
  });
});

describe("diagnose", () => {
  test("parses a 2,000-entry file in under 200 ms", () => {
    const entries = Array.from({ length: 2000 }, (_, n) => [
      `<rule id="rule-${n}" category="functional_correctness" severity="blocking">`,
      `<scope>`,
      `files: ["src/**/*.ts"]`,
      `</scope>`,
      `Rule ${n} keeps prices consistent`,
      `across the checkout.`,
      ``,
      `More prose for rule ${n}.`,
      `</rule>`,
      ``,
    ].join("\n")).join("\n");
    const input = { repo: [{ path: ".lore/big.lore", content: entries }], given: [], remotes: [] };
    diagnose(input);
    const started = performance.now();
    const found = diagnose(input).byFile;
    const elapsed = performance.now() - started;
    expect([...found.values()].flat()).toEqual([]);
    expect(elapsed).toBeLessThan(200);
  });
});
