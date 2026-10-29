import { isMap, isScalar, type Pair, type YAMLSeq } from "yaml";
import { CATEGORY, ID } from "./blocks";
import { decode, firstInvalidLine, lineRange } from "./text";
import type { Range } from "./types";
import { countLineFeeds, readBlock } from "./yaml";

export interface DisableItem { id: string; line: number; range: Range }

export interface LoreConfig {
  root: boolean;
  loose?: boolean;
  repo: { value: string; line: number } | null;
  categories: string[];
  disable: DisableItem[];
}

export type ConfigRead = { lines: string[] } & ({ config: LoreConfig } | { config: null; problem: number });

const REPO = /^[a-z0-9.-]+(:[0-9]+)?\/\S*[^\s/]$/;
const GIT_SUFFIX = ".git";

export function readLoreconfig(content: string): ConfigRead {
  const text = decode(content);
  const lines = text.lines;
  const fail = (problem: number): ConfigRead => ({ lines, config: null, problem });
  const invalid = firstInvalidLine(text);
  if (invalid !== null) return fail(invalid);
  const lastLine = content.endsWith("\n") ? lines.length - 1 : lines.length;
  const read = readBlock(lines, 1, Math.max(lastLine, 1));
  if (read.diagnostic !== null) return fail(read.diagnostic.line);
  const value = read.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(1);

  const source = lines.join("\n");
  const lineAt = (offset: number) => 1 + countLineFeeds(source, offset);
  const config: LoreConfig = { root: false, repo: null, categories: [], disable: [] };
  const contents = read.document!.contents;
  const pairs: Pair[] = isMap(contents) ? contents.items : [];
  for (const pair of pairs) {
    // readBlock rejects every key that is not a string scalar.
    const key = pair.key as { value: string; range: [number, number, number] };
    const field = (value as Record<string, unknown>)[key.value];
    const line = lineAt(key.range[0]);
    switch (key.value) {
      case "lore":
        if (field !== 1) return fail(line);
        break;
      case "root":
        if (typeof field !== "boolean") return fail(line);
        config.root = field;
        break;
      case "loose":
        if (typeof field !== "boolean") return fail(line);
        config.loose = field;
        break;
      case "repo":
        if (typeof field !== "string" || !REPO.test(field) || field.endsWith(GIT_SUFFIX)) return fail(line);
        config.repo = { value: field, line };
        break;
      case "categories":
        if (!isListOf(field, CATEGORY)) return fail(line);
        config.categories = field;
        break;
      case "disable":
        if (!isListOf(field, ID)) return fail(line);
        config.disable = itemOffsets(pair.value as YAMLSeq).map((offset, n) => {
          const itemLine = lineAt(offset);
          return { id: field[n]!, line: itemLine, range: lineRange(lines, itemLine) };
        });
        break;
      default:
        return fail(line);
    }
  }
  return { lines, config };
}

export function normalizeRemote(url: string): string {
  let rest = url;
  const scheme = rest.indexOf("://");
  if (scheme !== -1) {
    rest = rest.slice(scheme + 3);
    const slash = rest.indexOf("/");
    const at = (slash === -1 ? rest : rest.slice(0, slash)).lastIndexOf("@");
    rest = rest.slice(at + 1);
  } else {
    const colon = rest.indexOf(":");
    const slash = rest.indexOf("/");
    if (colon !== -1 && (slash === -1 || colon < slash)) {
      const at = rest.slice(0, colon).lastIndexOf("@");
      rest = `${rest.slice(at + 1, colon)}/${rest.slice(colon + 1)}`;
    }
  }
  rest = rest.replace(/\/+$/, "");
  return rest.endsWith(GIT_SUFFIX) ? rest.slice(0, -GIT_SUFFIX.length) : rest;
}

export function namesRepo(repo: string, remotes: readonly string[]): boolean {
  const wanted = asciiLower(repo);
  return remotes.some((remote) => asciiLower(normalizeRemote(remote)) === wanted);
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function isListOf(value: unknown, pattern: RegExp): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && pattern.test(item));
}

// A block sequence item starts at its dash, which the item's own range leaves out.
function itemOffsets(sequence: YAMLSeq): number[] {
  const token = sequence.srcToken;
  return sequence.items.map((item, n) => {
    if (token?.type === "block-seq") {
      const dash = token.items[n]?.start.find((t) => t.type === "seq-item-ind");
      if (dash !== undefined) return dash.offset;
    }
    return isScalar(item) && item.range ? item.range[0] : 0;
  });
}
