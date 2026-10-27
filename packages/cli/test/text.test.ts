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

  describe("backticks in selected text", () => {
    const withHit = (file: string, text: string) =>
      renderText(toSelection(model, { ...result, hits: [{ rule: "money-in-minor-units", file, line: 4, text }] }, change, readSrc));

    test("a flagged line with backticks gets a longer code span", () => {
      expect(withHit("src/a.ts", "const s = `x${y}`;")).toContain("- `src/a.ts:4` ``const s = `x${y}`;``\n");
      expect(withHit("src/a.ts", "const s = `x${y}`")).toContain("- `src/a.ts:4` `` const s = `x${y}` ``\n");
    });

    test("edge backticks, edge spaces and an empty line are padded", () => {
      expect(withHit("src/a.ts", "`x`")).toContain("- `src/a.ts:4` `` `x` ``\n");
      expect(withHit("src/a.ts", " x ")).toContain("- `src/a.ts:4` `  x  `\n");
      expect(withHit("src/a.ts", "")).toContain("- `src/a.ts:4` `  `\n");
    });

    test("a path with a backtick gets a longer code span", () => {
      expect(withHit("src/we`ird.ts", "x")).toContain("- ``src/we`ird.ts:4`` `x`\n");
    });

    test("a srcText holding a line of four backticks stays inside a longer fence", () => {
      const text = renderText(toSelection(model, result, change, () => "before\n````\ninside\n````\nafter\n"));
      expect(text).toContain("From `docs/architecture.md`:\n\n`````\nbefore\n````\ninside\n````\nafter\n`````\n");
    });
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
