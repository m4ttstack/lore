import { expect, test } from "bun:test";
import { readmeSamples } from "./fixtures";

test("readmeSamples reads each html fence and stops at one with no closing fence", () => {
  const readme = "# Title\n\n```html\n<rule id=\"a\">\nA.\n</rule>\n```\n\nText.\n\n```html\n<rule id=\"open\">\n";
  expect(readmeSamples(readme)).toEqual(["<rule id=\"a\">\nA.\n</rule>\n"]);
});
