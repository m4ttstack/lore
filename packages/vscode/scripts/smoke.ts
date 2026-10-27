// Local check only, not part of bun test or CI: it launches an installed VS Code or Cursor with a scratch profile.
// Usage: bun run smoke <scratch dir> [path to the editor's executable]
// The editor trusts every workspace while extension tests run, so trust gating cannot be checked here.
import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = ".lore-smoke";
const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = fileURLToPath(new URL("../../../test/fixtures/", import.meta.url));
const [scratch, executable = "/Applications/Visual Studio Code.app/Contents/MacOS/Code"] = process.argv.slice(2);
if (scratch === undefined) throw new Error("usage: bun run smoke <scratch dir> [editor executable]");

mkdirSync(scratch, { recursive: true });
if (readdirSync(scratch).length > 0 && !existsSync(join(scratch, MARKER))) {
  throw new Error(`${scratch} is not empty and was not made by this script; pass an empty or new folder`);
}
writeFileSync(join(scratch, MARKER), "");
const workspace = join(scratch, "workspace");
const governed = join(scratch, "governed");
const rules = join(scratch, "rules");
const extensions = join(scratch, "extensions");
const suite = join(scratch, "suite.js");
for (const path of [workspace, governed, rules, extensions, suite]) rmSync(path, { recursive: true, force: true });

mkdirSync(join(workspace, ".lore"), { recursive: true });
mkdirSync(join(workspace, "src"), { recursive: true });
copyFileSync(join(fixtures, "example-1-1.lore"), join(workspace, ".lore/checkout.lore"));
copyFileSync(join(fixtures, "example-5-1.lore"), join(workspace, ".lore/broken.lore"));
writeFileSync(join(workspace, "src/app.ts"), "export const total = 0;\n");
execFileSync("git", ["init", "--quiet"], { cwd: workspace });

// A governed repository with no Lore of its own: its rules live in another repository, mapped through repo.
mkdirSync(join(rules, "shop/.lore"), { recursive: true });
writeFileSync(join(rules, "shop/.loreconfig"), "lore: 1\nrepo: github.com/acme/shop\n");
writeFileSync(
  join(rules, "shop/.lore/pricing.lore"),
  "<rule id=\"external-rule\" category=\"functional_correctness\">\n  <scope>\n  files: [\"src/**\"]\n  </scope>\n  Prices come from the quote.\n</rule>\n",
);
execFileSync("git", ["init", "--quiet"], { cwd: rules });
mkdirSync(join(governed, "src"), { recursive: true });
mkdirSync(join(governed, ".vscode"), { recursive: true });
writeFileSync(join(governed, "src/app.ts"), "export const total = 0;\n");
writeFileSync(join(governed, ".vscode/settings.json"), JSON.stringify({ "lore.externalFolders": [join(rules, "shop")] }));
execFileSync("git", ["init", "--quiet"], { cwd: governed });
execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/shop.git"], { cwd: governed });

execFileSync("bun", ["scripts/build.ts"], { cwd: root, stdio: "inherit" });
await build({
  entryPoints: [join(root, "scripts/smoke-suite.ts")],
  outfile: suite, bundle: true, platform: "node", target: "node20", format: "cjs", external: ["vscode"],
});

// The editor's IPC socket lives in the user data folder, and macOS caps socket paths at 103 characters.
async function runIn(folder: string, mode: "local" | "external"): Promise<number> {
  const userData = mkdtempSync(join(tmpdir(), "lore-smoke-"));
  try {
    return await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: root,
      extensionTestsPath: suite,
      extensionTestsEnv: { LORE_SMOKE_WORKSPACE: folder, LORE_SMOKE_MODE: mode, LORE_SMOKE_SERVER: join(root, "dist/server.js") },
      launchArgs: [
        folder,
        "--user-data-dir", userData,
        "--extensions-dir", extensions,
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
      ],
    });
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
}

process.exitCode = (await runIn(workspace, "local")) || (await runIn(governed, "external"));
