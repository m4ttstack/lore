import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExamples } from "../tools/check/extract";

const markdown = readFileSync(new URL("../spec/SPEC.md", import.meta.url), "utf8");

test("the prose normalization example keeps its line of exactly four spaces", () => {
  const example = extractExamples(markdown).find((e) => e.files.some((f) => f.content.includes('<rule id="quote-totals-match"')));
  expect(example).toBeDefined();
  expect(example!.files[0]!.content.split("\n")).toContain("    ");
});

const BOM = String.fromCodePoint(0xfeff);
const NBSP = String.fromCodePoint(0xa0);

test("the byte order mark example still starts its input with U+FEFF", () => {
  const inputs = extractExamples(markdown).flatMap((e) => e.files.map((f) => f.content));
  expect(inputs.filter((c) => c.startsWith(BOM + "<rule"))).toHaveLength(1);
});

test("the regex dialect example still holds a no-break space in its added line", () => {
  const diffs = extractExamples(markdown).map((e) => e.diff ?? "");
  expect(diffs.filter((d) => d.includes("Total" + NBSP + "USD"))).toHaveLength(1);
});
