import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { GivenFolder, InputFile, LoreInput } from "@lore/parser";

// Keys are canonical absolute paths (see canonicalPath); values are the buffer text.
export type OpenDocuments = ReadonlyMap<string, string>;

const LORE_EXTENSION = ".lore";
const CONFIG_NAME = ".loreconfig";
const LINE_FEED = 0x0a;
// The parser reads a lone surrogate as an invalid UTF-8 byte.
const INVALID_MARK = "\uD800";

const strict = new TextDecoder("utf-8", { fatal: true });
const lenient = new TextDecoder("utf-8");

function git(cwd: string, args: readonly string[]): Promise<string | null> {
  return new Promise((done) => {
    execFile("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30, windowsHide: true }, (error, stdout) =>
      done(error === null ? stdout : null));
  });
}

export async function listFiles(root: string): Promise<string[] | null> {
  const out = await git(root, ["ls-files", "-co", "--exclude-standard", "-z"]);
  if (out === null) return null;
  return [...new Set(out.split("\0").filter((path) => path !== ""))];
}

export async function repositoryRoot(dir: string): Promise<string | null> {
  const out = await git(dir, ["rev-parse", "--show-toplevel"]);
  const top = out?.trim();
  return top ? canonicalPath(top) : null;
}

// Real path of the directory, so paths agree with git's output across symlinked folders such as macOS's /tmp.
export async function canonicalPath(path: string): Promise<string> {
  const full = resolve(path);
  try {
    return await realpath(full);
  } catch {
    try {
      return join(await realpath(dirname(full)), basename(full));
    } catch {
      return full;
    }
  }
}

export function isLorePath(path: string): boolean {
  const name = basename(path);
  return name === CONFIG_NAME || name.endsWith(LORE_EXTENSION);
}

export async function buildInput(workspace: string, openDocuments: OpenDocuments, externalFolders: readonly string[]): Promise<LoreInput> {
  const root = await canonicalPath(workspace);
  const listed = await listFiles(root);
  const repo = listed === null ? openUnder(root, openDocuments) : await readFiles(root, listed, openDocuments);
  return { repo, given: await givenFolders(root, externalFolders, openDocuments), remotes: listed === null ? [] : await remotes(root) };
}

async function givenFolders(workspace: string, entries: readonly string[], openDocuments: OpenDocuments): Promise<GivenFolder[]> {
  const repositories = new Map<string, Promise<InputFile[] | null>>();
  const given: GivenFolder[] = [];
  for (const entry of entries) {
    const folder = await canonicalPath(isAbsolute(entry) ? entry : join(workspace, entry));
    const top = await repositoryRoot(folder);
    if (top === null) continue;
    let files = repositories.get(top);
    if (files === undefined) {
      files = listFiles(top).then((listed) => listed === null ? null : readFiles(top, listed, openDocuments));
      repositories.set(top, files);
    }
    const read = await files;
    if (read !== null) given.push({ folder: posix(relative(top, folder)), files: read, repository: top });
  }
  return given;
}

async function readFiles(root: string, listed: readonly string[], openDocuments: OpenDocuments): Promise<InputFile[]> {
  const seen = new Set(listed);
  const fromDisk = await Promise.all(listed.map(async (path) => {
    const full = join(root, path);
    const buffer = openDocuments.get(full);
    if (buffer !== undefined) return { path, content: buffer };
    if (!isLorePath(path)) return onDemand(path, full);
    const content = await readText(full);
    return content === null ? null : { path, content };
  }));
  const unsaved = await Promise.all(openUnder(root, openDocuments)
    .filter((file) => !seen.has(file.path))
    .map(async (file) => (await exists(join(root, file.path)) ? null : file)));
  return [...fromDisk, ...unsaved].filter((file): file is InputFile => file !== null);
}

function openUnder(root: string, openDocuments: OpenDocuments): InputFile[] {
  const files: InputFile[] = [];
  for (const [full, content] of openDocuments) {
    const path = pathWithin(root, full);
    if (path !== null) files.push({ path, content });
  }
  return files;
}

// The path from root to full with forward slashes, or null when full is not below root.
export function pathWithin(root: string, full: string): string | null {
  const path = relative(root, full);
  if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) return null;
  return posix(path);
}

// The parser reads only Lore files' content, so other files are read if something asks.
function onDemand(path: string, full: string): InputFile {
  let content: string | undefined;
  return {
    path,
    get content() {
      if (content === undefined) {
        try {
          content = decode(readFileSync(full));
        } catch {
          content = "";
        }
      }
      return content;
    },
  };
}

async function readText(full: string): Promise<string | null> {
  try {
    return decode(await readFile(full));
  } catch {
    return null;
  }
}

function decode(bytes: Uint8Array): string {
  try {
    return strict.decode(bytes);
  } catch {
    return markInvalidLines(bytes);
  }
}

// A line feed byte is never part of a multi-byte sequence, so each line decodes on its own.
function markInvalidLines(bytes: Uint8Array): string {
  const lines: string[] = [];
  let start = 0;
  for (;;) {
    const end = bytes.indexOf(LINE_FEED, start);
    const line = bytes.subarray(start, end === -1 ? bytes.length : end);
    try {
      lines.push(strict.decode(line));
    } catch {
      lines.push(INVALID_MARK + lenient.decode(line));
    }
    if (end === -1) return lines.join("\n");
    start = end + 1;
  }
}

async function remotes(root: string): Promise<string[]> {
  const out = await git(root, ["remote", "-v"]);
  if (out === null) return [];
  const urls = out.split("\n").flatMap((line) => {
    const match = /^\S+\t(.+) \(fetch\)$/.exec(line);
    return match === null ? [] : [match[1]!];
  });
  return [...new Set(urls)];
}

async function exists(full: string): Promise<boolean> {
  try {
    await access(full);
    return true;
  } catch {
    return false;
  }
}

function posix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
