import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { InputError } from "./errors";

const MAX_BUFFER = 1024 * 1024 * 1024;

export class GitMissingError extends InputError {
  constructor(message: string) {
    super(message);
    this.name = "GitMissingError";
  }
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const { code, stderr } = error as NodeJS.ErrnoException & { stderr?: string };
    if (code === "ENOENT") throw new GitMissingError("git is not installed");
    const reason = String(stderr ?? "").trim().split("\n")[0] ?? "";
    throw new InputError(`git ${args.join(" ")} failed${reason === "" ? "" : `: ${reason}`}`);
  }
}

// Only git's "no repository here" answer means no working copy; any other refusal (dubious
// ownership in a CI container, a broken .git file) would otherwise turn a tracked folder loose.
export function gitRoot(dir: string): string | null {
  try {
    return realpathSync(git(dir, ["rev-parse", "--show-toplevel"]).trim());
  } catch (error) {
    if (!(error instanceof GitMissingError) && error instanceof InputError && /not a git repository \(or any /.test(error.message)) return null;
    throw error;
  }
}

export function trackedPaths(root: string, ref: string | null): string[] {
  if (ref === null) {
    const gone = new Set(git(root, ["ls-files", "-z", "--deleted"]).split("\0"));
    const listed = git(root, ["ls-files", "-z"]).split("\0").filter((path) => path !== "" && !gone.has(path));
    return [...new Set(listed)];
  }
  if (ref.startsWith("-")) throw new InputError(`not a git ref: ${ref}`);
  return git(root, ["ls-tree", "-r", "-z", "--name-only", ref]).split("\0").filter((path) => path !== "");
}

// Null unless the path resolves, through any symlinks, to a readable regular file inside root.
export function readContained(root: string, path: string): string | null {
  try {
    const real = realpathSync(resolve(root, path));
    const from = relative(realpathSync(root), real);
    if (from === ".." || from.startsWith(`..${sep}`) || !statSync(real).isFile()) return null;
    return readFileSync(real, "utf8");
  } catch {
    return null;
  }
}

// Null unless both the path and the file it resolves to through any symlinks are in tracked, so an
// ignored or untracked file (a token in .npmrc, say) never reaches the output by name or by link.
export function readTracked(root: string, path: string, tracked: ReadonlySet<string>): string | null {
  if (!tracked.has(path)) return null;
  try {
    const real = realpathSync(resolve(root, path));
    const from = relative(realpathSync(root), real).split(sep).join("/");
    if (!tracked.has(from) || !statSync(real).isFile()) return null;
    return readFileSync(real, "utf8");
  } catch {
    return null;
  }
}

export function readFileAt(root: string, ref: string | null, path: string): string {
  if (ref !== null) return git(root, ["show", `${ref}:${path}`]);
  const content = readContained(root, path);
  if (content === null) throw new InputError(`cannot read ${path} inside ${root}`);
  return content;
}

export function remoteUrls(root: string): string[] {
  const urls = git(root, ["remote", "-v"])
    .split("\n")
    .map((line) => /^\S+\s+(\S+)\s+\(fetch\)$/.exec(line)?.[1])
    .filter((url): url is string => url !== undefined);
  return [...new Set(urls)];
}
