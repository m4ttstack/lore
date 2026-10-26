import Ajv from "ajv/dist/2020";
import { extractExamples, type Example } from "./extract";

export interface Problem { rule: string; line: number; message: string }
export interface RegistryEntry { name: string; kind: "error" | "warning"; description: string }
export type SchemaName = "defaults" | "scope" | "when" | "meta" | "loreconfig" | "document-model" | "eligibility";
export type SchemaSet = Record<SchemaName, object>;

export interface SpecSection { name: string; level: number; line: number; exempt: boolean; normative: boolean; examples: number }

const EXEMPT = new Set([
  "Introduction",
  "Conventions",
  "Conformance examples",
  "Document model",
  "Errors and warnings",
  "For agents (non-normative)",
  "Adopting Lore (non-normative)",
]);
const REGISTRY_HEADING = "Errors and warnings";
const AGENT_HEADING = "For agents (non-normative)";
const HEADING = /^(#{2,3})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
const EXAMPLE_CLOSE = /^`{6}$/;
const RFC_2119 = /\b(MUST|REQUIRED|SHALL|SHOULD|RECOMMENDED|MAY|OPTIONAL)\b/;
const INLINE_CODE = /(`+).*?\1/g;
const FILE_LINE = /^([AMD]) (\S(?:.*\S)?)$/;
const RENAME_LINE = /^R (\S(?:.*?\S)?) -> (\S(?:.*\S)?)$/;
const PLUS_LINE = /^\+([1-9]\d*) (.*)$/;

const CAPABILITIES = new Set(["regex", "ast-grep"]);
const CHECK_TAG = /^[ \t]*<check[ \t>]/m;

interface Diagnostic { name: string; file: string; entry: string | null; line: number }
interface Hit { rule: string; file: string; line: number; text: string }
interface Entry { id: string; file: string }
interface Expected { entries?: Entry[]; errors?: Diagnostic[]; warnings?: Diagnostic[]; excluded?: Diagnostic[]; eligible?: string[]; hits?: Hit[] }

export function checkSpec(input: { markdown: string; registry: RegistryEntry[]; schemas: SchemaSet; agent?: string }): Problem[] {
  const { markdown, registry, schemas, agent } = input;
  const problems: Problem[] = [];
  const cr = markdown.indexOf("\r");
  if (cr >= 0) problems.push({ rule: "cr", line: markdown.slice(0, cr).split("\n").length, message: "the spec contains a CR character" });

  let examples: Example[];
  try {
    examples = extractExamples(markdown);
  } catch (e) {
    const message = (e as Error).message;
    return [...problems, { rule: "extract", line: Number(/line (\d+)/.exec(message)?.[1] ?? 1), message }];
  }

  const ajv = new Ajv({ allErrors: true, strict: true });
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);
  const known = new Set(registry.map((r) => r.name));
  const tested = new Set<string>();

  for (const ex of examples) {
    const report = (rule: string, message: string) => problems.push({ rule, line: ex.line, message: `example ${ex.number}: ${message}` });
    if (ex.kind !== "parse" && ex.kind !== "eligibility") {
      report("kind", `unknown kind "${ex.kind}"`);
      continue;
    }
    if (ex.files.length === 0) report("inputs", "no input file");
    for (const r of ex.requires) if (!CAPABILITIES.has(r)) report("requires", `unknown capability "${r}"`);
    if (ex.kind === "eligibility" && ex.requires.length === 0 && ex.files.some((f) => CHECK_TAG.test(f.content))) {
      report("requires", "an eligibility example whose inputs hold a <check> needs a requires line");
    }
    if (ex.remote !== null && (ex.remote === "" || ex.remote.includes("\n"))) report("remote", "the remote section is not one line");
    if (ex.kind === "eligibility" && ex.diff === null) report("diff", "an eligibility example needs a diff");
    if (ex.kind === "parse" && (ex.diff !== null || ex.remote !== null)) report("diff", "a parse example takes no diff or remote");
    if (ex.diff !== null) checkDiff(ex, report);

    if (ex.expect === null) {
      report("expect", "no expect section");
      continue;
    }
    let value: Expected;
    try {
      value = JSON.parse(ex.expect);
    } catch {
      report("expect", "expect is not JSON");
      continue;
    }
    const schema = schemas[ex.kind === "parse" ? "document-model" : "eligibility"] as { $id: string };
    const validate = ajv.getSchema(schema.$id)!;
    if (!validate(value)) {
      report("expect", `expect fails the ${ex.kind} schema: ${ajv.errorsText(validate.errors)}`);
      continue;
    }

    const lists = ex.kind === "parse" ? { errors: value.errors!, warnings: value.warnings! } : { excluded: value.excluded!, warnings: value.warnings! };
    const diagnostics = Object.values(lists).flat();
    for (const { name } of diagnostics) {
      tested.add(name);
      if (!known.has(name)) report("unknown-name", `"${name}" is not in the registry`);
    }
    checkReferences(ex, diagnostics, value.entries ?? [], report);
    for (const [list, items] of Object.entries(lists)) {
      if (!inOrder(items, compareDiagnostics)) report("order", `${list} are out of order`);
    }
    if (ex.kind === "parse" && !inOrder(value.entries!, (a, b) => compare(a.file, b.file) || position(ex, a) - position(ex, b))) {
      report("order", "entries are out of order");
    }
    if (ex.kind === "eligibility") {
      const eligible = value.eligible!;
      if (eligible.some((id, i) => i > 0 && compare(eligible[i - 1]!, id) >= 0)) report("sorted", "eligible is not strictly ascending");
      if (!inOrder(value.hits!, (a, b) => compare(a.rule, b.rule) || compare(a.file, b.file) || a.line - b.line)) report("order", "hits are out of order");
      const ids = new Set([...eligible, ...value.hits!.map((h) => h.rule)]);
      for (const id of ids) {
        if (!ex.files.some((f) => f.content.includes(`id="${id}"`))) report("unknown-id", `"${id}" does not appear in the inputs`);
      }
    }
  }

  const sections = specSections(markdown, examples);
  for (const s of sections) {
    if (!s.exempt && s.normative && s.examples === 0) {
      problems.push({ rule: "coverage", line: s.line, message: `section "${s.name}" uses RFC 2119 keywords but has no example` });
    }
  }

  const registryHeading = sections.find((s) => s.level === 2 && s.name === REGISTRY_HEADING);
  if (registryHeading) {
    for (const r of registry) {
      if (!tested.has(r.name)) problems.push({ rule: "untested-name", line: 1, message: `"${r.name}" appears in no example's expect` });
    }
    for (const message of checkRegistryTable(markdown.split("\n").slice(registryHeading.line), registry)) {
      problems.push({ rule: "registry-table", line: 1, message });
    }
  }

  const agentHeading = sections.find((s) => s.level === 2 && s.name === AGENT_HEADING);
  if (agentHeading) {
    const message = checkAgentCopy(markdown.split("\n").slice(agentHeading.line), agent);
    if (message) problems.push({ rule: "agent-copy", line: agentHeading.line, message });
  }
  return problems;
}

