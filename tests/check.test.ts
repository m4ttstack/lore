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
    "## Notes\nThe word `MUST` is code.\n```\nThis MUST be ignored.\n```\nLowercase must is fine. MUSTARD too.\n## Errors and warnings",
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
  const problems = check(clean.slice(0, clean.indexOf("\n| Name")));
  expect(problems).toContainEqual(expect.objectContaining({ rule: "registry-table", line: 1 }));
});

test("extract: a malformed example becomes one problem", () => {
  expect(check(clean + "\n" + F + "example parse\n=== x")).toEqual([
    { rule: "extract", line: 31, message: "unterminated example opened at line 31" },
  ]);
});

test("agent-copy: the For agents quote must equal AGENT.md", () => {
  const agent = "# Lore v1 agent instructions\n\n1. Read the rules.\n";
  const section = "\n## For agents (non-normative)\nIt reads:\n\n```markdown\n" + agent + "```\n\nMore prose.";
  const run = (md: string, text?: string) => checkSpec({ markdown: md, registry, schemas, agent: text }).map((p) => p.rule);
  expect(run(clean + section, agent)).toEqual([]);
  expect(run(clean, undefined)).toEqual([]);
  expect(run(clean + section.replace("Read the rules.", "Read the rules"), agent)).toEqual(["agent-copy"]);
  expect(run(clean + section, agent + "2. Report.\n")).toEqual(["agent-copy"]);
  expect(run(clean + section.replace("```markdown", "```"), agent)).toEqual(["agent-copy"]);
  expect(run(clean + section, undefined)).toEqual(["agent-copy"]);
});

const ruleEntry = (id: string, file = "lore/a.lore") => ({
  kind: "rule", id, file, category: "code_style", severity: "advisory", disabled: false,
  scopes: [{ files: ["**"], ignores: [] }], when: null, checks: [], meta: null, summary: "", prose: "", src: null,
});
const diag = (name: string, file: string, entry: string | null, line: number) => ({ name, file, entry, line });
const withParse = (value: object, md = clean) => swap(parseExpect, JSON.stringify(value), md);
const withElig = (value: object, md = clean) => swap(eligExpect, JSON.stringify(value), md);
const shape = (md: string) => rules(md).filter((r) => r !== "untested-name");

test("order: diagnostics are ordered by file, line, name, then entry with null first", () => {
  const md = swap('<rule id="a-rule">', '<rule id="a-rule">\n<rule id="c-rule">\n=== lore/z.lore\n<rule id="z-rule">');
  const errs = (errors: object[]) => shape(withParse({ entries: [], errors, warnings: [] }, md));
  expect(errs([diag("bad-thing", "lore/a.lore", null, 1), diag("bad-thing", "lore/a.lore", null, 2)])).toEqual([]);
  expect(errs([diag("bad-thing", "lore/z.lore", null, 1), diag("bad-thing", "lore/a.lore", null, 2)])).toEqual(["order"]);
  expect(errs([diag("bad-thing", "lore/a.lore", null, 2), diag("bad-thing", "lore/a.lore", null, 1)])).toEqual(["order"]);
  expect(errs([diag("odd-thing", "lore/a.lore", null, 1), diag("bad-thing", "lore/a.lore", null, 1)])).toEqual(["order"]);
  expect(errs([diag("bad-thing", "lore/a.lore", "a-rule", 1), diag("bad-thing", "lore/a.lore", null, 1)])).toEqual(["order"]);
  expect(errs([diag("bad-thing", "lore/a.lore", "c-rule", 1), diag("bad-thing", "lore/a.lore", "a-rule", 1)])).toEqual(["order"]);
  const warnings = [diag("odd-thing", "lore/a.lore", null, 2), diag("odd-thing", "lore/a.lore", null, 1)];
  expect(shape(withParse({ entries: [], errors: [], warnings }, md))).toEqual(["order"]);
  const excluded = [diag("bad-thing", "lore/b.lore", null, 2), diag("bad-thing", "lore/b.lore", null, 1)];
  expect(shape(withElig({ eligible: [], hits: [], excluded, warnings: [] }))).toEqual(["order"]);
});

test("order: entries are ordered by file, then position in the file", () => {
  const md = swap('<rule id="a-rule">', '<rule id="a-rule">\n<rule id="c-rule">\n=== lore/0.lore\n<rule id="z-rule">');
  const entries = (...list: object[]) => shape(withParse({ entries: list, errors: [], warnings: [] }, md));
  expect(entries(ruleEntry("z-rule", "lore/0.lore"), ruleEntry("a-rule"), ruleEntry("c-rule"))).toEqual([]);
  expect(entries(ruleEntry("c-rule"), ruleEntry("a-rule"))).toEqual(["order"]);
  expect(entries(ruleEntry("a-rule"), ruleEntry("z-rule", "lore/0.lore"))).toEqual(["order"]);
});

