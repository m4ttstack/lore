import { CATEGORY, SEVERITIES, checkMeta, checkScope, checkWhen } from "./blocks";
import { resolveGlob } from "./glob";
import { dedentEntry } from "./indent";
import { validateDialect } from "./regex";
import { readAttributes, type AttributeList, type ChildNode, type EntryNode, type LoreFile } from "./scan";
import type { Check, Diagnostic, Entry, Range, Scope } from "./types";
import { readBlock, type BlockProblem } from "./yaml";

export type Severity = "blocking" | "advisory";

export interface FileContext {
  base: string;
  prefix: string;
  loreRoot: string;
  categories: ReadonlySet<string>;
  defaults: { category?: string; severity?: Severity };
  scope: Scope;
}

export type EntryResult =
  | { id: string | null; error: Diagnostic }
  | { id: string; entry: Entry; ownScope: WrittenScope | null; diagnostic(name: string, line?: number): Diagnostic };

export interface WrittenScope { files: readonly string[]; line: number }

type ValueRule = (value: string | null) => string | null;

export const ID = /^[a-z][a-z0-9-]*$/;
const SINGLE_CHILDREN = new Set(["meta", "scope", "when"]);
const RULE_CHILDREN = new Set([...SINGLE_CHILDREN, "check"]);
const DEFAULT_LANG = "regex";
export const DEFAULT_FILES: readonly string[] = ["**"];

export function readEntry(lore: LoreFile, node: EntryNode, file: FileContext): EntryResult {
  const list = readAttributes(node.attributes.text);
  const firstId = list.attributes.find((a) => a.name === "id");
  const id = firstId?.value != null && ID.test(firstId.value) ? firstId.value : null;
  const fail = (name: string, line = node.openLine): EntryResult => ({ id, error: lineDiagnostic(name, lore, id, line) });
  const isRule = node.name === "rule";

  const resolved = { src: null as string | null };
  const tagProblem = attributeProblem(list, isRule ? ruleAttributes(file) : contextAttributes(lore.path, file, resolved));
  if (tagProblem !== null) return fail(tagProblem);
  if (firstId === undefined) return fail("missing-id");
  // The first id passed idRule, so it is readable.
  const readableId = firstId.value!;

  const contents = dedentEntry(lore.text.lines, node);
  if (contents.inconsistent) return fail("inconsistent-indentation");

  const values = new Map<string, unknown>();
  const checks: Check[] = [];
  for (const [n, child] of node.children.entries()) {
    const read = readChild(child, contents.children[n]!, isRule ? RULE_CHILDREN : SINGLE_CHILDREN, values);
    if ("problem" in read) return fail(read.problem.name, read.problem.line);
    if (read.check !== null) checks.push(read.check);
  }

  const value = (name: string) => list.attributes.find((a) => a.name === name)?.value ?? undefined;
  const scope = values.get("scope") as { files?: string[]; ignores?: string[] } | undefined;
  const prose = dropTrailingBlank(contents.prose);
  const entry: Entry = {
    kind: node.name, id: readableId, file: lore.path,
    category: isRule ? value("category") ?? file.defaults.category ?? null : null,
    severity: isRule ? (value("severity") as Severity | undefined) ?? file.defaults.severity ?? "advisory" : null,
    disabled: list.attributes.some((a) => a.name === "disabled"),
    scopes: scope === undefined ? [file.scope] : [file.scope, resolveScope(file.base, scope)],
    when: (values.get("when") as Entry["when"] | undefined) ?? null,
    checks,
    meta: (values.get("meta") as Entry["meta"] | undefined) ?? null,
    summary: summaryOf(prose), prose: prose.join("\n"),
    src: resolved.src,
  };
  const scopeLine = node.children.find((child) => child.name === "scope")?.openLine;
  return {
    id: readableId, entry,
    ownScope: scope === undefined ? null : { files: scope.files ?? DEFAULT_FILES, line: scopeLine! },
    diagnostic: (name, line = node.openLine) => lineDiagnostic(name, lore, readableId, line),
  };
}

export function resolveScope(base: string, value: { files?: string[]; ignores?: string[] }): Scope {
  return {
    files: (value.files ?? DEFAULT_FILES).map((glob) => resolveGlob(base, glob)),
    ignores: (value.ignores ?? []).map((glob) => resolveGlob(base, glob)),
  };
}

export function lineDiagnostic(name: string, lore: LoreFile, entry: string | null, line: number): Diagnostic {
  return { name, file: lore.path, entry, line, range: lineRange(lore.text.lines, line) };
}

export function lineRange(lines: readonly string[], line: number): Range {
  const content = lines[line - 1] ?? "";
  const start = /^[ \t]*/.exec(content)![0].length;
  const end = content.replace(/[ \t]+$/, "").length;
  return { start: { line: line - 1, character: start }, end: { line: line - 1, character: Math.max(start, end) } };
}

function fromBase(base: string, glob: string): string {
  return base === "" ? glob : `${base}/${glob}`;
}

