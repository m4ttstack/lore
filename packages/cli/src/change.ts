import { git, untrackedPaths } from "./git";
import { InputError } from "./errors";

const DIFF_FLAGS = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M", "--src-prefix=a/", "--dst-prefix=b/"];

// stdin is ignored, so this hashes the empty tree in both SHA-1 and SHA-256 repositories.
function emptyTree(root: string): string {
  return git(root, ["hash-object", "-t", "tree", "--stdin"]).trim();
}

function resolveCommit(root: string, ref: string): string {
  if (ref.startsWith("-")) throw new InputError(`not a commit: ${ref}`);
  const sha = git(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], [0, 1]).trim();
  if (sha === "") throw new InputError(`not a commit: ${ref}`);
  return sha;
}

function commitDiff(root: string, commit: string): string {
  const sha = resolveCommit(root, commit);
  const parent = git(root, ["rev-list", "--parents", "-n", "1", sha]).trim().split(" ")[1] ?? emptyTree(root);
  return git(root, [...DIFF_FLAGS, parent, sha, "--"]);
}

function mergeBase(root: string, ref: string): string {
  const sha = resolveCommit(root, ref);
  const head = git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], [0, 1]).trim();
  const base = head === "" ? "" : git(root, ["merge-base", sha, head], [0, 1]).trim();
  if (base === "") throw new InputError(`no merge base between ${ref} and HEAD`);
  return base;
}

function workingTreeDiff(root: string, base: string): string {
  const tracked = git(root, [...DIFF_FLAGS, base, "--"]);
  // --no-index exits 1 when the files differ and prints nothing for a nested repository or a symlink to a directory.
  const untracked = untrackedPaths(root).map((path) => git(root, [...DIFF_FLAGS, "--no-index", "--", "/dev/null", path], [0, 1]));
  return [tracked, ...untracked].join("");
}

function uncommittedDiff(root: string): string {
  const head = git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], [0, 1]).trim();
  return workingTreeDiff(root, head === "" ? emptyTree(root) : head);
}

export type ChangeSource = { commit: string } | { base: string | null };

export function changeDiff(root: string, source: ChangeSource): string {
  if ("commit" in source) return commitDiff(root, source.commit);
  return source.base === null ? uncommittedDiff(root) : workingTreeDiff(root, mergeBase(root, source.base));
}
