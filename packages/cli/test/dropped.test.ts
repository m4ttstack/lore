import { expect, test } from "bun:test";
import { select } from "@lore/parser";
import type { LoreInput, SelectOptions } from "@lore/parser";
import { parseUnifiedDiff } from "../src/diff";

const INPUT: LoreInput = { repo: [{ path: ".lore/a.lore", content: '<rule id="fallback-dropped" category="functional_correctness">\n<when>\ndroppedContains: ["??"]\n</when>\nA rule.\n</rule>\n' }], given: [], remotes: ["https://github.com/acme/shop"] };
const ALL: SelectOptions = { capabilities: ["regex"] };
const HEADER = ["diff --git a/src/a.ts b/src/a.ts", "index 111..222 100644", "--- a/src/a.ts", "+++ b/src/a.ts"];
// One file, two edits: line 2 keeps its fallback, line 6 loses it.
const WIDE = [...HEADER, "@@ -1,7 +1,7 @@", " one", "-const a = x ?? 0", "+const a = y ?? 0", " three", " four", " five", "-const b = z ?? 1", "+const b = z", " seven"].join("\n");
const NARROW = [...HEADER, "@@ -2 +2 @@", "-const a = x ?? 0", "+const a = y ?? 0", "@@ -6 +6 @@", "-const b = z ?? 1", "+const b = z"].join("\n");

test("the same change at two context widths selects the same hits", async () => {
  const wide = await select(INPUT, parseUnifiedDiff(WIDE), ALL);
  const narrow = await select(INPUT, parseUnifiedDiff(NARROW), ALL);
  expect(wide.hits).toEqual([{ rule: "fallback-dropped", file: "src/a.ts", line: 6, text: "const b = z ?? 1", side: "old" }]);
  expect(narrow).toEqual(wide);
});

test("a line that only gains its final line break is not found", async () => {
  const diff = [...HEADER, "@@ -3 +3 @@", "-const a = x ?? 0", "\\ No newline at end of file", "+const a = x ?? 0"].join("\n");
  expect((await select(INPUT, parseUnifiedDiff(diff), ALL)).eligible).toEqual([]);
});

test("a rename with an edit pairs across the two paths", async () => {
  const diff = ["diff --git a/src/old.ts b/src/new.ts", "similarity index 80%", "rename from src/old.ts", "rename to src/new.ts", "--- a/src/old.ts", "+++ b/src/new.ts", "@@ -2 +2 @@", "-const a = x ?? 0", "+const a = y ?? 0"].join("\n");
  expect((await select(INPUT, parseUnifiedDiff(diff), ALL)).eligible).toEqual([]);
});