function ruleAttributes(file: FileContext): ReadonlyMap<string, ValueRule> {
  return new Map<string, ValueRule>([
    ["id", idRule],
    ["category", (value) =>
      value === null || !CATEGORY.test(value) ? "invalid-attribute-value"
      : file.categories.has(value) ? null : "unknown-category"],
    ["severity", (value) => (value !== null && SEVERITIES.includes(value) ? null : "invalid-attribute-value")],
    ["disabled", disabledRule],
  ]);
}

function contextAttributes(lorePath: string, file: FileContext, resolved: { src: string | null }): ReadonlyMap<string, ValueRule> {
  return new Map<string, ValueRule>([
    ["id", idRule],
    ["src", (value) => {
      const src = resolveSrc(value, lorePath, file);
      if ("problem" in src) return src.problem;
      resolved.src = src.path;
      return null;
    }],
    ["disabled", disabledRule],
  ]);
}

const CHECK_ATTRIBUTES: ReadonlyMap<string, ValueRule> = new Map<string, ValueRule>([
  ["lang", (value) => (value === null || value === "" ? "invalid-attribute-value" : null)],
]);
const NO_ATTRIBUTES: ReadonlyMap<string, ValueRule> = new Map();

function idRule(value: string | null): string | null {
  if (value === null) return "invalid-attribute-value";
  return ID.test(value) ? null : "invalid-id";
}

function disabledRule(value: string | null): string | null {
  return value === null ? null : "disabled-has-value";
}

// Only completed attributes precede a malformation; an attribute whose value is malformed is the malformation.
function attributeProblem(list: AttributeList, rules: ReadonlyMap<string, ValueRule>): string | null {
  const seen = new Set<string>();
  for (const attribute of list.attributes) {
    if (seen.has(attribute.name)) return "duplicate-attribute";
    seen.add(attribute.name);
    const rule = rules.get(attribute.name);
    if (rule === undefined) return "unknown-attribute";
    const problem = rule(attribute.value);
    if (problem !== null) return problem;
  }
  return list.malformedAt === null ? null : "invalid-attribute-value";
}

function readChild(
  child: ChildNode,
  contents: { lines: string[]; inconsistent: boolean },
  allowed: ReadonlySet<string>,
  values: Map<string, unknown>,
): { problem: BlockProblem } | { check: Check | null } {
  const at = (name: string) => ({ problem: { name, line: child.openLine } });
  if (!allowed.has(child.name)) return at("unknown-child");
  if (values.has(child.name)) return at("duplicate-child");
  const list = readAttributes(child.attributes.text);
  const attributes = attributeProblem(list, child.name === "check" ? CHECK_ATTRIBUTES : NO_ATTRIBUTES);
  if (attributes !== null) return at(attributes);
  if (contents.inconsistent) return at("inconsistent-indentation");

  if (child.name === "check") {
    const lang = list.attributes.find((a) => a.name === "lang")?.value ?? DEFAULT_LANG;
    const body = contents.lines.join("\n");
    if (lang === DEFAULT_LANG) {
      const problem = contents.lines.length > 1 ? "regex-not-one-line" : validateDialect(body);
      if (problem !== null) return at(problem);
    }
    return { check: { lang, body } };
  }

  const read = readBlock(contents.lines, child.openLine + 1, child.closeLine);
  if (read.diagnostic !== null) return { problem: read.diagnostic };
  const check = child.name === "meta" ? checkMeta : child.name === "scope" ? checkScope : checkWhen;
  const problem = check(read.value, child.openLine);
  if (problem !== null) return { problem };
  values.set(child.name, read.value);
  return { check: null };
}

function resolveSrc(value: string | null, lorePath: string, file: FileContext): { path: string } | { problem: string } {
  const invalid = { problem: "invalid-attribute-value" };
  if (value === null) return invalid;
  const segments = value.split("/");
  let dots = 0;
  while (dots < segments.length && (segments[dots] === "." || segments[dots] === "..")) dots++;
  const named = segments.slice(dots);
  if (named.length === 0 || segments.includes("") || named.includes(".") || named.includes("..")) return invalid;
  if (dots === 0) return { path: fromBase(file.base, value) };

  const directory = lorePath.slice(file.prefix.length).split("/").slice(0, -1);
  const rootDepth = file.loreRoot === "" ? 0 : file.loreRoot.split("/").length;
  for (const segment of segments.slice(0, dots)) {
    if (segment === ".") continue;
    if (directory.length <= rootDepth) return { problem: "src-escapes-root" };
    directory.pop();
  }
  return { path: file.prefix + [...directory, ...named].join("/") };
}

function dropTrailingBlank(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  return lines.slice(0, end);
}

function summaryOf(prose: string[]): string {
  const blank = prose.indexOf("");
  const paragraph = blank === -1 ? prose : prose.slice(0, blank);
  return paragraph.map((line) => line.replace(/^[ \t]+|[ \t]+$/g, "")).join(" ");
}
