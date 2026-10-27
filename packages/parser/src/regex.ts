const OUTSIDE = "regex-outside-dialect";
const NOT_ONE_LINE = "regex-not-one-line";
const MAX_BOUND = 1000;
export const MAX_GROUP_NESTING = 1000;

const CONTROL_ESCAPES: Readonly<Record<string, number>> = { t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d };
const ASCII_SPACE_MEMBERS = "\\x09-\\x0D\\x20";
const NOT_ASCII_SPACE_MEMBERS = "\\x00-\\x08\\x0E-\\x1F\\x21-\\u{10FFFF}";
type ClassLetter = "d" | "D" | "w" | "W" | "s" | "S";
const CLASS_IN_SET: Readonly<Record<ClassLetter, string>> = {
  d: "\\d", D: "\\D", w: "\\w", W: "\\W", s: ASCII_SPACE_MEMBERS, S: NOT_ASCII_SPACE_MEMBERS,
};
const CLASS_OUTSIDE_SET: Readonly<Record<ClassLetter, string>> = {
  ...CLASS_IN_SET, s: `[${ASCII_SPACE_MEMBERS}]`, S: `[^${ASCII_SPACE_MEMBERS}]`,
};

type Scan = { error: string } | { source: string; depth: number };

export class RegexLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegexLimitError";
  }
}

type SetMember = { kind: "char"; cp: number; dash: boolean } | { kind: "class"; source: string };

export function validateRegex(pattern: string): string | null {
  if (/[\n\r]/.test(pattern)) return NOT_ONE_LINE;
  return validateDialect(pattern);
}

export function validateDialect(pattern: string): string | null {
  const scan = translate(pattern);
  return "error" in scan ? scan.error : null;
}

export function toRegExp(pattern: string): RegExp {
  const scan = translate(pattern);
  if ("error" in scan) throw new Error(`${scan.error}: ${shown(pattern)}`);
  if (scan.depth > MAX_GROUP_NESTING) {
    throw new RegexLimitError(`groups nested ${scan.depth} deep, past the limit of ${MAX_GROUP_NESTING}: ${shown(pattern)}`);
  }
  try {
    const regex = new RegExp(scan.source, "us");
    // V8 compiles a regular expression on its first match, not when it is constructed.
    regex.test("");
    return regex;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError) {
      throw new RegexLimitError(`the regular expression engine cannot compile this pattern (${engineReason(error.message, scan.source)}): ${shown(pattern)}`);
    }
    throw error;
  }
}

const SHOWN_CODE_POINTS = 100;

// V8 quotes the whole translated source in its message; keep only the reason, capped.
export function engineReason(message: string, source: string): string {
  return shown(message.split(source).join("<pattern>"));
}

function shown(pattern: string): string {
  const chars = Array.from(pattern);
  return chars.length > SHOWN_CODE_POINTS ? `${chars.slice(0, SHOWN_CODE_POINTS).join("")}...` : pattern;
}

function translate(pattern: string): Scan {
  const outside = { error: OUTSIDE };
  const chars = Array.from(pattern);
  if (chars.length === 0) return outside;
  const parents: number[] = [];
  let chain = 1;
  let out = "";
  let repeatable: "no" | "atom" | "group" = "no";
  let groupChain = 1;
  let quantified = false;
  let depth = 0;

  for (let i = 0; i < chars.length; i++) {
    const c = charAt(chars, i);
    if (c === "*" || c === "+" || c === "?" || c === "{") {
      if (c === "?" && quantified) {
        out += "?";
        quantified = false;
        continue;
      }
      if (repeatable === "no") return outside;
      if (c === "{") {
        const bound = readBound(chars, i);
        if (bound === null) return outside;
        const product = (repeatable === "group" ? groupChain : 1) * Math.max(bound.bound, 1);
        if (product > MAX_BOUND) return outside;
        chain = Math.max(chain, product);
        out += chars.slice(i, bound.end).join("");
        i = bound.end - 1;
      } else {
        out += c;
      }
      repeatable = "no";
      quantified = true;
      continue;
    }
    quantified = false;
    repeatable = "atom";
    switch (c) {
      case "\\": {
        const escape = readEscape(chars, i + 1);
        if (escape === null) return outside;
        if (escape.kind === "class") out += CLASS_OUTSIDE_SET[escape.letter];
        else if (escape.kind === "assertion") {
          out += `\\${escape.letter}`;
          repeatable = "no";
        } else out += emitChar(escape.cp);
        i = escape.end - 1;
        break;
      }
      case "^":
      case "$":
      case "|":
        out += c;
        repeatable = "no";
        break;
      case ".":
        out += ".";
        break;
      case "(":
        if (chars[i + 1] === "?") {
          if (chars[i + 2] !== ":") return outside;
          i += 2;
        }
        parents.push(chain);
        depth = Math.max(depth, parents.length);
        chain = 1;
        out += "(?:";
        repeatable = "no";
        break;
      case ")": {
        const parent = parents.pop();
        if (parent === undefined) return outside;
        groupChain = chain;
        chain = Math.max(parent, groupChain);
        out += ")";
        repeatable = "group";
        break;
      }
      case "[": {
        const set = readSet(chars, i);
        if ("error" in set) return set;
        out += set.source;
        i = set.end - 1;
        break;
      }
      case "]":
      case "}":
        return outside;
      default:
        out += emitChar(c.codePointAt(0) as number);
    }
  }
  return parents.length === 0 ? { source: out, depth } : outside;
}

