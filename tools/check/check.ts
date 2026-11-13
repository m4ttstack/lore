import Ajv from "ajv/dist/2020";
import { checkSource } from "../../packages/parser/src/blocks";
import { dedentEntry } from "../../packages/parser/src/indent";
import { LOCK_NAME, isRealDate, readReviews, type ReviewRecord } from "../../packages/parser/src/reviews";
import { parseFile, readAttributes, type EntryNode } from "../../packages/parser/src/scan";
import { readBlock } from "../../packages/parser/src/yaml";
import { extractExamples, type Example } from "./extract";

export interface Problem { rule: string; line: number; message: string }
export interface RegistryEntry { name: string; kind: "error" | "warning"; description: string }
export type SchemaName = "defaults" | "scope" | "when" | "meta" | "loreconfig" | "document-model" | "eligibility" | "audit";
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
const AUDIT_HEADING = "Auditing sources";
const HEADING = /^(#{2,3})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
const EXAMPLE_CLOSE = /^`{6}$/;
const RFC_2119 = /\b(MUST|REQUIRED|SHALL|SHOULD|RECOMMENDED|MAY|OPTIONAL)\b/;
const INLINE_CODE = /(`+).*?\1/g;
const FILE_LINE = /^([AMD]) (\S(?:.*\S)?)$/;
const RENAME_LINE = /^R (\S(?:.*?\S)?) -> (\S(?:.*\S)?)$/;
const PLUS_LINE = /^\+([1-9]\d*) (.*)$/;
const MINUS_LINE = /^-([1-9]\d*) (.*)$/;

const CAPABILITIES = new Set(["regex", "ast-grep", "loose-given-folder"]);
const LOOSE_FOLDER_FILE = "loose:.";
const CHECK_TAG = /^[ \t]*<check[ \t>]/m;
// An example cannot say that a file could not be looked at, so this finding has no example.
const UNEXAMPLED_FINDINGS = new Set(["source-unchecked"]);

