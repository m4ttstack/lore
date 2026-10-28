import type { AddedLine, Change, ChangedFile } from "@lore/parser";
import { InputError } from "./errors";

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
const NULL_DEVICE = "/dev/null";
const EMITTED_PAIRS: [string, string][] = [
  ["a/", "b/"], ["1/", "2/"], ["c/", "i/"], ["i/", "w/"], ["c/", "w/"], ["c/", "c/"], ["o/", "o/"],
];
const PREFIX_PAIRS: [string, string][] = [...EMITTED_PAIRS, ...EMITTED_PAIRS.map(([x, y]): [string, string] => [y, x])];

type Prefixes = [string, string] | null;

interface Draft {
  git: boolean;
  headerPath: string | null;
  prefixes: Prefixes;
  renameFrom: string | null;
  renameTo: string | null;
  copyTo: string | null;
  newFile: boolean;
  deleted: boolean;
  minus: string | null;
  plus: string | null;
  sawMinus: boolean;
  added: AddedLine[];
}

function draft(git: boolean, headerPath: string | null, prefixes: Prefixes = null): Draft {
  return {
    git, headerPath, prefixes, renameFrom: null, renameTo: null, copyTo: null, newFile: false, deleted: false,
    minus: null, plus: null, sawMinus: false, added: [],
  };
}

function unquote(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const chars = Array.from(raw.slice(1, -1));
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch !== "\\") {
      bytes.push(...encoder.encode(ch));
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(chars.slice(i + 1, i + 4).join(""));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += octal[0].length;
    } else {
      const next = chars[++i] ?? "\\";
      bytes.push(...(next in ESCAPES ? [ESCAPES[next]!] : encoder.encode(next)));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function strip(path: string | null, prefix: string | undefined): string | null {
  return path !== null && prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function prefixPair(left: string, right: string): Prefixes {
  return PREFIX_PAIRS.find(([x, y]) => left.startsWith(x) && right.startsWith(y)) ?? null;
}

function markerPath(rest: string): string | null {
  const path = unquote(rest.split("\t")[0]!);
  return path === NULL_DEVICE ? null : path;
}

function closingQuote(text: string): number {
  for (let i = 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i;
  }
  return -1;
}

function splitHeader(rest: string): { right: string; prefixes: Prefixes } | null {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest);
    if (end === -1 || rest[end + 1] !== " ") return null;
    const left = unquote(rest.slice(0, end + 1));
    const right = unquote(rest.slice(end + 2));
    return { right, prefixes: prefixPair(left, right) };
  }
  const quoted = rest.indexOf(' "');
  if (quoted !== -1 && rest.endsWith('"')) {
    const left = rest.slice(0, quoted);
    const right = unquote(rest.slice(quoted + 1));
    return { right, prefixes: prefixPair(left, right) };
  }
  const mid = (rest.length - 1) / 2;
  if (Number.isInteger(mid) && rest[mid] === " ") {
    const left = rest.slice(0, mid);
    const right = rest.slice(mid + 1);
    const prefixes = prefixPair(left, right);
    if (left === right || (prefixes && left.slice(prefixes[0].length) === right.slice(prefixes[1].length))) {
      return { right, prefixes };
    }
  }
  for (let at = rest.indexOf(" "); at !== -1; at = rest.indexOf(" ", at + 1)) {
    const left = rest.slice(0, at);
    const right = rest.slice(at + 1);
    const prefixes = prefixPair(left, right);
    if (left === right || prefixes) return { right, prefixes };
  }
  return null;
}

function binaryPaths(rest: string): [string | null, string | null] {
  const tail = (path: string) => path.slice(path.indexOf("/") + 1);
  const splits: [string, string][] = [];
  for (let at = rest.indexOf(" and "); at !== -1; at = rest.indexOf(" and ", at + 1)) {
    splits.push([rest.slice(0, at), rest.slice(at + 5)]);
  }
  const [left, right] = splits.find(([x, y]) => x === NULL_DEVICE || y === NULL_DEVICE || tail(x) === tail(y)) ?? splits[0] ?? [];
  if (left === undefined || right === undefined) throw new InputError(`malformed binary line: ${rest}`);
  return [left === NULL_DEVICE ? null : left, right === NULL_DEVICE ? null : right];
}

