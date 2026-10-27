import { Parser, isScalar, parseDocument, visit, type Document, type DocumentOptions, type ParseOptions, type SchemaOptions } from "yaml";

export interface BlockProblem {
  name: string;
  line: number;
}

export interface ReadBlock {
  value: unknown;
  diagnostic: BlockProblem | null;
  document: Document | null;
}

interface SourceToken {
  type: string;
  offset: number;
  source: string;
}

const OPTIONS: ParseOptions & DocumentOptions & SchemaOptions = {
  version: "1.2",
  schema: "core",
  merge: false,
  uniqueKeys: true,
  strict: true,
  prettyErrors: false,
  keepSourceTokens: true,
};

const BLANK_OR_COMMENT = /^[ \t]*(#[^\n]*)?$/;
const NOT_INVALID = new Set(["DUPLICATE_KEY", "TAG_RESOLVE_FAILED"]);
const FEATURE_TOKENS = new Set(["anchor", "alias", "tag", "directive"]);

// lines: the block's contents after indentation removal; firstLine: the file line of lines[0];
// incompleteLine: where a document that ends before it is complete is reported.
export function readBlock(lines: string[], firstLine: number, incompleteLine: number): ReadBlock {
  const source = lines.join("\n");
  const lineAt = (offset: number) => firstLine + countLineFeeds(source, offset);
  const fail = (name: string, line: number): ReadBlock => ({ value: undefined, diagnostic: { name, line }, document: null });
  const doc = parseDocument(source, OPTIONS);
  const tokens = sourceTokens(source);

  const anchors = tokens.filter((t) => t.type === "anchor");
  const aliases = tokens.filter((t) => t.type === "alias");
  const undefinedAliases = aliases
    .filter((alias) => !anchors.some((a) => a.offset < alias.offset && a.source.slice(1) === alias.source.slice(1)))
    .map((alias) => alias.offset);
  const invalid = earliest([
    ...invalidOffsets(doc.errors),
    ...undefinedAliases,
  ]);
  if (invalid !== null) {
    return fail("invalid-yaml", invalid >= contentEnd(lines) ? incompleteLine : lineAt(invalid));
  }

  const duplicate = earliest(doc.errors.filter((e) => e.code === "DUPLICATE_KEY").map((e) => e.pos[0]));
  const feature = earliest([
    ...tokens.filter((t) => FEATURE_TOKENS.has(t.type)).map((t) => t.offset),
    ...unrepresentable(doc),
  ]);
  if (duplicate !== null && (feature === null || duplicate < feature)) return fail("duplicate-key", lineAt(duplicate));
  if (feature !== null) return fail("yaml-feature-not-allowed", lineAt(feature));

  return { value: doc.contents === null ? {} : doc.toJS(), diagnostic: null, document: doc };
}

// A multi-line implicit key breaks at its end, where yaml's paired BLOCK_AS_IMPLICIT_KEY reports its start.
// An unresolved tag is a tag, which the feature check reports.
function invalidOffsets(errors: { code: string; pos: [number, number] }[]): number[] {
  const multiline = errors.filter((e) => e.code === "MULTILINE_IMPLICIT_KEY");
  return errors
    .filter((e) => !NOT_INVALID.has(e.code))
    .filter((e) => e.code !== "BLOCK_AS_IMPLICIT_KEY" || !multiline.some((m) => m.pos[0] === e.pos[0]))
    .map((e) => (e.code === "MULTILINE_IMPLICIT_KEY" ? e.pos[1] : e.pos[0]));
}

// Offsets of keys that are not strings and of numbers JSON cannot hold.
function unrepresentable(doc: ReturnType<typeof parseDocument>): number[] {
  const offsets: number[] = [];
  visit(doc, {
    Pair(_, pair) {
      const key = pair.key;
      if (isScalar(key) && typeof key.value === "string") return;
      const node = key ?? pair.value;
      offsets.push(hasRange(node) ? node.range[0] : 0);
    },
    Scalar(_, scalar) {
      if (typeof scalar.value === "number" && !Number.isFinite(scalar.value) && scalar.range) {
        offsets.push(scalar.range[0]);
      }
    },
  });
  return offsets;
}

function hasRange(node: unknown): node is { range: [number, number, number] } {
  return typeof node === "object" && node !== null && Array.isArray((node as { range?: unknown }).range);
}

function sourceTokens(source: string): SourceToken[] {
  const found: SourceToken[] = [];
  const walk = (token: unknown): void => {
    if (Array.isArray(token)) {
      for (const item of token) walk(item);
      return;
    }
    if (typeof token !== "object" || token === null) return;
    const record = token as Record<string, unknown>;
    if (typeof record.type === "string" && typeof record.offset === "number" && typeof record.source === "string") {
      found.push({ type: record.type, offset: record.offset, source: record.source.trimEnd() });
    }
    for (const value of Object.values(record)) if (typeof value === "object") walk(value);
  };
  walk([...new Parser().parse(source)]);
  return found;
}

// Trailing comment lines are not content: a document cut short before them is still incomplete.
function contentEnd(lines: string[]): number {
  let last = lines.length - 1;
  while (last >= 0 && BLANK_OR_COMMENT.test(lines[last]!)) last--;
  return lines.slice(0, last + 1).join("\n").trimEnd().length;
}

function earliest(offsets: number[]): number | null {
  return offsets.length === 0 ? null : Math.min(...offsets);
}

function countLineFeeds(source: string, offset: number): number {
  let count = 0;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) if (source.charCodeAt(i) === 10) count++;
  return count;
}
