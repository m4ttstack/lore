import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/main";

const RULES = 200;
const TRIGGERED = 10;
const HEADING = "## Also in scope, not triggered";

const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-cost-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const id = (n: number): string => `cost-rule-${String(n).padStart(3, "0")}`;
const literal = (n: number): string => `MARKER_${String(n).padStart(3, "0")}`;
const summary = (n: number): string => `Rule ${String(n).padStart(3, "0")} keeps the pricing module consistent with the shared ledger and its audit.`;

mkdirSync(join(root, ".lore", "cost"), { recursive: true });
writeFileSync(join(root, ".loreconfig"), "lore: 1\nrepo: github.com/acme/shop\nloose: true\n");
for (let n = 0; n < RULES; n++) {
  const rule = `<scope>\nfiles: ["src/**"]\n</scope>\n\n<rule id="${id(n)}" category="code_style">\n<when>\naddedContains: ["${literal(n)}"]\n</when>\n${summary(n)}\n</rule>\n`;
  writeFileSync(join(root, ".lore", "cost", `${id(n)}.lore`), rule);
}

const added = Array.from({ length: TRIGGERED }, (_, n) => `+const v${n} = "${literal(n * 20)}";\n`).join("");
const DIFF = `diff --git a/src/price.ts b/src/price.ts\n--- a/src/price.ts\n+++ b/src/price.ts\n@@ -1 +1,${TRIGGERED + 1} @@\n a\n${added}`;

async function select(format: "json" | "text", listing = true): Promise<string> {
  let out = "";
  let err = "";
  const code = await run(
    ["select", "--no-repo", "--remote", "github.com/acme/shop", "--given", root, "--diff", "-", "--format", format, ...(listing ? ["--also-in-scope"] : [])],
    { stdin: async () => DIFF, stdout: (text) => { out += text; }, stderr: (text) => { err += text; }, isTTY: false },
  );
  expect(err).toBe("");
  expect(code).toBe(0);
  return out;
}

test("the fixture's summaries are about 80 characters", () => {
  expect(summary(0).length).toBeGreaterThanOrEqual(70);
  expect(summary(0).length).toBeLessThanOrEqual(90);
});

test("on 200 rules in scope with 10 triggered, the JSON lists the other 190 and pins the bytes they add", async () => {
  const out = await select("json");
  const selection = JSON.parse(out);
  expect(selection.rules).toHaveLength(TRIGGERED);
  expect(selection.alsoInScope).toHaveLength(RULES - TRIGGERED);
  expect(selection.warnings).toEqual([]);
  expect(Buffer.byteLength(out) - Buffer.byteLength(await select("json", false))).toBe(58543);
});

test("on the same change the text section holds 40 rule lines and the overflow line, and pins its size", async () => {
  const out = await select("text");
  const start = out.indexOf(HEADING);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = out.indexOf("\n## ", start + HEADING.length);
  const section = out.slice(start, next === -1 ? undefined : next).trimEnd();
  const lines = section.split("\n");
  expect(lines.filter((line) => line.startsWith("- `"))).toHaveLength(40);
  expect(lines.at(-1)).toBe("- and 150 more; `--format json` lists them all");
  expect(lines).toHaveLength(45);
  expect(Buffer.byteLength(section)).toBe(5326);
});
