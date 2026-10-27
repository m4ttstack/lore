import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const GRAMMAR = "packages/tree-sitter-lore";

const root = join(import.meta.dir, "..");
const zed = join(root, "packages", "zed");

function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const checkout = git(["rev-parse", "--show-toplevel"]);
const rev = git(["log", "-1", "--format=%H", "--", GRAMMAR]);
if (rev === "") throw new Error(`No commit touches ${GRAMMAR} yet. Commit the grammar first.`);

const repository = pathToFileURL(checkout).href;
const manifest = readFileSync(join(zed, "extension.toml.in"), "utf8")
  .replaceAll("{{repository}}", repository)
  .replaceAll("{{rev}}", rev);
writeFileSync(join(zed, "extension.toml"), manifest);
console.log(`Wrote packages/zed/extension.toml: grammar ${repository} at ${rev}.`);

if (git(["status", "--porcelain", "--", GRAMMAR]) !== "") {
  console.warn(`${GRAMMAR} has uncommitted changes. Zed builds the grammar from ${rev}, so commit them and run this again.`);
}