function readBound(chars: string[], open: number): { bound: number; end: number } | null {
  let j = open + 1;
  const n = readNumber(chars, j);
  if (n === null) return null;
  j = n.end;
  let m: number | null = null;
  if (chars[j] === ",") {
    j++;
    if (chars[j] !== "}") {
      const read = readNumber(chars, j);
      if (read === null || read.value < n.value) return null;
      m = read.value;
      j = read.end;
    }
  }
  if (chars[j] !== "}") return null;
  return { bound: m ?? n.value, end: j + 1 };
}

function readNumber(chars: string[], start: number): { value: number; end: number } | null {
  let j = start;
  while (isDigit(charAt(chars, j))) j++;
  const digits = chars.slice(start, j).join("");
  if (digits === "" || digits.length > 4 || (digits.length > 1 && digits[0] === "0")) return null;
  const value = Number(digits);
  return value > MAX_BOUND ? null : { value, end: j };
}

type Escape =
  | { kind: "char"; cp: number; end: number }
  | { kind: "class"; letter: ClassLetter; end: number }
  | { kind: "assertion"; letter: "b" | "B"; end: number };

function readEscape(chars: string[], at: number): Escape | null {
  const c = charAt(chars, at);
  if (isPunctuation(c)) return { kind: "char", cp: c.charCodeAt(0), end: at + 1 };
  const control = CONTROL_ESCAPES[c];
  if (control !== undefined) return { kind: "char", cp: control, end: at + 1 };
  if (c === "x") {
    const hex = (chars[at + 1] ?? "") + (chars[at + 2] ?? "");
    return /^[0-9a-fA-F]{2}$/.test(hex) ? { kind: "char", cp: parseInt(hex, 16), end: at + 3 } : null;
  }
  if (isClassLetter(c)) return { kind: "class", letter: c, end: at + 1 };
  if (c === "b" || c === "B") return { kind: "assertion", letter: c, end: at + 1 };
  return null;
}

function readSet(chars: string[], open: number): { source: string; end: number } | { error: string } {
  const outside = { error: OUTSIDE };
  let j = open + 1;
  const negated = chars[j] === "^";
  if (negated) j++;
  const members: SetMember[] = [];
  for (;;) {
    const c = chars[j];
    if (c === undefined || c === "[") return outside;
    if (c === "]") break;
    if (c === "\\") {
      const escape = readEscape(chars, j + 1);
      if (escape === null || escape.kind === "assertion") return outside;
      members.push(escape.kind === "class"
        ? { kind: "class", source: CLASS_IN_SET[escape.letter] }
        : { kind: "char", cp: escape.cp, dash: false });
      j = escape.end;
      continue;
    }
    members.push({ kind: "char", cp: c.codePointAt(0) as number, dash: c === "-" });
    j++;
  }
  if (members.length === 0) return outside;

  let source = negated ? "[^" : "[";
  for (let k = 0; k < members.length; k++) {
    const member = members[k] as SetMember;
    const next = members[k + 1];
    const last = members[k + 2];
    if (member.kind === "char" && next?.kind === "char" && next.dash && last !== undefined) {
      if (last.kind === "class" || last.cp < member.cp) return outside;
      source += `${emitChar(member.cp)}-${emitChar(last.cp)}`;
      k += 2;
      continue;
    }
    if (member.kind === "class") {
      source += member.source;
      continue;
    }
    if (member.dash && k !== 0 && k !== members.length - 1) return outside;
    source += emitChar(member.cp);
  }
  return { source: `${source}]`, end: j + 1 };
}

function emitChar(cp: number): string {
  if (cp < 0x80 && !/[A-Za-z0-9]/.test(String.fromCharCode(cp))) return `\\x${cp.toString(16).padStart(2, "0")}`;
  return String.fromCodePoint(cp);
}

function isClassLetter(c: string): c is ClassLetter {
  return c.length === 1 && "dDwWsS".includes(c);
}

function isPunctuation(c: string): boolean {
  return /^[!-/:-@[-`{-~]$/.test(c);
}

function charAt(chars: string[], i: number): string {
  return chars[i] ?? "";
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}
