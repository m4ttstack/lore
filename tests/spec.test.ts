import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExamples } from "../tools/check/extract";

const markdown = readFileSync(new URL("../spec/SPEC.md", import.meta.url), "utf8");

test("the prose normalization example keeps its line of exactly four spaces", () => {
  const example = extractExamples(markdown).find((e) => e.files.some((f) => f.content.includes('<rule id="quote-totals-match"')));
  expect(example).toBeDefined();
  expect(example!.files[0]!.content.split("\n")).toContain("    ");
});
