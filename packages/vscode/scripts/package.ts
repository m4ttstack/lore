import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: root, stdio: "inherit" });

run("bun", ["scripts/build.ts"]);
copyFileSync(fileURLToPath(new URL("../../../LICENSE", import.meta.url)), `${root}/LICENSE`);
run("vsce", ["package", "--no-dependencies", "--out", "dist/lore-vscode.vsix"]);
