import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The spec gives these fixtures no readable structure, so no tree for them
// can be free of ERROR nodes.
const UNPARSEABLE = new Set(["unreadable-structure", "top-level-text"]);

const grammarDir = join(import.meta.dir, "..");
const fixturesDir = join(grammarDir, "..", "..", "test", "fixtures");
const index = JSON.parse(readFileSync(join(fixturesDir, "index.json"), "utf8")) as Record<string, { errors: string[] }>;

const names = Object.keys(index).filter((name) => !index[name]!.errors.some((error) => UNPARSEABLE.has(error)));
const crlfDir = mkdtempSync(join(tmpdir(), "lore-crlf-"));

try {
  const paths = names.map((name) => join(fixturesDir, name));
  for (const name of names) {
    const crlfPath = join(crlfDir, name);
    writeFileSync(crlfPath, readFileSync(join(fixturesDir, name), "utf8").replace(/\r?\n/g, "\r\n"));
    paths.push(crlfPath);
  }

  const result = spawnSync("bunx", ["tree-sitter", "parse", "--quiet", "--grammar-path", grammarDir, ...paths], {
    cwd: grammarDir,
    encoding: "utf8",
  });
  if (result.error) throw result.error;

  if (result.status === 0) {
    console.log(`${names.length} fixtures parse without ERROR nodes, with LF and with CRLF line endings.`);
  } else {
    console.error(result.stdout);
    console.error(result.stderr);
    process.exitCode = 1;
  }
} finally {
  rmSync(crlfDir, { recursive: true, force: true });
}
