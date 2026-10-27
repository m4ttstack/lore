import type { EntryNode } from "./scan";

export interface Dedented {
  lines: string[];
  error: "inconsistent-indentation" | null;
}

export interface DedentedEntry {
  inconsistent: boolean;
  children: { lines: string[]; inconsistent: boolean }[];
  prose: string[];
}

const BLANK = /^[ \t]*$/;
const LEADING = /^[ \t]*/;

export function dedent(lines: string[]): Dedented {
  let common: string | null = null;
  for (const line of lines) {
    if (BLANK.test(line)) continue;
    const leading = LEADING.exec(line)![0];
    common = common === null ? leading : sharedPrefix(common, leading);
  }
  const indent = common ?? "";
  const result = lines.map((line) => (BLANK.test(line) ? "" : line.slice(indent.length)));
  const indented = common !== null && lines.every((line) => BLANK.test(line) || LEADING.exec(line)![0] !== "");
  return { lines: result, error: indented && indent === "" ? "inconsistent-indentation" : null };
}

// lines: the whole file's lines; the entry's contents are the lines strictly between its tags.
export function dedentEntry(lines: string[], entry: EntryNode): DedentedEntry {
  const first = entry.openLine;
  const contents = dedent(lines.slice(first, entry.closeLine - 1));
  const children = entry.children.map((child) => {
    const own = dedent(contents.lines.slice(child.openLine - first, child.closeLine - first - 1));
    return { lines: own.lines, inconsistent: own.error !== null };
  });
  const prose = entry.proseLine === null ? [] : contents.lines.slice(entry.proseLine - first - 1);
  return { inconsistent: contents.error !== null, children, prose };
}

function sharedPrefix(a: string, b: string): string {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return a.slice(0, n);
}
