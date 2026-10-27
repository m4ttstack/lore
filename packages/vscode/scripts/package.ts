import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: root, stdio: "inherit" });

run("bun", ["scripts/build.ts"]);
run("vsce", [
  "package",
  "--no-dependencies",
  "--skip-license",
  "--allow-missing-repository",
  "--out", "dist/lore-vscode.vsix",
]);
