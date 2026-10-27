import { describe, expect, test } from "bun:test";
import { toSelection } from "../src/selection";
import { change, model, readSrc, result } from "./fixtures";

describe("toSelection", () => {
  const selection = toSelection(model, result, change, readSrc);

  test("splits the eligible entries into rules and context, in the result's order", () => {
    expect(selection.lore).toBe("1");
    expect(selection.rules.map((rule) => rule.id)).toEqual(["money-in-minor-units", "name-things"]);
    expect(selection.context.map((context) => context.id)).toEqual(["architecture"]);
    expect(selection.conditional).toEqual([]);
  });

  test("a rule carries its hits without the rule field", () => {
    expect(selection.rules[0]).toEqual({
      id: "money-in-minor-units",
      file: ".lore/pricing.lore",
      category: "data_lineage",
      severity: "blocking",
      summary: "Money is integer minor units.",
      prose: "Money is stored as integer minor units.\nNever multiply a price by a float.",
      meta: { owner: "pricing" },
      hits: [
        { file: "src/Price.ts", line: 4, text: "total * 1.2" },
        { file: "src/Price.ts", line: 9, text: "price * 0.5" },
      ],
    });
  });

  test("a null severity reports advisory", () => {
    expect(selection.rules[1]).toMatchObject({ id: "name-things", severity: "advisory", category: null, meta: null, hits: [] });
  });

  test("a context reads its src through readSrc", () => {
    expect(selection.context[0]).toEqual({
      id: "architecture",
      file: ".lore/pricing.lore",
      summary: "Pricing architecture.",
      prose: "Pricing lives in one module.",
      src: "docs/architecture.md",
      srcText: "# Architecture\n\nOne pricing module.\n",
    });
  });

  test("a context whose src cannot be read, or that has none, has a null srcText", () => {
    const gone = toSelection(model, result, change, () => null);
    expect(gone.context[0]).toMatchObject({ src: "docs/architecture.md", srcText: null });
    const none = toSelection(
      { ...model, entries: model.entries.map((entry) => (entry.kind === "context" ? { ...entry, src: null } : entry)) },
      result, change, readSrc,
    );
    expect(none.context[0]).toMatchObject({ src: null, srcText: null });
  });

  test("the change lists added line numbers and an old path only for a rename", () => {
    expect(selection.change).toEqual([
      { kind: "M", path: "src/Price.ts", oldPath: null, added: [4, 9] },
      { kind: "R", path: "src/new.ts", oldPath: "src/old.ts", added: [] },
    ]);
  });

  test("excluded and warnings pass through", () => {
    expect(selection.excluded).toEqual(result.excluded);
    expect(selection.warnings).toEqual(result.warnings);
  });
});