function plainPrefixes(d: Draft): Prefixes {
  const fits = (d.minus === null || d.minus.startsWith("a/")) && (d.plus === null || d.plus.startsWith("b/"));
  return fits ? ["a/", "b/"] : null;
}

function finish(d: Draft): ChangedFile {
  const prefixes = d.git ? d.prefixes : plainPrefixes(d);
  const minus = strip(d.minus, prefixes?.[0]);
  const plus = strip(d.plus, prefixes?.[1]);
  const path = d.renameTo ?? d.copyTo ?? plus ?? minus ?? strip(d.headerPath, prefixes?.[1]);
  if (path === null) throw new InputError("a diff entry has no file path");
  if (d.renameFrom !== null && d.renameTo !== null) {
    return { kind: "R", oldPath: d.renameFrom, path, added: d.added };
  }
  if (d.copyTo !== null) return { kind: "A", path, added: d.added };
  const deleted = d.deleted || (d.sawMinus && d.plus === null && d.minus !== null);
  const added = d.newFile || (d.sawMinus && d.minus === null && d.plus !== null);
  if (deleted) return { kind: "D", path, added: [] };
  return { kind: added ? "A" : "M", path, added: d.added };
}

export function parseUnifiedDiff(text: string): Change {
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const files: ChangedFile[] = [];
  let current: Draft | null = null;
  let recognized = false;
  let oldLeft = 0;
  let newLeft = 0;
  let newLine = 0;

  const flush = () => {
    if (current) files.push(finish(current));
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if ((oldLeft > 0 || newLeft > 0) && current) {
      if (line.startsWith("\\")) continue;
      const tag = line[0];
      if (tag === "+") {
        current.added.push({ line: newLine, text: line.slice(1) });
        newLine++;
        newLeft--;
        continue;
      }
      if (tag === "-") {
        oldLeft--;
        continue;
      }
      if (tag === " " || line === "") {
        oldLeft--;
        newLeft--;
        newLine++;
        continue;
      }
      oldLeft = 0;
      newLeft = 0;
    }

    if (line.startsWith("diff --git ")) {
      flush();
      const header = splitHeader(line.slice("diff --git ".length));
      current = draft(true, header?.right ?? null, header?.prefixes ?? null);
    } else if (line.startsWith("--- ") && (current?.git && !current.sawMinus ? true : lines[i + 1]?.startsWith("+++ "))) {
      if (!current || !current.git || current.sawMinus) {
        flush();
        current = draft(false, null);
      }
      current.sawMinus = true;
      current.minus = markerPath(line.slice(4));
    } else if (line.startsWith("+++ ") && current?.sawMinus) {
      current.plus = markerPath(line.slice(4));
    } else if (line.startsWith("@@") && current) {
      const hunk = HUNK.exec(line);
      if (!hunk) throw new InputError(`malformed hunk header: ${line}`);
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLine = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    } else if (!current?.git && line.startsWith("Binary files ") && line.endsWith(" differ")) {
      flush();
      current = draft(false, null);
      current.sawMinus = true;
      [current.minus, current.plus] = binaryPaths(line.slice("Binary files ".length, -" differ".length));
    } else if (!current?.git && line.startsWith("Only in ")) {
      recognized = true;
    } else if (current?.git) {
      if (line.startsWith("new file mode")) current.newFile = true;
      else if (line.startsWith("deleted file mode")) current.deleted = true;
      else if (line.startsWith("rename from ")) current.renameFrom = unquote(line.slice(12));
      else if (line.startsWith("rename to ")) current.renameTo = unquote(line.slice(10));
      else if (line.startsWith("copy to ")) current.copyTo = unquote(line.slice(8));
    }
  }
  flush();

  if (files.length === 0 && !recognized && text.trim() !== "") throw new InputError("input is not a unified diff");
  return { files };
}
