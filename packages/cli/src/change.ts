import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

// Untracked files join the diff as intent-to-add entries in a copy of the index, so one git diff
// reads them all and the real index never changes. A nested repository is listed as "dir/" and skipped.
function workingTreeDiff(root: string, base: string): string {
  const scratch = mkdtempSync(join(tmpdir(), "lore-index-"));
  try {
    const index = join(scratch, "index");
    const real = resolve(root, git(root, ["rev-parse", "--git-path", "index"]).trim());
    if (existsSync(real)) copyFileSync(real, index);
    const env = { GIT_INDEX_FILE: index, GIT_LITERAL_PATHSPECS: "1" };
    const untracked = untrackedPaths(root).filter((path) => !path.endsWith("/"));
    // A split index would write its shared part into the git directory.
    const noSplit = ["-c", "core.splitIndex=false"];
    if (untracked.length > 0) {
      const input = untracked.map((path) => `${path}\0`).join("");
      git(root, [...noSplit, "add", "--intent-to-add", "--pathspec-from-file=-", "--pathspec-file-nul"], [0], { env, input });
    }
    return git(root, [...noSplit, ...DIFF_FLAGS, base, "--"], [0], { env });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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
