import { describe, expect, test } from "bun:test";
import type { Hover, MarkupContent } from "vscode-languageserver/node";
import { diagnose, registryDescription } from "../src/diagnostics";
import { hover } from "../src/hover";

function text(found: Hover | null): string {
  return (found?.contents as MarkupContent | undefined)?.value ?? "";
}

describe("hover", () => {
  test("hover on an error shows its description", () => {
    const content = "<rule id=\"a\" category=\"made_up\">\nText.\n</rule>\n";
    const diagnostics = diagnose({ repo: [{ path: ".lore/a.lore", content }], given: [], remotes: [] }).byFile.get(".lore/a.lore")!;
    expect(diagnostics.map((d) => d.code)).toEqual(["unknown-category"]);
    const shown = text(hover(content, { line: 0, character: 26 }, { diagnostics, entries: [] }));
    expect(shown).toContain("unknown-category");
    expect(shown).toContain(registryDescription("unknown-category"));
    expect(text(hover(content, { line: 1, character: 2 }, { diagnostics, entries: [] }))).toBe("");
  });

  test("a tag, an attribute and a when key each have a text", () => {
    const content = "<rule id=\"a\">\n  <when>\n    changed: [\"x\"]\n  </when>\n  <check lang=\"regex\">\n  x\n  </check>\nText.\n</rule>\n";
    const facts = { diagnostics: [], entries: [] };
    expect(text(hover(content, { line: 1, character: 4 }, facts))).toMatch(/^`<when>`: .+\.$/);
    expect(text(hover(content, { line: 0, character: 7 }, facts))).toMatch(/^`id`: .+\.$/);
    expect(text(hover(content, { line: 4, character: 10 }, facts))).toMatch(/^`lang`: .+\.$/);
    expect(text(hover(content, { line: 2, character: 6 }, facts))).toMatch(/^`changed`: .+\.$/);
    expect(text(hover(content, { line: 8, character: 3 }, facts))).toMatch(/^`<rule>`: .+\.$/);
  });

  test("tag-shaped lines in prose or in a fence are not described", () => {
    const content = "<rule id=\"a\">\nDisplay text never hard-codes a currency code.\n<when>\nchanged: [\"x\"]\n</when>\n\n"
      + "```lore\n<rule id=\"b\">\n</rule>\n```\n</rule>\n";
    const facts = { diagnostics: [], entries: [] };
    expect(hover(content, { line: 2, character: 2 }, facts)).toBeNull();
    expect(hover(content, { line: 3, character: 2 }, facts)).toBeNull();
    expect(hover(content, { line: 7, character: 2 }, facts)).toBeNull();
    expect(hover(content, { line: 8, character: 3 }, facts)).toBeNull();
    expect(text(hover(content, { line: 10, character: 3 }, facts))).toMatch(/^`<rule>`: /);
  });

  test("an entry's opening tag shows its resolved scope", () => {
    const content = "<scope>\nfiles: [\"src/**\"]\n</scope>\n\n<rule id=\"a\">\n  <scope>\n  ignores: [\"gen/**\"]\n  </scope>\nText.\n</rule>\n";
    const name = "web/.lore/a.lore";
    const { model } = diagnose({ repo: [{ path: name, content }], given: [], remotes: [] });
    const shown = text(hover(content, { line: 4, character: 9 }, { diagnostics: [], entries: model.entries }));
    expect(shown).toContain("`<rule>`");
    expect(shown).toContain("- files `web/src/**`");
    expect(shown).toContain("- files `web/**`, ignoring `web/gen/**`");
  });
});
