import type { AddedLine, Change, ChangedFile } from "@lore/parser";
import { InputError } from "./errors";

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const ESCAPES: Record<string, number> = { t: 9, n: 10, r: 13, '"': 34, "\\": 92 };

interface Draft {
  git: boolean;
  headerPath: string | null;
  renameFrom: string | null;
  renameTo: string | null;
  newFile: boolean;
  deleted: boolean;
  minus: string | null;
  plus: string | null;
  sawMinus: boolean;
  added: AddedLine[];
}

function draft(git: boolean, headerPath: string | null): Draft {
  return {
    git, headerPath, renameFrom: null, renameTo: null, newFile: false, deleted: false,
    minus: null, plus: null, sawMinus: false, added: [],
  };
}

function unquote(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;
  const bytes: number[] = [];
  const body = raw.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== "\\") {
      bytes.push(...new TextEncoder().encode(ch));
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += octal[0].length;
    } else {
      bytes.push(ESCAPES[body[i + 1]!] ?? body.charCodeAt(i + 1));
      i++;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function stripPrefix(path: string): string {
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path;
}

function markerPath(rest: string): string | null {
  const path = unquote(rest.split("\t")[0]!);
  return path === "/dev/null" ? null : stripPrefix(path);
}

function headerNewPath(rest: string): string | null {
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" ', 1);
    const right = end === -1 ? null : rest.slice(end + 2);
    return right ? stripPrefix(unquote(right)) : null;
  }
  if (rest.length % 2 === 1) {
    const mid = (rest.length - 1) / 2;
    const left = rest.slice(0, mid);
    const right = rest.slice(mid + 1);
    if (rest[mid] === " " && left.slice(2) === right.slice(2)) return stripPrefix(unquote(right));
  }
  const at = rest.indexOf(" b/");
  return at === -1 ? null : rest.slice(at + 1).replace(/^b\//, "");
}

function finish(d: Draft): ChangedFile {
  const path = d.renameTo ?? d.plus ?? d.minus ?? d.headerPath;
  if (path === null) throw new InputError("a diff entry has no file path");
  if (d.renameFrom !== null && d.renameTo !== null) {
    return { kind: "R", oldPath: d.renameFrom, path, added: d.added };
  }
  const deleted = d.deleted || (d.sawMinus && d.plus === null && d.minus !== null);
  const added = d.newFile || (d.sawMinus && d.minus === null && d.plus !== null);
  if (deleted) return { kind: "D", path, added: [] };
  return { kind: added ? "A" : "M", path, added: d.added };
}

export function parseUnifiedDiff(text: string): Change {
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const files: ChangedFile[] = [];
  let current: Draft | null = null;
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
      current = draft(true, headerNewPath(line.slice("diff --git ".length)));
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
    } else if (current?.git) {
      if (line.startsWith("new file mode")) current.newFile = true;
      else if (line.startsWith("deleted file mode")) current.deleted = true;
      else if (line.startsWith("rename from ")) current.renameFrom = unquote(line.slice(12));
      else if (line.startsWith("rename to ")) current.renameTo = unquote(line.slice(10));
    }
  }
  flush();

  if (files.length === 0 && text.trim() !== "") throw new InputError("input is not a unified diff");
  return { files };
}
