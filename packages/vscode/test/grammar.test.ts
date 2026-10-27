import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseFile } from "@lore/parser";
import * as oniguruma from "vscode-oniguruma";
import { INITIAL, Registry, parseRawGrammar, type IGrammar } from "vscode-textmate";

const require = createRequire(import.meta.url);
const fixtures = new URL("../../../test/fixtures/", import.meta.url);
const grammarFiles: Record<string, URL> = {
  "source.lore": new URL("../syntaxes/lore.tmLanguage.json", import.meta.url),
  "source.yaml": new URL("./grammars/yaml.tmLanguage.json", import.meta.url),
  "text.html.markdown": new URL("./grammars/markdown.tmLanguage.json", import.meta.url),
};

// Stands in for the editor's grammar of a language named on a fence. vscode-textmate drops a rule whose
// included grammar is missing, so without these the fence rules would not run at all.
function blockCommentGrammar(scopeName: string) {
  return { scopeName, patterns: [{ begin: "/\\*", end: "\\*/", name: "comment.block.embedded" }] };
}

let grammar: IGrammar;

beforeAll(async () => {
  const wasm = readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text) => new oniguruma.OnigString(text),
    }),
    loadGrammar: async (scopeName) => {
      const file = grammarFiles[scopeName];
      if (file === undefined) return parseRawGrammar(JSON.stringify(blockCommentGrammar(scopeName)), `${scopeName}.json`);
      return parseRawGrammar(readFileSync(file, "utf8"), file.pathname);
    },
  });
  const loaded = await registry.loadGrammar("source.lore");
  if (loaded === null) throw new Error("source.lore did not load");
  grammar = loaded;
});

interface Token { text: string; scopes: string[] }

// The editor strips a byte order mark before tokenizing.
function tokenize(content: string): Token[][] {
  let state = INITIAL;
  return content.replace(/^\uFEFF/, "").split("\n").map((line) => {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    return result.tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes }));
  });
}

function scopesOf(tokens: Token[]): Set<string> {
  return new Set(tokens.flatMap((token) => token.scopes.flatMap((scope) => scope.split(" "))));
}

function lineHas(lines: Token[][], line: number, scope: string): boolean {
  return scopesOf(lines[line - 1]!).has(scope);
}

function tokenScopes(lines: Token[][], line: number, text: string): string[] {
  const token = lines[line - 1]!.find((t) => t.text.includes(text));
  if (token === undefined) throw new Error(`no token holding ${JSON.stringify(text)} on line ${line}`);
  return token.scopes;
}

function fixtureFiles(): string[] {
  return readdirSync(fixtures).filter((name) => name.endsWith(".lore")).sort();
}

function readFixture(name: string): string {
  return readFileSync(new URL(name, fixtures), "utf8");
}

function tagLines(name: string, content: string): number[] {
  const lines: number[] = [];
  for (const node of parseFile(name, content).nodes) {
    if (node.kind !== "block" && node.kind !== "entry") continue;
    lines.push(node.openLine, node.closeLine);
    if (node.kind === "entry") for (const child of node.children) lines.push(child.openLine, child.closeLine);
  }
  return lines;
}

function proseLines(name: string, content: string): number[] {
  const lines: number[] = [];
  for (const node of parseFile(name, content).nodes) {
    if (node.kind !== "entry" || node.proseLine === null) continue;
    for (let line = node.proseLine; line < node.closeLine; line++) lines.push(line);
  }
  return lines;
}

