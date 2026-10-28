import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "@lore/parser";
import { toSelection } from "../src/selection";
import { change, model, sources, result } from "./fixtures";

describe("toSelection", () => {
  const selection = toSelection(model, result, change, sources);

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

  test("a context reads its src through sources", () => {
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
    const gone = toSelection(model, result, change, { ...sources, read: () => null });
    expect(gone.context[0]).toMatchObject({ src: "docs/architecture.md", srcText: null });
    const none = toSelection(
      { ...model, entries: model.entries.map((entry) => (entry.kind === "context" ? { ...entry, src: null } : entry)) },
      result, change, sources,
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

  describe("warnings for content the command could not read", () => {
    const unreadable = { ...sources, read: () => null };

    test("a selected context whose src target the parser found but the command did not read gets src-not-read", () => {
      expect(toSelection(model, result, change, unreadable).warnings).toEqual([
        ...result.warnings,
        { name: "src-not-read", file: ".lore/pricing.lore", entry: "architecture", line: 12, range: { start: { line: 12, character: 0 }, end: { line: 12, character: 9 } } },
      ]);
    });

    test("src-not-read carries the entry's range like the parser's own diagnostics", () => {
      const [warning] = toSelection(model, result, change, unreadable).warnings.filter((found) => found.name === "src-not-read");
      expect(warning!.range).toEqual(sources.diagnostic(model.entries.find((entry) => entry.kind === "context")!, "missing-src-target").range);
    });

    test("a context the parser already warned has a missing src target gets no src-not-read", () => {
      const missing = { name: "missing-src-target", file: ".lore/pricing.lore", entry: "architecture", line: 12 };
      const warned = toSelection(model, { ...result, warnings: [...result.warnings, missing] }, change, unreadable);
      expect(warned.warnings.map((warning) => warning.name)).toEqual(["check-needs-file", "missing-src-target"]);
    });

    test("the command's unread Lore files join the warnings in the parser's order", () => {
      const governed: Diagnostic = { name: "lore-file-not-read", file: ".lore/broken.lore", entry: null, line: 1 };
      const external: Diagnostic = { name: "lore-file-not-read", file: "external:.lore/a.lore", entry: null, line: 1 };
      expect(toSelection(model, result, change, sources, [external, governed]).warnings).toEqual([governed, ...result.warnings, external]);
    });
  });
});