test("order: hits are ordered by rule, file, then line", () => {
  const md = swap('<rule id="b-rule">', '<rule id="b-rule">\n<rule id="c-rule">');
  const hit = (rule: string, file: string, line: number) => ({ rule, file, line, text: "two" });
  const hits = (...list: object[]) => shape(withElig({ eligible: ["b-rule", "c-rule"], hits: list, excluded: [], warnings: [] }, md));
  expect(hits(hit("b-rule", "src/x.ts", 1), hit("b-rule", "src/x.ts", 2), hit("c-rule", "src/a.ts", 1))).toEqual([]);
  expect(hits(hit("b-rule", "src/x.ts", 2), hit("b-rule", "src/x.ts", 1))).toEqual(["order"]);
  expect(hits(hit("c-rule", "src/a.ts", 1), hit("b-rule", "src/x.ts", 1))).toEqual(["order"]);
  expect(hits(hit("b-rule", "src/y.ts", 1), hit("b-rule", "src/x.ts", 1))).toEqual(["order"]);
});

test("order: strings compare by code point", () => {
  const astral = "lore/\u{1F600}.lore";
  const bmp = "lore/�.lore";
  const md = swap('<rule id="a-rule">', `<rule id="a-rule">\n=== ${astral}\nx\n=== ${bmp}\ny`);
  const errors = [diag("bad-thing", bmp, null, 1), diag("bad-thing", astral, null, 1)];
  expect(shape(withParse({ entries: [], errors, warnings: [] }, md))).toEqual([]);
  expect(shape(withParse({ entries: [], errors: [...errors].reverse(), warnings: [] }, md))).toEqual(["order"]);
});

test("unknown-file: a diagnostic's file is an input or a diff path", () => {
  expect(shape(withParse({ entries: [], errors: [diag("bad-thing", "lore/q.lore", null, 1)], warnings: [] }))).toEqual(["unknown-file"]);
  expect(shape(withParse({ entries: [ruleEntry("a-rule", "lore/q.lore")], errors: [], warnings: [] }))).toEqual(["unknown-file"]);
  const warnings = [diag("odd-thing", "src/x.ts", "b-rule", 1)];
  expect(shape(withElig({ eligible: ["b-rule"], hits: [], excluded: [], warnings }))).toEqual([]);
  const excluded = [diag("bad-thing", "src/q.ts", null, 1)];
  expect(shape(withElig({ eligible: ["b-rule"], hits: [], excluded, warnings: [] }))).toEqual(["unknown-file"]);
});

test("unknown-entry: a diagnostic's entry is an id in its Lore file, or in some input for another file", () => {
  expect(shape(withParse({ entries: [], errors: [diag("bad-thing", "lore/a.lore", "a-rule", 1)], warnings: [] }))).toEqual([]);
  expect(shape(withParse({ entries: [], errors: [diag("bad-thing", "lore/a.lore", "b-rule", 1)], warnings: [] }))).toEqual(["unknown-entry"]);
  const warnings = [diag("odd-thing", "src/x.ts", "q-rule", 1)];
  expect(shape(withElig({ eligible: ["b-rule"], hits: [], excluded: [], warnings }))).toEqual(["unknown-entry"]);
});

test("requires: values are regex or ast-grep", () => {
  const opener = F + "example eligibility";
  expect(rules(swap(opener, opener + "\nrequires: regex\nrequires: ast-grep"))).toEqual([]);
  expect(rules(swap(opener, opener + "\nrequires: git"))).toEqual(["requires"]);
});

test("requires: an eligibility example whose inputs hold a check needs requires", () => {
  const withCheck = swap('<rule id="b-rule">', '<rule id="b-rule">\n<check>\ntwo\n</check>');
  expect(rules(withCheck)).toEqual(["requires"]);
  expect(rules(swap(F + "example eligibility", F + "example eligibility\nrequires: regex", withCheck))).toEqual([]);
  expect(rules(swap('<rule id="a-rule">', '<rule id="a-rule">\n<check>\nx\n</check>'))).toEqual([]);
});

test("remote: the remote section is one line", () => {
  const add = (text: string) => swap("=== diff", `=== remote\n${text}\n=== diff`);
  expect(rules(add("https://github.com/acme/shop"))).toEqual([]);
  expect(rules(add("https://github.com/acme/shop\nhttps://github.com/acme/other"))).toEqual(["remote"]);
  expect(rules(add(""))).toEqual(["remote"]);
});

test("diff-agrees: a deleted path is not an input file", () => {
  expect(rules(swap("M src/x.ts\n+2 two", "D src/x.ts"))).toContain("diff-agrees");
  expect(rules(swap("M src/x.ts\n+2 two", "M src/x.ts\n+2 two\nD src/gone.ts"))).toEqual([]);
});

test("a repeated eligible id fails the eligibility schema", () => {
  expect(shape(withElig({ eligible: ["b-rule", "b-rule"], hits: [], excluded: [], warnings: [] }))).toEqual(["expect"]);
});

test("registry-table: descriptions must match the registry", () => {
  expect(rules(swap("| `bad-thing` | error | A bad thing. |", "| `bad-thing` | error | Reworded. |"))).toEqual(["registry-table"]);
});