function compare(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const entry = a.entry === b.entry ? 0 : a.entry === null ? -1 : b.entry === null ? 1 : compare(a.entry, b.entry);
  return compare(a.file, b.file) || a.line - b.line || compare(a.name, b.name) || entry;
}

function inOrder<T>(items: T[], cmp: (a: T, b: T) => number): boolean {
  return items.every((item, i) => i === 0 || cmp(items[i - 1]!, item) <= 0);
}

function position(ex: Example, entry: Entry): number {
  const tag = new RegExp(`^<(rule|context)[ \\t](?:[^>]*[ \\t])?id="${entry.id}"`);
  return ex.files.find((f) => f.path === entry.file)?.content.split("\n").findIndex((l) => tag.test(l)) ?? -1;
}

function checkReferences(ex: Example, diagnostics: Diagnostic[], entries: Entry[], report: (rule: string, message: string) => void): void {
  const paths = new Set(ex.files.map((f) => f.path));
  for (const text of ex.diff?.split("\n") ?? []) {
    const file = FILE_LINE.exec(text);
    const rename = RENAME_LINE.exec(text);
    if (file) paths.add(file[2]!);
    if (rename) paths.add(rename[1]!).add(rename[2]!);
  }
  for (const { file } of [...diagnostics, ...entries]) {
    if (!paths.has(file)) report("unknown-file", `"${file}" is neither an input nor a diff path`);
  }
  for (const { file, entry } of diagnostics) {
    if (entry === null) continue;
    const own = ex.files.find((f) => f.path === file);
    const where = file.endsWith(".lore") && own ? [own] : ex.files;
    if (!where.some((f) => f.content.includes(`id="${entry}"`))) report("unknown-entry", `"${entry}" does not appear as an id in ${file.endsWith(".lore") ? file : "the inputs"}`);
  }
}

