import { git, untrackedPaths } from "./git";
import { InputError } from "./errors";

const DIFF_FLAGS = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M", "--src-prefix=a/", "--dst-prefix=b/"];

// stdin is ignored, so this hashes the empty tree in both SHA-1 and SHA-256 repositories.
function emptyTree(root: string): string {
  return git(root, ["hash-object", "-t", "tree", "--stdin"]).trim();
}

function commitDiff(root: string, commit: string): string {
  if (commit.startsWith("-")) throw new InputError(`not a commit: ${commit}`);
  const sha = git(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${commit}^{commit}`], [0, 1]).trim();
  if (sha === "") throw new InputError(`not a commit: ${commit}`);
  const parent = git(root, ["rev-list", "--parents", "-n", "1", sha]).trim().split(" ")[1] ?? emptyTree(root);
  return git(root, [...DIFF_FLAGS, parent, sha, "--"]);
}

function uncommittedDiff(root: string): string {
  const head = git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], [0, 1]).trim();
  const tracked = git(root, [...DIFF_FLAGS, head === "" ? emptyTree(root) : head, "--"]);
  // --no-index exits 1 when the files differ and prints nothing for a nested repository or a symlink to a directory.
  const untracked = untrackedPaths(root).map((path) => git(root, [...DIFF_FLAGS, "--no-index", "--", "/dev/null", path], [0, 1]));
  return [tracked, ...untracked].join("");
}

export function changeDiff(root: string, commit: string | null): string {
  return commit === null ? uncommittedDiff(root) : commitDiff(root, commit);
}
