import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

async function start(workspace: string, env: Record<string, string> = {}): Promise<Client> {
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
  connection.onRequest("workspace/configuration", (params: { items: { section?: string }[] }) =>
    params.items.map(() => ({ externalFolders: [] })));
  connection.listen();
  await connection.sendRequest("initialize", {
    processId: process.pid,
    rootUri: uri(workspace),
    workspaceFolders: [{ uri: uri(workspace), name: "workspace" }],
    capabilities: { workspace: { configuration: true } },
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
    const client = await start(root, { PATH: join(root, "no-binaries-here") });
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
    const found = diagnose(input);
    const elapsed = performance.now() - started;
    expect([...found.values()].flat()).toEqual([]);
    expect(elapsed).toBeLessThan(200);
  });
});