function checkAgentCopy(lines: string[], agent: string | undefined): string | null {
  if (agent === undefined) return `"## ${AGENT_HEADING}" exists but no AGENT.md text was given`;
  const end = lines.findIndex((l) => l.startsWith("## "));
  const open = lines.findIndex((l, i) => (end < 0 || i < end) && /^`{3,}markdown[ \t]*$/.test(l));
  if (open < 0) return `"## ${AGENT_HEADING}" has no markdown fence`;
  const ticks = /^`+/.exec(lines[open]!)![0].length;
  const close = lines.findIndex((l, i) => i > open && new RegExp(`^\`{${ticks},}[ \t]*$`).test(l));
  if (close < 0) return "the markdown fence is not closed";
  const quoted = lines.slice(open + 1, close).map((l) => l + "\n").join("");
  return quoted === agent ? null : "the markdown fence does not equal spec/AGENT.md";
}

function checkDiff(ex: Example, report: (rule: string, message: string) => void): void {
  let target: string | null = null;
  for (const [i, text] of ex.diff!.split("\n").entries()) {
    const bad = (why: string) => report("diff-syntax", `diff line ${i + 1} ${why}: "${text}"`);
    const file = FILE_LINE.exec(text);
    const rename = RENAME_LINE.exec(text);
    const plus = PLUS_LINE.exec(text);
    if (file?.[1] === "D" && ex.files.some((f) => f.path === file[2])) report("diff-agrees", `diff line ${i + 1} deletes "${file[2]}", which is an input file`);
    if (file) target = file[1] === "D" ? null : file[2]!;
    else if (rename) target = rename[2]!;
    else if (!plus) bad("is malformed");
    else if (target === null) bad("is a + line without an A, M or R file line before it");
    else {
      const n = Number(plus[1]);
      const input = ex.files.find((f) => f.path === target);
      const actual = input?.content.split("\n")[n - 1];
      if (input && actual !== plus[2]) {
        report("diff-agrees", `diff line ${i + 1} says line ${n} of ${target} is "${plus[2]}" but the input has ${actual === undefined ? "no such line" : `"${actual}"`}`);
      }
    }
  }
}

export function specSections(markdown: string, examples: Example[]): SpecSection[] {
  const sections: SpecSection[] = [];
  const exampleLines = new Set(examples.map((e) => e.line));
  let parentExempt = false;
  let closer: RegExp | null = null;

  for (const [i, text] of markdown.split("\n").entries()) {
    const current = sections.at(-1);
    if (closer !== null) {
      if (closer.test(text)) closer = null;
      continue;
    }
    const open = FENCE_OPEN.exec(text);
    if (open) {
      const isExample = exampleLines.has(i + 1);
      closer = isExample ? EXAMPLE_CLOSE : new RegExp(`^${open[1]![0]}{${open[1]!.length},}[ \\t]*$`);
      if (isExample && current) current.examples++;
      continue;
    }
    const heading = HEADING.exec(text);
    if (heading) {
      const [, level, name] = heading as unknown as [string, string, string];
      if (level === "##") parentExempt = EXEMPT.has(name);
      sections.push({ name, level: level.length, line: i + 1, exempt: parentExempt || EXEMPT.has(name), normative: false, examples: 0 });
      continue;
    }
    if (current && RFC_2119.test(text.replace(INLINE_CODE, ""))) current.normative = true;
  }
  return sections;
}

function checkRegistryTable(lines: string[], registry: RegistryEntry[]): string[] {
  const start = lines.findIndex((l) => l.trimStart().startsWith("|"));
  if (start < 0) return [`no table follows "## ${REGISTRY_HEADING}"`];
  const table: string[][] = [];
  for (let i = start; i < lines.length && lines[i]!.trimStart().startsWith("|"); i++) table.push(cells(lines[i]!));

  const [header, , ...rows] = table;
  if (header!.join(" | ") !== "Name | Kind | Description") return [`table columns are "${header!.join(" | ")}", not "Name | Kind | Description"`];

  const problems: string[] = [];
  for (let i = 0; i < Math.max(rows.length, registry.length); i++) {
    const row = rows[i];
    const entry = registry[i];
    const name = row ? /^`([^`]+)`$/.exec(row[0] ?? "")?.[1] : undefined;
    if (row && name === undefined) problems.push(`row ${i + 1}: name cell "${row[0]}" is not in backticks`);
    else if (!row) problems.push(`row ${i + 1}: table is missing "${entry!.name}"`);
    else if (!entry) problems.push(`row ${i + 1}: "${name}" is not in the registry`);
    else if (name !== entry.name || row[1] !== entry.kind) {
      problems.push(`row ${i + 1}: table has "${name}" (${row[1]}), registry has "${entry.name}" (${entry.kind})`);
    } else if (row[2] !== entry.description) {
      problems.push(`row ${i + 1}: "${name}" is described as "${row[2]}" in the table but "${entry.description}" in the registry`);
    }
  }
  return problems;
}

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
