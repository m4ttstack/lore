import { describe, expect, test } from "bun:test";
import type { Diagnostic, Entry } from "@lore/parser";
import { UsageError } from "../src/errors";
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

  test("old-side hits and removed line numbers pass through", () => {
    const withOld = { ...result, hits: [{ rule: "money-in-minor-units", file: "src/Price.ts", line: 4, text: "total * 1.1", side: "old" as const }] };
    const selection = toSelection(model, withOld, change, sources);
    expect(selection.rules.find((rule) => rule.id === "money-in-minor-units")!.hits).toEqual([{ file: "src/Price.ts", line: 4, text: "total * 1.1", side: "old" }]);
    expect(selection.change.map((file) => file.removed)).toEqual([[4], []]);
  });

  test("the change lists added line numbers and an old path only for a rename", () => {
    expect(selection.change).toEqual([
      { kind: "M", path: "src/Price.ts", oldPath: null, added: [4, 9], removed: [4] },
      { kind: "R", path: "src/new.ts", oldPath: "src/old.ts", added: [], removed: [] },
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

  describe("with a listing", () => {
    const base = { category: null, severity: null, disabled: false, scopes: [], when: null, checks: [], meta: null, src: null, prose: "Prose." };
    const extra: Entry[] = [
      { ...base, kind: "rule", id: "b-advisory", file: ".lore/x.lore", summary: "B." },
      { ...base, kind: "rule", id: "a-advisory", file: ".lore/x.lore", summary: "A." },
      { ...base, kind: "rule", id: "c-advisory", file: ".lore/x.lore", summary: "C." },
      { ...base, kind: "rule", id: "z-blocking", file: ".lore/y.lore", category: "security", severity: "blocking", summary: "Z." },
      { ...base, kind: "rule", id: "middle", file: ".lore/y.lore", summary: "Middle.", prose: "Middle prose.", meta: { owner: "x" } },
    ];
    const listed = { ...model, entries: [...model.entries, ...extra] };
    const untriggered = [
      { id: "a-advisory", paths: ["src/a.ts"] },
      { id: "b-advisory", paths: ["src/a.ts", "src/b.ts"] },
      { id: "c-advisory", paths: ["src/a.ts"] },
      { id: "middle", paths: ["src/a.ts"] },
      { id: "z-blocking", paths: ["src/a.ts"] },
    ];

    test("lists blocking before advisory, then more covered paths first, then id", () => {
      const selection = toSelection(listed, result, change, sources, [], { untriggered, expand: [] });
      expect(selection.alsoInScope!.map((rule) => rule.id)).toEqual(["z-blocking", "b-advisory", "a-advisory", "c-advisory", "middle"]);
      expect(selection.alsoInScope![0]).toEqual({
        id: "z-blocking", file: ".lore/y.lore", category: "security", severity: "blocking", summary: "Z.", paths: ["src/a.ts"],
      });
      expect(selection.rules.map((rule) => rule.id)).toEqual(["money-in-minor-units", "name-things"]);
    });

    test("an expanded rule joins rules in id order with no hits and leaves the listing", () => {
      const selection = toSelection(listed, result, change, sources, [], { untriggered, expand: ["middle"] });
      expect(selection.rules.map((rule) => rule.id)).toEqual(["middle", "money-in-minor-units", "name-things"]);
      expect(selection.rules[0]).toEqual({
        id: "middle", file: ".lore/y.lore", category: null, severity: "advisory", summary: "Middle.", prose: "Middle prose.",
        meta: { owner: "x" }, hits: [], expanded: true,
      });
      expect(selection.alsoInScope!.map((rule) => rule.id)).not.toContain("middle");
      expect(selection.rules[1]).not.toHaveProperty("expanded");
    });

    test.each([
      ["an already selected rule", "name-things"],
      ["an unknown id", "no-such-rule"],
    ])("expanding %s is a usage error naming the id", (_name, id) => {
      expect(() => toSelection(listed, result, change, sources, [], { untriggered, expand: ["middle", id] })).toThrow(UsageError);
      expect(() => toSelection(listed, result, change, sources, [], { untriggered, expand: ["middle", id] })).toThrow(id);
    });

    test("expanding an already selected rule says it is already selected", () => {
      expect(() => toSelection(listed, result, change, sources, [], { untriggered, expand: ["name-things"] }))
        .toThrow("--expand name-things: the rule is already selected");
    });

    test("expanding an unknown id keeps the listing message", () => {
      expect(() => toSelection(listed, result, change, sources, [], { untriggered, expand: ["no-such-rule"] }))
        .toThrow("--expand no-such-rule: not a rule in scope whose conditions did not hold");
    });

    test("an empty listing is an empty key", () => {
      expect(toSelection(model, result, change, sources, [], { untriggered: [], expand: [] }).alsoInScope).toEqual([]);
    });

    test("without a listing the key is absent", () => {
      expect("alsoInScope" in toSelection(model, result, change, sources)).toBe(false);
    });
  });
});
