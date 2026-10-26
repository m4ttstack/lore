import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExamples } from "../tools/check/extract";
import { checkSpec, specSections, type RegistryEntry, type SchemaName, type SchemaSet } from "../tools/check/check";

const F = "``````";
const names: SchemaName[] = ["defaults", "scope", "when", "meta", "loreconfig", "document-model", "eligibility"];
const schemas = Object.fromEntries(
  names.map((n) => [n, JSON.parse(readFileSync(new URL(`../spec/schemas/${n}.schema.json`, import.meta.url), "utf8"))]),
) as SchemaSet;
const registry: RegistryEntry[] = [
  { name: "bad-thing", kind: "error", description: "A bad thing." },
  { name: "odd-thing", kind: "warning", description: "An odd thing." },
];

const parseExpect = JSON.stringify({
  entries: [],
  errors: [{ name: "bad-thing", file: "lore/a.lore", entry: null, line: 1 }],
  warnings: [],
});
const eligExpect = JSON.stringify({
  eligible: ["b-rule"],
  hits: [{ rule: "b-rule", file: "src/x.ts", line: 2, text: "two" }],
  excluded: [],
  warnings: [{ name: "odd-thing", file: "lore/b.lore", entry: "b-rule", line: 1 }],
});

const clean = [
  "# Lore",
  "## Introduction",
  "Implementations MUST read this.",
  "## Parsing",
  "A parser MUST report errors.",
  F + "example parse",
  "=== lore/a.lore",
  '<rule id="a-rule">',
  "=== expect",
  parseExpect,
  F,
  "## Eligibility",
  "A rule MUST match.",
  F + "example eligibility",
  "=== lore/b.lore",
  '<rule id="b-rule">',
  "=== src/x.ts",
  "one",
  "two",
  "=== diff",
  "M src/x.ts",
  "+2 two",
  "=== expect",
  eligExpect,
  F,
  "## Errors and warnings",
  "| Name | Kind | Description |",
  "|---|---|---|",
  "| `bad-thing` | error | A bad thing. |",
  "| `odd-thing` | warning | An odd thing. |",
].join("\n");

function check(markdown: string, reg: RegistryEntry[] = registry) {
  return checkSpec({ markdown, registry: reg, schemas });
}
function rules(markdown: string, reg?: RegistryEntry[]) {
  return check(markdown, reg).map((p) => p.rule);
}
function swap(from: string, to: string, md = clean): string {
  if (!md.includes(from)) throw new Error(`fixture lacks ${from}`);
  return md.replace(from, to);
}

test("a clean spec yields no problems", () => {
  expect(check(clean)).toEqual([]);
});

test("rejects CR characters", () => {
  const problems = check(swap("## Parsing\n", "## Parsing\r\n"));
  expect(problems).toContainEqual(expect.objectContaining({ rule: "cr", line: 4 }));
});

test("reports CR for a CRLF spec even when extraction fails", () => {
  expect(check(clean.replaceAll("\n", "\r\n"))).toContainEqual(expect.objectContaining({ rule: "cr", line: 1 }));
});

test("kind: rejects an unknown example kind", () => {
  const problems = check(swap(F + "example parse", F + "example lint"));
  expect(problems).toContainEqual(expect.objectContaining({ rule: "kind", line: 6 }));
});

test("inputs: an example needs an input file", () => {
  expect(rules(swap('=== lore/a.lore\n<rule id="a-rule">\n', ""))).toContain("inputs");
});

test("requires a diff exactly for eligibility examples", () => {
  expect(rules(swap("=== diff\nM src/x.ts\n+2 two\n", ""))).toContain("diff");
  expect(rules(swap("=== expect\n" + parseExpect, "=== diff\nA lore/a.lore\n=== expect\n" + parseExpect))).toContain("diff");
  const remote = "=== remote\ngit@example.com:acme/shop.git\n=== expect\n" + parseExpect;
  expect(rules(swap("=== expect\n" + parseExpect, remote))).toContain("diff");
});

test("diff-syntax: rejects malformed diff lines", () => {
  const bad = ["X src/x.ts", "R src/x.ts", "", "M  src/x.ts"];
  for (const line of bad) expect(rules(swap("M src/x.ts\n", `${line}\nM src/x.ts\n`))).toContain("diff-syntax");
  for (const line of ["+0 two", "+2two"]) expect(rules(swap("M src/x.ts\n", `M src/x.ts\n${line}\n`))).toContain("diff-syntax");
  expect(rules(swap("M src/x.ts\n+2 two", "+2 two\nM src/x.ts"))).toContain("diff-syntax");
  expect(rules(swap("M src/x.ts\n+2 two", "D src/x.ts\n+2 two"))).toContain("diff-syntax");
  expect(rules(swap("M src/x.ts\n+2 two", "D src/old.ts\nA src/new.ts\nR src/y.ts -> src/x.ts\n+2 two"))).toEqual([]);
});

test("expect: missing, not JSON, or failing its schema", () => {
  expect(rules(swap("=== expect\n" + parseExpect, ""))).toContain("expect");
  expect(rules(swap(parseExpect, "{not json"))).toContain("expect");
  expect(rules(swap(parseExpect, JSON.stringify({ entries: [] })))).toContain("expect");
  expect(rules(swap(eligExpect, JSON.stringify({ eligible: [] })))).toContain("expect");
});

