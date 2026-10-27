import { CATEGORY, SEVERITIES, checkMeta, checkRegex, checkScope, checkWhen } from "./blocks";
import { dedentEntry } from "./indent";
import { readAttributes, type AttributeList, type ChildNode, type EntryNode, type LoreFile } from "./scan";
import type { Check, Diagnostic, Entry, Scope } from "./types";
import { readBlock, type BlockProblem } from "./yaml";

export type Severity = "blocking" | "advisory";

export interface FileContext {
  base: string;
  loreRoot: string;
  categories: ReadonlySet<string>;
  defaults: { category?: string; severity?: Severity };
  scope: Scope;
}

export type EntryResult =
  | { id: string | null; error: Diagnostic }
  | { id: string; entry: Entry; diagnostic(name: string): Diagnostic };

type ValueRule = (value: string | null) => string | null;

const ID = /^[a-z][a-z0-9-]*$/;
const SINGLE_CHILDREN = new Set(["meta", "scope", "when"]);
const RULE_CHILDREN = new Set([...SINGLE_CHILDREN, "check"]);
const DEFAULT_LANG = "regex";

export function readEntry(lore: LoreFile, node: EntryNode, file: FileContext): EntryResult {
  const list = readAttributes(node.attributes.text);
  const firstId = list.attributes.find((a) => a.name === "id");
  const id = firstId?.value != null && ID.test(firstId.value) ? firstId.value : null;
  const fail = (name: string, line = node.openLine): EntryResult => ({ id, error: lineDiagnostic(name, lore, id, line) });
  const isRule = node.name === "rule";

  const tagProblem = attributeProblem(list, isRule ? ruleAttributes(file) : contextAttributes(lore.path, file));
  if (tagProblem !== null) return fail(tagProblem);
  if (firstId === undefined) return fail("missing-id");
  if (id === null) return fail("invalid-id");

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
  const srcValue = value("src");
  const src = srcValue === undefined ? null : resolveSrc(srcValue, lore.path, file);
  const prose = dropTrailingBlank(contents.prose);
  const entry: Entry = {
    kind: node.name, id, file: lore.path,
    category: isRule ? value("category") ?? file.defaults.category ?? null : null,
    severity: isRule ? (value("severity") as Severity | undefined) ?? file.defaults.severity ?? "advisory" : null,
    disabled: list.attributes.some((a) => a.name === "disabled"),
    scopes: scope === undefined ? [file.scope] : [file.scope, resolveScope(file.base, scope)],
    when: (values.get("when") as Entry["when"] | undefined) ?? null,
    checks,
    meta: (values.get("meta") as Entry["meta"] | undefined) ?? null,
    summary: summaryOf(prose), prose: prose.join("\n"),
    src: src !== null && "path" in src ? src.path : null,
  };
  return { id, entry, diagnostic: (name) => lineDiagnostic(name, lore, id, node.openLine) };
}

export function resolveScope(base: string, value: { files?: string[]; ignores?: string[] }): Scope {
  return {
    files: (value.files ?? ["**"]).map((glob) => fromBase(base, glob)),
    ignores: (value.ignores ?? []).map((glob) => fromBase(base, glob)),
  };
}

export function lineDiagnostic(name: string, lore: LoreFile, entry: string | null, line: number): Diagnostic {
  const content = lore.text.lines[line - 1] ?? "";
  const start = /^[ \t]*/.exec(content)![0].length;
  const end = content.replace(/[ \t]+$/, "").length;
  return {
    name, file: lore.path, entry, line,
    range: { start: { line: line - 1, character: start }, end: { line: line - 1, character: Math.max(start, end) } },
  };
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

function contextAttributes(lorePath: string, file: FileContext): ReadonlyMap<string, ValueRule> {
  return new Map<string, ValueRule>([
    ["id", idRule],
    ["src", (value) => {
      const resolved = resolveSrc(value, lorePath, file);
      return "problem" in resolved ? resolved.problem : null;
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

// Each attribute is met at its name, so a name read before a malformed value is checked before the malformation.
function attributeProblem(list: AttributeList, rules: ReadonlyMap<string, ValueRule>): string | null {
  const seen = new Set<string>();
  const meet = (name: string) => {
    if (seen.has(name)) return "duplicate-attribute";
    seen.add(name);
    return rules.has(name) ? null : "unknown-attribute";
  };
  for (const attribute of list.attributes) {
    const problem = meet(attribute.name) ?? rules.get(attribute.name)!(attribute.value);
    if (problem !== null) return problem;
  }
  if (list.unfinished !== null) {
    const problem = meet(list.unfinished.name);
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
      const problem = contents.lines.length > 1 ? "regex-not-one-line" : checkRegex(body);
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

  const directory = lorePath.split("/").slice(0, -1);
  const rootDepth = file.loreRoot === "" ? 0 : file.loreRoot.split("/").length;
  for (const segment of segments.slice(0, dots)) {
    if (segment === ".") continue;
    if (directory.length <= rootDepth) return { problem: "src-escapes-root" };
    directory.pop();
  }
  return { path: [...directory, ...named].join("/") };
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
