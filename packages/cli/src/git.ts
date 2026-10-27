import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { InputError } from "./errors";

const MAX_BUFFER = 1024 * 1024 * 1024;

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const { code, stderr } = error as NodeJS.ErrnoException & { stderr?: string };
    const reason = code === "ENOENT" ? "git is not installed" : String(stderr ?? "").trim().split("\n")[0] ?? "";
    throw new InputError(`git ${args.join(" ")} failed${reason === "" ? "" : `: ${reason}`}`);
  }
}

export function gitRoot(dir: string): string | null {
  try {
    return realpathSync(git(dir, ["rev-parse", "--show-toplevel"]).trim());
  } catch (error) {
    if (error instanceof InputError && error.message.includes("git is not installed")) throw error;
    return null;
  }
}

export function trackedPaths(root: string, ref: string | null): string[] {
  if (ref === null) {
    const gone = new Set(git(root, ["ls-files", "-z", "--deleted"]).split("\0"));
    return git(root, ["ls-files", "-z"]).split("\0").filter((path) => path !== "" && !gone.has(path));
  }
  if (ref.startsWith("-")) throw new InputError(`not a git ref: ${ref}`);
  return git(root, ["ls-tree", "-r", "-z", "--name-only", ref]).split("\0").filter((path) => path !== "");
}

export function readFileAt(root: string, ref: string | null, path: string): string {
  if (ref === null) return readFileSync(join(root, path), "utf8");
  return git(root, ["show", `${ref}:${path}`]);
}

export function remoteUrls(root: string): string[] {
  const urls = git(root, ["remote", "-v"])
    .split("\n")
    .map((line) => /^\S+\s+(\S+)\s+\(fetch\)$/.exec(line)?.[1])
    .filter((url): url is string => url !== undefined);
  return [...new Set(urls)];
}
