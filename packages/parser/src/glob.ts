export type GlobPlace = "files" | "ignores" | "changed" | "unchanged";

type Matcher =
  | { kind: "literal"; code: number }
  | { kind: "any" }
  | { kind: "set"; negated: boolean; ranges: [number, number][] };
type Piece = Matcher | { kind: "star" };
type Token = Piece | { kind: "alternatives"; alternatives: Piece[][] };

type State =
  | { kind: "accept" }
  | { kind: "char"; matcher: Matcher; next: number }
  | { kind: "star"; next: number }
  | { kind: "split"; next: number[] };

type Segment = { kind: "globstar" } | { kind: "name"; states: State[]; start: number };

const ACCEPT = 0;
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

export function matchFromBase(base: string, glob: string, path: string): boolean {
  if (glob.startsWith("/")) return matchGlob(glob.slice(1), path);
  if (base === "") return matchGlob(glob, path);
  return path.startsWith(`${base}/`) && matchGlob(glob, path.slice(base.length + 1));
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
      segments.push({ kind: "globstar" });
      continue;
    }
    if (text === "" || text === ".") return null;
    const tokens = readSegment([...text]);
    if (tokens === null) return null;
    segments.push(buildStates(tokens));
  }
  return segments;
}

function readSegment(chars: string[]): Token[] | null {
  const tokens: Token[] = [];
  let alternatives: Piece[][] | null = null;
  const push = (piece: Piece) => (alternatives === null ? tokens : alternatives.at(-1)!).push(piece);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c === "[") {
      const set = readSet(chars, i);
      if (set === null) return null;
      push(set.matcher);
      i = set.close;
    } else if (c === "*") {
      if (chars[i + 1] === "*") return null;
      push({ kind: "star" });
    } else if (c === "?") {
      push({ kind: "any" });
    } else if (c === "{") {
      if (alternatives !== null) return null;
      alternatives = [[]];
    } else if (c === "}" && alternatives !== null) {
      tokens.push({ kind: "alternatives", alternatives });
      alternatives = null;
    } else if (c === "," && alternatives !== null) {
      alternatives.push([]);
    } else {
      push({ kind: "literal", code: c.codePointAt(0)! });
    }
  }
  return alternatives === null ? tokens : null;
}

function readSet(chars: string[], open: number): { matcher: Matcher; close: number } | null {
  const negated = chars[open + 1] === "!";
  const first = open + (negated ? 2 : 1);
  if (chars[first] === "^" && !negated) return null;
  const close = chars.indexOf("]", first + 1);
  if (close === -1) return null;
  const members = chars.slice(first, close).map((c) => c.codePointAt(0)!);
  const dash = "-".codePointAt(0)!;
  const ranges: [number, number][] = [];
  for (let j = 0; j < members.length; j++) {
    const code = members[j]!;
    if (j + 2 < members.length && members[j + 1] === dash) {
      const end = members[j + 2]!;
      if (end < code) return null;
      ranges.push([code, end]);
      j += 2;
    } else if (code === dash && j !== 0 && j !== members.length - 1) {
      return null;
    } else {
      ranges.push([code, code]);
    }
  }
  return { matcher: { kind: "set", negated, ranges }, close };
}

function buildStates(tokens: Token[]): Segment {
  const states: State[] = [{ kind: "accept" }];
  const add = (state: State) => states.push(state) - 1;
  const piece = (p: Piece, next: number) =>
    add(p.kind === "star" ? { kind: "star", next } : { kind: "char", matcher: p, next });
  let start = ACCEPT;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token.kind === "alternatives") {
      const next = start;
      const branches = token.alternatives.map((pieces) => pieces.reduceRight((n, p) => piece(p, n), next));
      start = add({ kind: "split", next: branches });
    } else {
      start = piece(token, start);
    }
  }
  return { kind: "name", states, start };
}

// A state-set simulation, so matching stays linear in the name for any number of stars.
function matchName(segment: Extract<Segment, { kind: "name" }>, name: string): boolean {
  const { states } = segment;
  const seen = new Int32Array(states.length).fill(-1);
  let generation = 0;
  const enter = (id: number, into: number[]): void => {
    if (seen[id] === generation) return;
    seen[id] = generation;
    const state = states[id]!;
    if (state.kind === "split") {
      for (const next of state.next) enter(next, into);
      return;
    }
    into.push(id);
    if (state.kind === "star") enter(state.next, into);
  };
  let current: number[] = [];
  enter(segment.start, current);
  for (const c of name) {
    const code = c.codePointAt(0)!;
    const next: number[] = [];
    generation++;
    for (const id of current) {
      const state = states[id]!;
      if (state.kind === "star") enter(id, next);
      else if (state.kind === "char" && matches(state.matcher, code)) enter(state.next, next);
    }
    if (next.length === 0) return false;
    current = next;
  }
  return current.includes(ACCEPT);
}

function matches(matcher: Matcher, code: number): boolean {
  if (matcher.kind === "literal") return matcher.code === code;
  if (matcher.kind === "any") return true;
  return matcher.ranges.some(([from, to]) => from <= code && code <= to) !== matcher.negated;
}

function matchSegments(segments: Segment[], parts: string[]): boolean {
  let g = 0;
  let p = 0;
  let star = -1;
  let starPart = 0;
  while (p < parts.length) {
    const segment = segments[g];
    if (segment?.kind === "globstar") {
      star = g++;
      starPart = p;
    } else if (segment !== undefined && matchName(segment, parts[p]!)) {
      g++;
      p++;
    } else if (star === -1) {
      return false;
    } else {
      g = star + 1;
      p = ++starPart;
    }
  }
  while (segments[g]?.kind === "globstar") g++;
  return g === segments.length;
}