interface Diagnostic { name: string; file: string; entry: string | null; line: number }
interface Hit { rule: string; file: string; line: number; text: string; side?: "new" | "old" }
interface Entry { id: string; file: string }
interface Expected { entries?: Entry[]; errors?: Diagnostic[]; warnings?: Diagnostic[]; excluded?: Diagnostic[]; eligible?: string[]; hits?: Hit[] }
interface Cited { file: string; heading: string | null; phrase: string | null }
interface Finding { name: string; rule: string | null; file: string; source: Cited | null }
interface AuditExpected { findings: Finding[]; summary: { counts: Record<string, number>; rulesWithSource: number; rulesWithoutSource: number } }
interface WrittenRule { id: string | null; sources: Partial<Cited>[]; hasSource: boolean }
interface WrittenFile { path: string; rules: WrittenRule[]; stop: { name: string; line: number } | undefined }

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
  const findingNames = (schemas.audit as { $defs: { findingName: { enum: string[] } } }).$defs.findingName.enum;
  const testedFindings = new Set<string>();

  for (const ex of examples) {
    const report = (rule: string, message: string) => problems.push({ rule, line: ex.line, message: `example ${ex.number}: ${message}` });
    if (ex.kind !== "parse" && ex.kind !== "eligibility" && ex.kind !== "audit") {
      report("kind", `unknown kind "${ex.kind}"`);
      continue;
    }
    if (ex.files.length === 0) report("inputs", "no input file");
    if (ex.kind !== "eligibility" && ex.files.some((f) => f.place === "rules")) report("sections", `a ${ex.kind} example takes no rules: section`);
    for (const r of ex.requires) if (!CAPABILITIES.has(r)) report("requires", `unknown capability "${r}"`);
    if (ex.kind === "eligibility" && ex.requires.length === 0 && ex.files.some((f) => CHECK_TAG.test(f.content))) {
      report("requires", "an eligibility example whose inputs hold a <check> needs a requires line");
    }
    if (ex.files.some((f) => f.place === "loose") && !ex.requires.includes("loose-given-folder")) {
      report("requires", "an example with a loose: section needs requires: loose-given-folder");
    }
    if (ex.remote !== null && (ex.remote === "" || ex.remote.includes("\n"))) report("remote", "the remote section is not one line");
    if (ex.kind === "eligibility" && ex.diff === null) report("diff", "an eligibility example needs a diff");
    if (ex.kind !== "eligibility" && ex.diff !== null) report("diff", `a ${ex.kind} example takes no diff`);
    if (ex.kind === "parse" && ex.remote !== null) report("remote", "a parse example takes no remote");
    if (ex.kind === "audit" && (ex.today === null || !isRealDate(ex.today))) report("today", "an audit example needs a today section of one YYYY-MM-DD line");
    if (ex.kind !== "audit" && ex.today !== null) report("today", `a ${ex.kind} example takes no today section`);
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
    const schema = schemas[ex.kind === "parse" ? "document-model" : ex.kind === "eligibility" ? "eligibility" : "audit"] as { $id: string };
    const validate = ajv.getSchema(schema.$id)!;
    if (!validate(value)) {
      report("expect", `expect fails the ${ex.kind} schema: ${ajv.errorsText(validate.errors)}`);
      continue;
    }
    if (ex.kind === "audit") {
      const audit = value as unknown as AuditExpected;
      for (const { name } of audit.findings) testedFindings.add(name);
      checkAudit(ex, audit, findingNames, report);
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
      if (!inOrder(value.hits!, (a, b) => compare(a.rule, b.rule) || compare(a.file, b.file) || Number(a.side === "old") - Number(b.side === "old") || a.line - b.line)) report("order", "hits are out of order");
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

  if (sections.some((s) => s.level === 2 && s.name === AUDIT_HEADING)) {
    for (const name of findingNames) {
      if (testedFindings.has(name) || UNEXAMPLED_FINDINGS.has(name)) continue;
      problems.push({ rule: "untested-finding", line: 1, message: `"${name}" appears in no audit example's expect` });
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
    if (file === LOOSE_FOLDER_FILE && ex.files.some((f) => f.place === "loose")) continue;
    if (!paths.has(file)) report("unknown-file", `"${file}" is neither an input nor a diff path`);
  }
  for (const { file, entry } of diagnostics) {
    if (entry === null) continue;
    const own = ex.files.find((f) => f.path === file);
    const where = file.endsWith(".lore") && own ? [own] : ex.files;
    if (!where.some((f) => f.content.includes(`id="${entry}"`))) report("unknown-entry", `"${entry}" does not appear as an id in ${file.endsWith(".lore") ? file : "the inputs"}`);
  }
}

// A finding must fit the inputs as written: its rule's id and source, or for orphan-review a record of its lock file.
// Paths are compared by their last name only, and the rule counts only within bounds, since resolving paths and
// collecting rules are what the examples test.
function checkAudit(ex: Example, value: AuditExpected, names: string[], report: (rule: string, message: string) => void): void {
  const locks = new Map<string, ReviewRecord[]>();
  for (const { path, content } of ex.files) {
    if (path.split("/").at(-1) !== LOCK_NAME) continue;
    const read = readReviews(content);
    if ("problem" in read) report("lock-file", `"${path}" is malformed at line ${read.line}: ${read.problem}`);
    else locks.set(path, read.records);
  }
  const written = ex.files.filter((f) => f.path.endsWith(".lore")).map((f) => writtenFile(f.path, f.content));
  for (const { name, rule, file, source } of value.findings) {
    const own = ex.files.find((f) => f.path === file);
    if (own === undefined) {
      report("unknown-file", `"${file}" is not an input`);
      continue;
    }
    if (rule === null) continue;
    if (name === "orphan-review") {
      const records = locks.get(file)?.filter((record) => record.rule === rule) ?? [];
      if (!locks.has(file) || records.length === 0) report("unknown-entry", `no record of "${rule}" in ${file}`);
      else if (!records.some((record) => sameCited(record, source))) report("unknown-source", `no record of "${rule}" in ${file} has the finding's source`);
      continue;
    }
    const lore = written.find((w) => w.path === file);
    const candidates = lore?.rules.filter((r) => r.id === rule) ?? [];
    if (candidates.length === 0) {
      const stop = lore?.stop === undefined ? "" : `: its scan stops at line ${lore.stop.line} with ${lore.stop.name}`;
      report("unknown-entry", `"${rule}" does not appear in ${file}${stop}`);
    }
    else if (name === "meta-source" ? candidates.every((r) => r.hasSource) : !candidates.some((r) => r.sources.some((cited) => sameWritten(cited, source)))) {
      report("unknown-source", `"${rule}" in ${file} has no ${name === "meta-source" ? "rule without a <source>" : "source like the finding's"}`);
    }
  }
  const rule = (a: Finding, b: Finding) => (a.rule === b.rule ? 0 : a.rule === null ? -1 : b.rule === null ? 1 : compare(a.rule, b.rule));
  if (!inOrder(value.findings, (a, b) => compare(a.file, b.file) || rule(a, b) || names.indexOf(a.name) - names.indexOf(b.name))) {
    report("order", "findings are out of order");
  }
  const tally: Record<string, number> = {};
  for (const { name } of value.findings) tally[name] = (tally[name] ?? 0) + 1;
  const counts = value.summary.counts;
  if (Object.keys(counts).length !== Object.keys(tally).length || Object.entries(tally).some(([name, n]) => counts[name] !== n)) {
    report("counts", "summary counts are not the number of findings of each name");
  }
  const rules = written.flatMap((w) => w.rules);
  const named = (meta: boolean) =>
    new Set(value.findings.filter((f) => f.rule !== null && f.name !== "orphan-review" && (f.name === "meta-source") === meta).map((f) => JSON.stringify([f.file, f.rule]))).size;
  const bounds = [
    ["rulesWithSource", value.summary.rulesWithSource, named(false), rules.filter((r) => r.hasSource).length],
    ["rulesWithoutSource", value.summary.rulesWithoutSource, named(true), rules.filter((r) => !r.hasSource).length],
  ] as const;
  for (const [key, n, least, most] of bounds) {
    if (n < least || n > most) report("counts", `summary ${key} is ${n}, but the findings name ${least} such rules and the inputs hold ${most}`);
  }
}

// Each rule of a Lore file as the parser scans it, with the keys of its sources as the parser would accept them, before
// path resolution, and the error the scan stopped at, after which it reads no rule.
function writtenFile(path: string, content: string): WrittenFile {
  const lore = parseFile(path, content);
  const rules = lore.nodes
    .filter((node): node is EntryNode => node.kind === "entry" && node.name === "rule")
    .map((node) => {
      const contents = dedentEntry(lore.text.lines, node);
      const blocks = node.children.flatMap((child, n) => (child.name === "source" ? [{ child, lines: contents.children[n]!.lines }] : []));
      const read = blocks.length === 1 ? readBlock(blocks[0]!.lines, blocks[0]!.child.openLine + 1, blocks[0]!.child.closeLine) : null;
      const valid = read !== null && read.diagnostic === null && checkSource(read.value, blocks[0]!.child.openLine) === null;
      const id = readAttributes(node.attributes.text).attributes.find((attribute) => attribute.name === "id")?.value ?? null;
      return { id, sources: valid ? writtenSources(read.value) : [], hasSource: blocks.length > 0 };
    });
  return { path, rules, stop: lore.diagnostics[0] };
}

// The value already passed checkSource.
function writtenSources(value: unknown): Partial<Cited>[] {
  return (Array.isArray(value) ? value : [value]) as Partial<Cited>[];
}

function sameWritten(cited: Partial<Cited>, source: Cited | null): boolean {
  if (source === null || cited.file === undefined) return false;
  const last = (path: string) => path.replace(/^[a-z]+:/, "").split("/").at(-1);
  return last(cited.file) === last(source.file) && (cited.heading ?? null) === source.heading && (cited.phrase ?? null) === source.phrase;
}

function sameCited(record: ReviewRecord, source: Cited | null): boolean {
  return source !== null && record.file === source.file && record.heading === source.heading && record.phrase === source.phrase;
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
  let oldTarget: string | null = null;
  for (const [i, text] of ex.diff!.split("\n").entries()) {
    const bad = (why: string) => report("diff-syntax", `diff line ${i + 1} ${why}: "${text}"`);
    const file = FILE_LINE.exec(text);
    const rename = RENAME_LINE.exec(text);
    const plus = PLUS_LINE.exec(text);
    const minus = MINUS_LINE.exec(text);
    if (file?.[1] === "D" && ex.files.some((f) => f.path === file[2])) report("diff-agrees", `diff line ${i + 1} deletes "${file[2]}", which is an input file`);
    if (file) {
      target = file[1] === "D" ? null : file[2]!;
      oldTarget = file[1] === "A" ? null : file[2]!;
    } else if (rename) {
      target = rename[2]!;
      oldTarget = rename[1]!;
    } else if (minus) {
      if (oldTarget === null) bad("is a - line without an M, D or R file line before it");
    } else if (!plus) bad("is malformed");
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
