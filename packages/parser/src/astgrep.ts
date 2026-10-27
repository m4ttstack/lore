import { spawn } from "node:child_process";
import { devNull } from "node:os";

export interface LineSpan { first: number; last: number }

const LANGUAGES: Readonly<Record<string, readonly string[]>> = {
  bash: ["bash", "bats", "cgi", "command", "env", "fcgi", "ksh", "sh", "tmux", "tool", "zsh"],
  c: ["c", "h"],
  cpp: ["cc", "hpp", "cpp", "c++", "hh", "cxx", "cu", "ino"],
  csharp: ["cs"],
  css: ["css", "scss"],
  dart: ["dart"],
  elixir: ["ex", "exs"],
  go: ["go"],
  haskell: ["hs"],
  hcl: ["hcl", "nomad", "tf", "tfvars", "workflow"],
  html: ["html", "htm", "xhtml"],
  java: ["java"],
  javascript: ["cjs", "js", "mjs", "jsx"],
  json: ["json"],
  kotlin: ["kt", "ktm", "kts"],
  lua: ["lua"],
  markdown: ["markdown", "md"],
  nix: ["nix"],
  php: ["php"],
  python: ["py", "py3", "pyi", "bzl", "bazel"],
  ruby: ["rb", "rbw", "gemspec"],
  rust: ["rs"],
  scala: ["scala", "sc", "sbt"],
  solidity: ["sol"],
  swift: ["swift"],
  tsx: ["tsx"],
  typescript: ["ts", "cts", "mts"],
  yaml: ["yaml", "yml"],
  zig: ["zig"],
};
const LANGUAGE_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(LANGUAGES).flatMap(([language, extensions]) => extensions.map((extension) => [extension, language] as const)),
);

// A file that times out yields no hits, which looks the same as a file with no matches.
const TIMEOUT_MS = 10_000;
// The spec follows this release's matches, so any other version counts as no binary.
const PINNED_VERSION = "ast-grep 0.51.0";
const NO_MATCH_EXIT = 1;

interface Run { code: number | null; stdout: string }

// The extension is the part of the name after its last ".", unless that "." starts the name.
export function astGrepLanguage(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return LANGUAGE_OF.get(name.slice(dot + 1)) ?? null;
}

export async function astGrepAvailable(binary: string): Promise<boolean> {
  const run = await execute(binary, ["--version"], "");
  return run !== null && run.code === 0 && run.stdout.trim() === PINNED_VERSION;
}

// Lines count from 1. A spawn failure, a timeout or an exit ast-grep uses for errors finds nothing.
export async function astGrepSpans(binary: string, pattern: string, language: string, content: string): Promise<LineSpan[]> {
  // --config names an empty file, so no sgconfig.yml around the working directory changes the search.
  const args = ["run", `--pattern=${pattern}`, `--lang=${language}`, `--config=${devNull}`, "--json=compact", "--stdin"];
  const run = await execute(binary, args, content);
  if (run === null || (run.code !== 0 && run.code !== NO_MATCH_EXIT)) return [];
  return spansOf(run.stdout);
}

function spansOf(stdout: string): LineSpan[] {
  let matches: unknown;
  try {
    matches = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(matches)) return [];
  const spans: LineSpan[] = [];
  for (const match of matches) {
    const range = (match as { range?: { start?: Point; end?: Point } } | null)?.range;
    const start = range?.start;
    const end = range?.end;
    if (!isPoint(start) || !isPoint(end)) continue;
    // The end is exclusive: a match that ends at a column 0 has its last character on the line before.
    const last = end.column === 0 && end.line > start.line ? end.line - 1 : end.line;
    spans.push({ first: start.line + 1, last: last + 1 });
  }
  return spans;
}

interface Point { line: number; column: number }

function isPoint(value: unknown): value is Point {
  const point = value as Partial<Point> | undefined;
  return typeof point?.line === "number" && typeof point.column === "number";
}

function execute(binary: string, args: readonly string[], input: string): Promise<Run | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, args, { stdio: ["pipe", "pipe", "ignore"], timeout: TIMEOUT_MS, windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => resolve(null));
    child.on("close", (code, signal) => resolve(signal === null ? { code, stdout: Buffer.concat(chunks).toString("utf8") } : null));
    child.stdin!.on("error", () => {});
    child.stdin!.end(input);
  });
}
