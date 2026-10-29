import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { toSelection } from "../src/selection";
import { excludedLines, renderText } from "../src/text";
import { change, model, sources, result } from "./fixtures";

describe("renderText", () => {
  test("renders the preamble, rules, context and warnings", () => {
    const expected = readFileSync(new URL("./expected/select.md", import.meta.url), "utf8");
    expect(renderText(toSelection(model, result, change, sources))).toBe(expected);
  });

  describe("author audience", () => {
    const authorPreamble = `# Lore rules for this change

These rules apply to your change. Fix any that your change breaks.

A flagged line is a place to look, not a verdict. Read the context below before changing code. Judge only by these rules; never invent rules from other prose.`;
    const selection = toSelection(model, result, change, sources);
    const author = renderText(selection, "author");
    const reviewer = renderText(selection);

    test("author text starts with the author preamble", () => {
      expect(author.startsWith(authorPreamble)).toBe(true);
    });

    test("author text asks for no verdicts", () => {
      expect(author).not.toContain("lore-verdicts");
      expect(author).not.toContain("Answer every rule");
    });

    test("author text keeps the rule, flagged-line and context sections", () => {
      expect(author.slice(authorPreamble.length)).toBe(reviewer.slice(reviewer.indexOf("\n\n## Rule")));
    });
  });

  describe("backticks in selected text", () => {
    const withHit = (file: string, text: string) =>
      renderText(toSelection(model, { ...result, hits: [{ rule: "money-in-minor-units", file, line: 4, text }] }, change, sources));

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
      const text = renderText(toSelection(model, result, change, { ...sources, read: () => "before\n````\ninside\n````\nafter\n" }));
      expect(text).toContain("From `docs/architecture.md`:\n\n`````\nbefore\n````\ninside\n````\nafter\n`````\n");
    });
  });

  describe("flagged lines", () => {
    const hits = (count: number, text = "x") =>
      Array.from({ length: count }, (_, i) => ({ rule: "money-in-minor-units", file: "src/a.ts", line: i + 1, text }));
    const render = (count: number, text?: string) =>
      renderText(toSelection(model, { ...result, hits: hits(count, text) }, change, sources));
    const bullets = (text: string) => text.split("\n").filter((line) => line.startsWith("- `src/a.ts:"));

    test("a rule shows 20 flagged lines, then says how many more", () => {
      const text = render(25);
      expect(bullets(text)).toHaveLength(20);
      expect(text).toContain("- `src/a.ts:20` `x`\n- and 5 more\n");
      expect(text).not.toContain("src/a.ts:21");
    });

    test("exactly 20 flagged lines are all shown with no more line", () => {
      const text = render(20);
      expect(bullets(text)).toHaveLength(20);
      expect(text).not.toContain("and 0 more");
      expect(text).not.toContain("- and ");
    });

    test("a flagged line is cut to 200 code points and ends with ...", () => {
      const line = bullets(render(1, "a".repeat(300)))[0]!;
      expect(line).toBe(`- \`src/a.ts:1\` \`${"a".repeat(200)}...\``);
    });

    test("a line of exactly 200 code points is kept whole, and the cut never splits a code point", () => {
      expect(bullets(render(1, "a".repeat(200)))[0]).toBe(`- \`src/a.ts:1\` \`${"a".repeat(200)}\``);
      const cut = bullets(render(1, "\u{1F600}".repeat(250)))[0]!;
      expect(cut).toBe(`- \`src/a.ts:1\` \`${"\u{1F600}".repeat(200)}...\``);
    });

    test("the selection keeps every hit and its full text for JSON", () => {
      const selection = toSelection(model, { ...result, hits: hits(25, "a".repeat(300)) }, change, sources);
      renderText(selection);
      expect(selection.rules[0]!.hits).toHaveLength(25);
      expect(selection.rules[0]!.hits[0]!.text).toHaveLength(300);
    });
  });

  test("an empty selection renders one line", () => {
    const empty = toSelection({ entries: [], errors: [], warnings: [] }, { eligible: [], hits: [], excluded: [], warnings: [] }, { files: [] }, sources);
    expect(renderText(empty)).toBe("No Lore rules apply to this change.\n");
  });

  test("an empty selection with excluded entries says so, and the excluded lines name each one", () => {
    const excluded = [
      { name: "unknown-attribute", file: ".lore/bad.lore", entry: "broken", line: 3 },
      { name: "invalid-loreconfig", file: ".loreconfig", entry: null, line: 1 },
    ];
    const empty = toSelection({ entries: [], errors: [], warnings: [] }, { eligible: [], hits: [], excluded, warnings: [] }, { files: [] }, sources);
    expect(renderText(empty)).toBe("No Lore rules apply to this change. Some Lore entries were excluded; see the excluded lines on stderr.\n");
    expect(excludedLines(empty)).toBe(
      "lore: excluded unknown-attribute in .lore/bad.lore line 3 (entry broken)\nlore: excluded invalid-loreconfig in .loreconfig line 1\n",
    );
  });

  test("an empty selection still lists its warnings", () => {
    const warning = { name: "untracked-given-folder", file: "loose:.", entry: null, line: 1 };
    const empty = toSelection({ entries: [], errors: [], warnings: [] }, { eligible: [], hits: [], excluded: [], warnings: [warning] }, { files: [] }, sources);
    expect(renderText(empty)).toBe("No Lore rules apply to this change.\n\n## Warnings\n\n- `untracked-given-folder` in `loose:.` line 1\n");
  });
});
