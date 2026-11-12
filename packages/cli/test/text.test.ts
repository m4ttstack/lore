import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { toSelection, type ListedRule, type Selection } from "../src/selection";
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

A flagged line is a place to look, not a verdict. A flagged line marked (removed) is one the change removed, named by the file's old path. Read the context below before changing code. Judge only by these rules; never invent rules from other prose.`;
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

    test("an old-side flagged line is marked removed", () => {
      const selection = toSelection(model, { ...result, hits: [{ rule: "money-in-minor-units", file: "src/Price.ts", line: 4, text: "total * 1.1", side: "old" }] }, change, sources);
      expect(renderText(selection)).toContain("- `src/Price.ts:4` (removed) `total * 1.1`\n");
    });

    test("the flagged-line cap counts both sides", () => {
      const hits = Array.from({ length: 25 }, (_, i) => ({ rule: "money-in-minor-units", file: "src/Price.ts", line: i + 1, text: "x", ...(i % 2 ? { side: "old" as const } : {}) }));
      expect(renderText(toSelection(model, { ...result, hits }, change, sources))).toContain("- and 5 more\n");
    });

    test("both preambles say a flagged line may be a removed one", () => {
      const selection = toSelection(model, result, change, sources);
      for (const text of [renderText(selection), renderText(selection, "author")]) expect(text).toContain("marked (removed)");
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
  describe("also in scope, not triggered", () => {
    const base = toSelection(model, result, change, sources);
    const expected = readFileSync(new URL("./expected/select.md", import.meta.url), "utf8");
    const listed = (id: string, over: Partial<ListedRule> = {}): ListedRule => ({
      id, file: ".lore/other.lore", category: null, severity: "advisory", summary: `Summary of ${id}.`, paths: ["src/a.ts"], ...over,
    });
    const three = [
      listed("money-as-integers", { severity: "blocking", category: "money", summary: "Amounts are integer cents, never floats." }),
      listed("log-levels", { category: "logging" }),
      listed("tidy-imports"),
    ];
    const reviewerParagraph =
      "These rules cover files in this change, but nothing in the change triggered them. No verdict is needed for them. If one looks relevant to what the change does, give it a verdict directly. To read the whole rule first, run the command again with `--expand <id>`, or ask whoever ran it for that rule.";
    const authorParagraph = "These rules cover files you changed, but nothing in your change triggered them. Read any that look relevant with `--expand <id>`.";
    const section = [
      "## Also in scope, not triggered",
      "",
      reviewerParagraph,
      "",
      "- `money-as-integers` (blocking, money): Amounts are integer cents, never floats.",
      "- `log-levels` (advisory, logging): Summary of log-levels.",
      "- `tidy-imports` (advisory, no category): Summary of tidy-imports.",
    ].join("\n");
    const verdictBlock = [
      "Return the verdicts as one fenced code block tagged `lore-verdicts`:",
      "",
      "```lore-verdicts",
      '{ "lore": "1", "verdicts": [{ "rule": "<id>", "verdict": "fail", "evidence": [{ "file": "<path>", "line": 12 }], "note": "<why>" }] }',
      "```",
      "",
      "- `pass`: the change keeps the rule.",
      "- `fail`: the change breaks it. Give at least one location: a changed file and a line in it as the change leaves it, or, with `\"side\": \"old\"`, a file's old path and a line the change removed.",
      "- `not-applicable`: the rule was selected but does not bear on this change. Say why in `note`.",
    ].join("\n");
    const withListing = (selection: Selection, alsoInScope: ListedRule[]): Selection => ({ ...selection, alsoInScope });
    const ruleLines = (text: string) => text.split("\n").filter((line) => /^- `[^`]+` \((blocking|advisory), /.test(line));
    const empty = toSelection({ entries: [], errors: [], warnings: [] }, { eligible: [], hits: [], excluded: [], warnings: [] }, { files: [] }, sources);
    const excluded = [{ name: "unknown-attribute", file: ".lore/bad.lore", entry: "broken", line: 3 }];
    const emptyExcluded = toSelection({ entries: [], errors: [], warnings: [] }, { eligible: [], hits: [], excluded, warnings: [] }, { files: [] }, sources);

    test("the section sits after the contexts and before the warnings", () => {
      const text = renderText(withListing(base, three));
      const before = expected.slice(0, expected.indexOf("\n## Warnings"));
      expect(text).toBe(`${before}\n${section}\n\n${expected.slice(expected.indexOf("## Warnings"))}`);
    });

    test("45 listed rules print 40 lines and count the rest", () => {
      const many = Array.from({ length: 45 }, (_, i) => listed(`rule-${String(i).padStart(2, "0")}`));
      const text = renderText(withListing(base, many));
      expect(ruleLines(text)).toHaveLength(40);
      expect(text).toContain("- `rule-39` (advisory, no category): Summary of rule-39.\n- and 5 more; `--format json` lists them all\n");
      expect(text).not.toContain("rule-40");
    });

    test("exactly 40 listed rules print with no more line", () => {
      const forty = Array.from({ length: 40 }, (_, i) => listed(`rule-${String(i).padStart(2, "0")}`));
      const text = renderText(withListing(base, forty));
      expect(ruleLines(text)).toHaveLength(40);
      expect(text).not.toContain("- and ");
    });

    test("a summary is cut to 160 code points and ends with ..., never splitting a code point", () => {
      const lines = ruleLines(renderText(withListing(base, [listed("long", { summary: "a".repeat(200) }), listed("wide", { summary: "\u{1F600}".repeat(200) })])));
      expect(lines[0]).toBe(`- \`long\` (advisory, no category): ${"a".repeat(160)}...`);
      expect(lines[1]).toBe(`- \`wide\` (advisory, no category): ${"\u{1F600}".repeat(160)}...`);
    });

    test("a summary of exactly 160 code points is kept whole", () => {
      expect(ruleLines(renderText(withListing(base, [listed("edge", { summary: "a".repeat(160) })])))[0]).toBe(`- \`edge\` (advisory, no category): ${"a".repeat(160)}`);
    });

    test("a listed rule with an empty summary ends after its severity and category", () => {
      expect(ruleLines(renderText(withListing(base, [listed("bare", { summary: "" })])))[0]).toBe("- `bare` (advisory, no category)");
    });

    test("a summary with a backtick is printed unchanged and the id gets a safe code span", () => {
      const text = renderText(withListing(base, [listed("we`ird", { summary: "Never call `eval` here." })]));
      expect(text).toContain("- ``we`ird`` (advisory, no category): Never call `eval` here.\n");
    });

    test("an expanded rule's heading says expanded and it has no flagged lines", () => {
      const rule = { ...base.rules[0]!, hits: [], expanded: true as const };
      const text = renderText({ ...base, rules: [rule] });
      expect(text).toContain("## Rule `money-in-minor-units` (blocking, data_lineage, expanded)\n\nMoney is stored as integer minor units.\nNever multiply a price by a float.\n\n## Context");
      expect(text).not.toContain("Flagged lines:");
    });

    test("the author audience gets the author paragraph and no verdict wording", () => {
      const text = renderText(withListing(base, three), "author");
      expect(text).toContain(`## Also in scope, not triggered\n\n${authorParagraph}\n\n- \`money-as-integers\``);
      expect(text).not.toContain(reviewerParagraph);
      expect(text).not.toContain("lore-verdicts");
    });

    test("no rules and no contexts with a listing: reviewer gets the opener, the section and the verdict block", () => {
      expect(renderText(withListing(empty, three))).toBe(`No Lore rules were selected for this change.\n\n${section}\n\n${verdictBlock}\n`);
    });

    test("no rules and no contexts with a listing and excluded entries appends the excluded sentence", () => {
      const text = renderText(withListing(emptyExcluded, three));
      expect(text.split("\n")[0]).toBe("No Lore rules were selected for this change. Some Lore entries were excluded; see the excluded lines on stderr.");
    });

    test("no rules and no contexts with a listing: author gets the opener and the section only", () => {
      const authorSection = section.replace(reviewerParagraph, authorParagraph);
      expect(renderText(withListing(empty, three), "author")).toBe(`No Lore rules were selected for this change.\n\n${authorSection}\n`);
    });

    test("contexts but no rules: the preamble, the contexts, then the section", () => {
      const text = renderText(withListing({ ...base, rules: [] }, three));
      expect(text.startsWith("# Lore rules for this change\n")).toBe(true);
      expect(text).toContain(`\`\`\`\`\n\n${section}\n\n## Warnings`);
      expect(text).not.toContain("## Rule");
    });

    test("an empty or absent listing renders exactly what it does today", () => {
      expect(renderText(withListing(base, []))).toBe(expected);
      expect(renderText(withListing(empty, []))).toBe("No Lore rules apply to this change.\n");
      expect(renderText(withListing(emptyExcluded, []))).toBe("No Lore rules apply to this change. Some Lore entries were excluded; see the excluded lines on stderr.\n");
      expect(renderText(withListing(base, []), "author")).toBe(renderText(base, "author"));
    });
  });
});