test("sorted: eligible ids must be sorted", () => {
  const md = swap('<rule id="b-rule">', '<rule id="b-rule">\n<rule id="a-rule">');
  const unsorted = JSON.parse(eligExpect);
  unsorted.eligible = ["b-rule", "a-rule"];
  expect(rules(swap(eligExpect, JSON.stringify(unsorted), md))).toEqual(["sorted"]);
});

test("unknown-name: expect names must be in the registry", () => {
  expect(rules(swap('"name":"bad-thing"', '"name":"nope"'))).toContain("unknown-name");
  expect(rules(swap('"name":"odd-thing"', '"name":"nope"'))).toContain("unknown-name");
});

test("unknown-id: eligible and hit ids must appear in the inputs", () => {
  expect(rules(swap('<rule id="b-rule">', '<rule id="c-rule">'))).toContain("unknown-id");
  const hit = JSON.parse(eligExpect);
  hit.hits[0].rule = "c-rule";
  expect(rules(swap(eligExpect, JSON.stringify(hit)))).toContain("unknown-id");
});

test("checks + lines against a matching input file", () => {
  const problems = check(swap("+2 two", "+2 one"));
  expect(problems).toContainEqual(expect.objectContaining({ rule: "diff-agrees", line: 14 }));
  expect(rules(swap("+2 two", "+3 two"))).toContain("diff-agrees");
  expect(rules(swap("M src/x.ts\n+2 two", "A src/other.ts\n+2 anything"))).toEqual([]);
});

test("never parses example inputs", () => {
  expect(check(swap('<rule id="a-rule">', "key: [unclosed\n  : : {"))).toEqual([]);
});

test("coverage: a normative section needs an example", () => {
  const md = swap("## Eligibility", "### Scoping\nScopes SHOULD be narrow.\n## Eligibility");
  expect(check(md)).toContainEqual(expect.objectContaining({ rule: "coverage", line: 12 }));
});

test("coverage: a parent's examples do not cover its subsections", () => {
  const md = swap("## Eligibility\nA rule MUST match.", "## Eligibility\nA rule MUST match.\n### Hits\nHits MAY repeat.");
  expect(rules(md)).toContain("coverage");
  const child = swap("## Eligibility\nA rule MUST match.", "## Eligibility\nA rule matches.\n### Hits\nHits MAY repeat.");
  expect(rules(child)).toEqual([]);
});

test("ignores RFC words inside examples and code", () => {
  const md = swap(
    "## Errors and warnings",
    "## Notes\nThe word `MUST` is code.\n" + F + "example parse\n=== lore/c.lore\nThis MUST be ignored.\n=== expect\n" + parseExpect + "\n" + F + "\n```\nThis MUST be ignored.\n```\nLowercase must is fine. MUSTARD too.\n## Errors and warnings",
  );
  expect(check(md)).toEqual([]);
});

test("an example input line of 6+ backticks does not end the example early", () => {
  const md = swap('<rule id="a-rule">', '<rule id="a-rule">\n`````` \n```````');
  expect(check(md)).toEqual([]);
  const uncovered = swap("## Errors and warnings", "## Late\nThis MUST be covered.\n## Errors and warnings", md);
  expect(rules(uncovered)).toEqual(["coverage"]);
});

test("a keyword inside an example body does not make its section normative", () => {
  const md = "## Notes\nPlain prose.\n" + F + "example parse\n=== lore/c.lore\nThis MUST be ignored.\n" + F;
  expect(specSections(md, extractExamples(md)).map((s) => s.normative)).toEqual([false]);
});

test("exempt sections need no example", () => {
  const md = swap("## Errors and warnings", "## Conventions\nWords MUST mean.\n### Keywords\nThey SHALL.\n## Errors and warnings");
  expect(check(md)).toEqual([]);
});

test("untested-name: every registry name needs an expect", () => {
  const reg = [...registry, { name: "never-seen", kind: "error" as const, description: "x" }];
  const md = clean + "\n| `never-seen` | error | x |";
  expect(check(md, reg)).toEqual([expect.objectContaining({ rule: "untested-name", line: 1 })]);
});

test("untested-name and registry-table wait for the errors heading", () => {
  const md = clean.slice(0, clean.indexOf("## Errors and warnings"));
  expect(check(md, [...registry, { name: "never-seen", kind: "error", description: "x" }])).toEqual([]);
});

test("registry-table: the table must mirror the registry", () => {
  expect(rules(swap("| Name | Kind | Description |", "| Name | Type | Description |"))).toContain("registry-table");
  expect(rules(swap("| `bad-thing` | error |", "| bad-thing | error |"))).toContain("registry-table");
  expect(rules(swap("| `bad-thing` | error |", "| `bad-thing` | warning |"))).toContain("registry-table");
  expect(rules(swap("\n| `odd-thing` | warning | An odd thing. |", ""))).toContain("registry-table");
  expect(rules(clean, [registry[1]!, registry[0]!])).toContain("registry-table");
  expect(rules(swap("| `bad-thing` | error | A bad thing. |", "| `bad-thing` | error | Reworded. |"))).toEqual([]);
  const problems = check(clean.slice(0, clean.indexOf("\n| Name")));
  expect(problems).toContainEqual(expect.objectContaining({ rule: "registry-table", line: 1 }));
});

test("extract: a malformed example becomes one problem", () => {
  expect(check(clean + "\n" + F + "example parse\n=== x")).toEqual([
    { rule: "extract", line: 31, message: "unterminated example opened at line 31" },
  ]);
});