describe("fixtures", () => {
  test("the fixture set holds the conformance examples and README samples", () => {
    const index = JSON.parse(readFixture("index.json")) as Record<string, { kind: string }>;
    expect(Object.keys(index).sort()).toEqual(fixtureFiles());
    expect(Object.values(index).filter((info) => info.kind === "readme").length).toBeGreaterThan(0);
    expect(Object.values(index).filter((info) => info.kind === "parse").length).toBeGreaterThan(0);
  });

  test("every fixture tokenizes without throwing", () => {
    for (const name of fixtureFiles()) expect(() => tokenize(readFixture(name))).not.toThrow();
  });

  test("every tag line in every fixture gets entity.name.tag.lore", () => {
    const missing: string[] = [];
    for (const name of fixtureFiles()) {
      const content = readFixture(name);
      const lines = tokenize(content);
      for (const line of tagLines(name, content)) {
        if (!lineHas(lines, line, "entity.name.tag.lore")) missing.push(`${name}:${line}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("no prose line in any fixture gets entity.name.tag.lore", () => {
    const tagged: string[] = [];
    for (const name of fixtureFiles()) {
      const content = readFixture(name);
      const lines = tokenize(content);
      for (const line of proseLines(name, content)) {
        if (lineHas(lines, line, "entity.name.tag.lore")) tagged.push(`${name}:${line}`);
      }
    }
    expect(tagged).toEqual([]);
  });
});

describe("scopes", () => {
  const sample = [
    "<!-- shared checkout rules -->",
    "<scope>",
    "  files: [\"src/checkout/**\"]",
    "</scope>",
    "",
    "<rule id=\"no-usd\" category=\"functional_correctness\" blocking>",
    "  <when>",
    "    addedContains: [\"'USD'\",",
    "  </when>",
    "  <check>",
    "    'USD'",
    "  </check>",
    "  <check lang=\"ast-grep\">",
    "    formatPrice($$$)",
    "  </check>",
    "  Display text never hard-codes a **currency** code.",
    "  <when>",
    "</rule>",
    "<context id=\"billing\" src=\"docs/billing.md\">",
    "  <meta>",
    "    owner: |",
    "  </meta>",
    "  Read this before changing invoices.",
    "</context>",
  ].join("\n");
  let lines: Token[][];
  beforeAll(() => {
    lines = tokenize(sample);
  });

  test("comments get comment.block.lore", () => {
    expect(lineHas(lines, 1, "comment.block.lore")).toBe(true);
  });

  test("YAML inside <scope> gets source.yaml", () => {
    expect(tokenScopes(lines, 3, "files")).toContain("source.yaml");
    expect(lineHas(lines, 4, "source.yaml")).toBe(false);
  });

  test("YAML inside <when> and <meta> gets source.yaml and an unclosed construct ends at the closing tag", () => {
    expect(tokenScopes(lines, 8, "addedContains")).toContain("source.yaml");
    expect(lineHas(lines, 9, "entity.name.tag.lore")).toBe(true);
    expect(tokenScopes(lines, 21, "owner")).toContain("source.yaml");
    expect(lineHas(lines, 22, "entity.name.tag.lore")).toBe(true);
  });

  test("attribute names and values get their scopes", () => {
    expect(tokenScopes(lines, 6, "category")).toContain("entity.other.attribute-name.lore");
    expect(tokenScopes(lines, 6, "blocking")).toContain("entity.other.attribute-name.lore");
    expect(tokenScopes(lines, 6, "functional_correctness")).toContain("string.quoted.double.lore");
  });

  test("a regex <check> body gets string.regexp.lore, another language's does not", () => {
    expect(tokenScopes(lines, 11, "USD")).toContain("string.regexp.lore");
    expect(tokenScopes(lines, 14, "formatPrice")).not.toContain("string.regexp.lore");
  });

  test("prose gets text.html.markdown", () => {
    expect(tokenScopes(lines, 16, "Display")).toContain("text.html.markdown");
    expect(tokenScopes(lines, 23, "Read")).toContain("text.html.markdown");
  });

  test("a tag-shaped prose line stays prose", () => {
    expect(lineHas(lines, 17, "entity.name.tag.lore")).toBe(false);
    expect(lineHas(lines, 17, "text.html.markdown")).toBe(true);
  });

  test("the entry's closing tag ends a Markdown block that runs on", () => {
    const html = tokenize(["<rule id=\"a\">", "Text.", "<details>", "</rule>", "<rule id=\"b\">", "More.", "</rule>"].join("\n"));
    expect(lineHas(html, 4, "entity.name.tag.lore")).toBe(true);
    expect(lineHas(html, 4, "text.html.markdown")).toBe(false);
    expect(lineHas(html, 5, "entity.name.tag.lore")).toBe(true);
  });

  test("a closing tag inside a fence in the prose is prose", () => {
    const fenced = tokenize(["<rule id=\"a\">", "Shown:", "```", "</rule>", "```", "</rule>"].join("\n"));
    expect(lineHas(fenced, 4, "entity.name.tag.lore")).toBe(false);
    expect(lineHas(fenced, 6, "entity.name.tag.lore")).toBe(true);
  });

  test("a fence with a known language embeds that language's grammar", () => {
    const fenced = tokenize(["<rule id=\"a\">", "  Shown:", "  ```ts", "  const price = quote.total", "  ```", "  ~~~TSX title", "  <Price />", "  ~~~", "</rule>"].join("\n"));
    expect(tokenScopes(fenced, 4, "price")).toContain("meta.embedded.block.typescript");
    expect(tokenScopes(fenced, 7, "Price")).toContain("meta.embedded.block.typescriptreact");
    expect(lineHas(fenced, 9, "entity.name.tag.lore")).toBe(true);
  });

  test("a fence with an unknown language or a longer info word embeds nothing", () => {
    const fenced = tokenize(["<rule id=\"a\">", "```tsql", "SELECT 1", "```", "```cobol", "MOVE A TO B", "```", "</rule>"].join("\n"));
    const embedsCode = (line: number) =>
      [...scopesOf(fenced[line - 1]!)].some((scope) => scope.startsWith("meta.embedded.block.") && scope !== "meta.embedded.block.markdown");
    expect(lineHas(fenced, 3, "markup.fenced_code.block.markdown")).toBe(true);
    expect(embedsCode(3)).toBe(false);
    expect(embedsCode(6)).toBe(false);
  });

  test("an embedded construct left open ends at the closing fence", () => {
    const fenced = tokenize(["<rule id=\"a\">", "```ts", "/* never closed", "```", "</rule>", "<rule id=\"b\">", "Text.", "</rule>"].join("\n"));
    expect(lineHas(fenced, 3, "comment.block.embedded")).toBe(true);
    expect(lineHas(fenced, 4, "comment.block.embedded")).toBe(false);
    expect(lineHas(fenced, 5, "entity.name.tag.lore")).toBe(true);
    expect(lineHas(fenced, 6, "entity.name.tag.lore")).toBe(true);
  });

  test("a closing fence must use the opening fence's character", () => {
    const fenced = tokenize(["<rule id=\"a\">", "```ts", "x", "~~~", "y", "```", "</rule>"].join("\n"));
    expect(lineHas(fenced, 5, "markup.fenced_code.block.markdown")).toBe(true);
    expect(lineHas(fenced, 7, "entity.name.tag.lore")).toBe(true);
  });

  test("a </context> line in a rule's prose is prose", () => {
    const mixed = tokenize(["<rule id=\"a\">", "Text.", "</context>", "</rule>"].join("\n"));
    expect(lineHas(mixed, 3, "entity.name.tag.lore")).toBe(false);
    expect(lineHas(mixed, 4, "entity.name.tag.lore")).toBe(true);
  });

  test("an indented tag line at the top level is not a tag", () => {
    const stray = tokenize(["  <rule id=\"a\">", "Text."].join("\n"));
    expect(lineHas(stray, 1, "entity.name.tag.lore")).toBe(false);
  });
});
