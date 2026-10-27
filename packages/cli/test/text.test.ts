import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { toSelection } from "../src/selection";
import { renderText } from "../src/text";
import { change, model, readSrc, result } from "./fixtures";

describe("renderText", () => {
  test("renders the preamble, rules, context and warnings", () => {
    const expected = readFileSync(new URL("./expected/select.md", import.meta.url), "utf8");
    expect(renderText(toSelection(model, result, change, readSrc))).toBe(expected);
  });

  test("an empty selection renders one line", () => {
    const empty = toSelection({ entries: [], errors: [], warnings: [] }, { eligible: [], hits: [], excluded: [], warnings: [] }, { files: [] }, readSrc);
    expect(renderText(empty)).toBe("No Lore rules apply to this change.\n");
  });

  test("an empty selection still lists its warnings", () => {
    const warning = { name: "untracked-given-folder", file: "loose:.", entry: null, line: 1 };
    const empty = toSelection({ entries: [], errors: [], warnings: [] }, { eligible: [], hits: [], excluded: [], warnings: [warning] }, { files: [] }, readSrc);
    expect(renderText(empty)).toBe("No Lore rules apply to this change.\n\n## Warnings\n\n- `untracked-given-folder` in `loose:.` line 1\n");
  });
});
