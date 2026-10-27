import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const shared = { bundle: true, platform: "node", target: "node20", format: "cjs", logLevel: "warning" } as const;

await Promise.all([
  build({ ...shared, entryPoints: [`${root}/src/extension.ts`], outfile: `${root}/dist/extension.js`, external: ["vscode"] }),
  build({ ...shared, entryPoints: [`${root}/../language-server/src/server.ts`], outfile: `${root}/dist/server.js` }),
]);
