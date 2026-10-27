import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExamples } from "../../../tools/check/extract";
import { parse, select } from "../src/index";
import pending from "./pending.json";
import { toChange, toInput } from "./harness";

const specPath = new URL("../../../spec/SPEC.md", import.meta.url);
const examples = extractExamples(readFileSync(specPath, "utf8"));
const pendingReasons: Record<string, string> = pending;

function withoutRanges(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, v) => (key === "range" ? undefined : v)));
}

describe("conformance", () => {
  test("every key in pending.json is a real example number", () => {
    const numbers = new Set(examples.map((e) => String(e.number)));
    for (const key of Object.keys(pendingReasons)) expect(numbers.has(key)).toBe(true);
  });

  for (const example of examples) {
    const run = String(example.number) in pendingReasons ? test.skip : test;
    run(`example ${example.number} (${example.section})`, async () => {
      const input = toInput(example);
      const expected = JSON.parse(example.expect ?? "null");
      const actual =
        example.kind === "eligibility"
          ? await select(input, toChange(example.diff ?? ""), { capabilities: ["regex", "ast-grep"] })
          : parse(input);
      expect(withoutRanges(actual)).toEqual(expected);
    });
  }
});
