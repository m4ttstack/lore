import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = fileURLToPath(new URL("../../language-server/", import.meta.url));

// The server is built by its own package, so its bundle settings live in one place.
execFileSync("bun", ["run", "build"], { cwd: server, stdio: "inherit" });
mkdirSync(`${root}/dist`, { recursive: true });
copyFileSync(`${server}/dist/server.js`, `${root}/dist/server.js`);

await build({
  entryPoints: [`${root}/src/extension.ts`],
  outfile: `${root}/dist/extension.js`,
  external: ["vscode"],
  bundle: true, platform: "node", target: "node20", format: "cjs", logLevel: "warning",
});
