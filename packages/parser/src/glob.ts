export type GlobPlace = "files" | "ignores" | "changed" | "unchanged";

// null stands for a `**` segment.
type Segment = RegExp | null;

const CACHE_LIMIT = 4096;
const compiled = new Map<string, Segment[] | null>();

export function validateGlob(glob: string, where: GlobPlace): string | null {
  const rooted = glob.startsWith("/");
  if (rooted && (where === "files" || where === "ignores")) return "leading-slash";
  const rest = rooted ? glob.slice(1) : glob;
  if (compile(rest) === null) return "invalid-glob";
  if (rest.split("/").includes("..")) return "glob-escapes-base";
  return null;
}

export function matchGlob(glob: string, path: string): boolean {
  const segments = compile(glob);
  return segments !== null && matchSegments(segments, path.split("/"));
}

export function resolveGlob(base: string, glob: string): string {
  if (glob.startsWith("/")) return glob.slice(1);
  return base === "" ? glob : `${base}/${glob}`;
}

export function disjoint(a: string, b: string): boolean {
  return headsConflict(head(a), head(b)) || tailsConflict(tail(a), tail(b));
}

function head(glob: string): string[] {
  const segments = glob.split("/");
  const wild = segments.findIndex((segment) => /[*?[{]/.test(segment));
  return wild === -1 ? segments : segments.slice(0, wild);
}

function headsConflict(a: string[], b: string[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return true;
  return false;
}

function tail(glob: string): string | null {
  const last = glob.split("/").at(-1)!;
  if (last === "**") return null;
  return last.slice(Math.max(...["*", "?", "]", "}"].map((c) => last.lastIndexOf(c))) + 1);
}

function tailsConflict(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && !a.endsWith(b) && !b.endsWith(a);
}

function compile(glob: string): Segment[] | null {
  const cached = compiled.get(glob);
  if (cached !== undefined) return cached;
  // Bounded because an editor re-parses on every edit, and each edit can bring new globs.
  if (compiled.size >= CACHE_LIMIT) compiled.clear();
  const segments = compileGlob(glob);
  compiled.set(glob, segments);
  return segments;
}

function compileGlob(glob: string): Segment[] | null {
  if (glob === "" || glob.startsWith("!") || glob.includes("\\")) return null;
  const segments: Segment[] = [];
  for (const text of glob.split("/")) {
    if (text === "**") {
      segments.push(null);
      continue;
    }
    if (text === "" || text === ".") return null;
    const source = segmentSource([...text]);
    if (source === null) return null;
    segments.push(new RegExp(`^${source}$`, "u"));
  }
  return segments;
}

function segmentSource(chars: string[]): string | null {
  let source = "";
  let inAlternatives = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c === "[") {
      const set = readSet(chars, i);
      if (set === null) return null;
      source += set.source;
      i = set.close;
    } else if (c === "*") {
      if (chars[i + 1] === "*") return null;
      source += "[^]*";
    } else if (c === "?") {
      source += "[^]";
    } else if (c === "{") {
      if (inAlternatives) return null;
      inAlternatives = true;
      source += "(?:";
    } else if (c === "}" && inAlternatives) {
      inAlternatives = false;
      source += ")";
    } else if (c === "," && inAlternatives) {
      source += "|";
    } else {
      source += literal(c);
    }
  }
  return inAlternatives ? null : source;
}

function readSet(chars: string[], open: number): { source: string; close: number } | null {
  const negated = chars[open + 1] === "!";
  const first = open + (negated ? 2 : 1);
  if (chars[first] === "^" && !negated) return null;
  const close = chars.indexOf("]", first + 1);
  if (close === -1) return null;
  const members = chars.slice(first, close);
  let source = "";
  for (let j = 0; j < members.length; j++) {
    const c = members[j]!;
    if (j + 2 < members.length && members[j + 1] === "-") {
      const end = members[j + 2]!;
      if (end.codePointAt(0)! < c.codePointAt(0)!) return null;
      source += `${literal(c)}-${literal(end)}`;
      j += 2;
    } else if (c === "-" && j !== 0 && j !== members.length - 1) {
      return null;
    } else {
      source += literal(c);
    }
  }
  return { source: `[${negated ? "^" : ""}${source}]`, close };
}

function literal(c: string): string {
  return `\\u{${c.codePointAt(0)!.toString(16)}}`;
}

function matchSegments(segments: Segment[], parts: string[]): boolean {
  let g = 0;
  let p = 0;
  let star = -1;
  let starPart = 0;
  while (p < parts.length) {
    const segment = segments[g];
    if (segment === null) {
      star = g++;
      starPart = p;
    } else if (segment !== undefined && segment.test(parts[p]!)) {
      g++;
      p++;
    } else if (star === -1) {
      return false;
    } else {
      g = star + 1;
      p = ++starPart;
    }
  }
  while (segments[g] === null) g++;
  return g === segments.length;
}
