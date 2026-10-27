import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExamples } from "../../../tools/check/extract";
import { parse } from "../src/model";
import type { InputFile, LoreInput } from "../src/types";

const examples = extractExamples(readFileSync(new URL("../../../spec/SPEC.md", import.meta.url), "utf8"));

function input(...repo: InputFile[]): LoreInput {
  return { repo, given: [], remotes: [] };
}

const brief = (diagnostics: { name: string; file: string; entry: string | null; line: number }[]) =>
  diagnostics.map(({ name, file, entry, line }) => ({ name, file, entry, line }));

describe("parse", () => {
  const inputs = examples.flatMap((example) =>
    example.files.map((file) => ({
      external: file.external,
      path: file.external ? file.path.slice("external:".length) : file.path,
      content: file.content,
    })),
  );

  function parsesEverywhere(file: InputFile, external: boolean): void {
    const model = parse({ repo: [file], given: [], remotes: [] });
    expect(Array.isArray(model.entries)).toBe(true);
    if (external) parse({ repo: [], given: [{ folder: "", files: [file] }], remotes: [] });
  }

  test("never throws on any prefix of an example input", () => {
    let runs = 0;
    for (const { external, path, content } of inputs) {
      const lines = content.split("\n");
      for (let n = 0; n <= lines.length; n++) {
        parsesEverywhere({ path, content: lines.slice(0, n).join("\n") }, external);
        runs++;
      }
    }
    expect(runs).toBeGreaterThan(1000);
  });

  test("never throws on any character prefix of an example .lore input", () => {
    let runs = 0;
    for (const { external, path, content } of inputs) {
      if (!path.endsWith(".lore")) continue;
      for (let n = 0; n <= content.length; n++) {
        parsesEverywhere({ path, content: content.slice(0, n) }, external);
        runs++;
      }
    }
    expect(runs).toBeGreaterThan(10000);
  });

  test("only .lore files inside a .lore folder are read, and the base is that folder's parent", () => {
    const rule = "<rule id=\"a\" category=\"security\">\nA.\n</rule>\n";
    const result = parse(input(
      { path: "apps/web/rules.lore", content: rule },
      { path: ".lore/README.md", content: rule },
      { path: "apps/web/.lore/sub/web.lore", content: rule.replace("\"a\"", "\"b\"") },
    ));
    expect(result.entries.map((e) => [e.id, e.scopes])).toEqual([["b", [{ files: ["apps/web/**"], ignores: [] }]]]);
  });

  test("a file-level error lists only that error: no entries, entry errors or warnings from the file", () => {
    const content = "<rule id=\"a\">\nA.\n</rule>\n<rule id=\"b\" owner=\"o\">\nB.\n</rule>\n<scope>\nfiles: []\n</scope>\n";
    const result = parse(input({ path: ".lore/a.lore", content }));
    expect(result.entries).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(brief(result.errors)).toEqual([{ name: "file-block-after-entry", file: ".lore/a.lore", entry: null, line: 7 }]);
  });

  test("entries are ordered by file, then position; diagnostics by file, line, name, entry", () => {
    const result = parse(input(
      { path: "b/.lore/x.lore", content: "<rule id=\"z\" category=\"security\">\nZ.\n</rule>\n<rule id=\"y\">\nY.\n</rule>\n" },
      { path: ".lore/x.lore", content: "<rule id=\"w\" owner=\"o\">\nW.\n</rule>\n<rule id=\"v\" category=\"security\">\nV.\n</rule>\n" },
    ));
    expect(result.entries.map((e) => e.id)).toEqual(["v", "z", "y"]);
    expect(brief(result.errors)).toEqual([{ name: "unknown-attribute", file: ".lore/x.lore", entry: "w", line: 1 }]);
    expect(brief(result.warnings)).toEqual([{ name: "missing-category", file: "b/.lore/x.lore", entry: "y", line: 4 }]);
  });
});

describe("duplicate-id", () => {
  const rule = (id: string, extra = "") => `<rule id="${id}" category="security"${extra}>\nA.\n</rule>\n`;

  test("every entry that shares an id and has no other error gets duplicate-id at its opening tag line", () => {
    const result = parse(input(
      { path: ".lore/a.lore", content: rule("x") + rule("y") },
      { path: ".lore/b.lore", content: `${rule("y")}<context id="x">\nC.\n</context>\n${rule("x")}` },
    ));
    expect(result.entries).toEqual([]);
    expect(brief(result.errors)).toEqual([
      { name: "duplicate-id", file: ".lore/a.lore", entry: "x", line: 1 },
      { name: "duplicate-id", file: ".lore/a.lore", entry: "y", line: 4 },
      { name: "duplicate-id", file: ".lore/b.lore", entry: "y", line: 1 },
      { name: "duplicate-id", file: ".lore/b.lore", entry: "x", line: 4 },
      { name: "duplicate-id", file: ".lore/b.lore", entry: "x", line: 7 },
    ]);
  });

  test("an entry with another error counts but keeps its own error; a disabled entry counts", () => {
    const result = parse(input(
      { path: ".lore/a.lore", content: rule("x", " severity=\"high\"") + rule("y", " disabled") },
      { path: ".lore/b.lore", content: rule("x") + rule("y") },
    ));
    expect(result.entries).toEqual([]);
    expect(brief(result.errors)).toEqual([
      { name: "invalid-attribute-value", file: ".lore/a.lore", entry: "x", line: 1 },
      { name: "duplicate-id", file: ".lore/a.lore", entry: "y", line: 4 },
      { name: "duplicate-id", file: ".lore/b.lore", entry: "x", line: 1 },
      { name: "duplicate-id", file: ".lore/b.lore", entry: "y", line: 4 },
    ]);
  });

  test("an entry with no readable id does not count", () => {
    const result = parse(input(
      { path: ".lore/a.lore", content: rule("x") + "<rule id=x>\nA.\n</rule>\n" + "<rule category=z id=\"x\">\nA.\n</rule>\n" },
    ));
    expect(result.entries.map((e) => e.id)).toEqual(["x"]);
  });

  test("entries in a file excluded by a file-level error do not count", () => {
    const result = parse(input(
      { path: ".lore/a.lore", content: rule("x") },
      { path: ".lore/b.lore", content: `${rule("x")}\nstray text\n` },
    ));
    expect(result.entries.map((e) => e.id)).toEqual(["x"]);
    expect(brief(result.errors)).toEqual([{ name: "top-level-text", file: ".lore/b.lore", entry: null, line: 5 }]);
  });

  test("a rule excluded by duplicate-id gets no missing-category warning", () => {
    const bare = "<rule id=\"x\">\nA.\n</rule>\n";
    const result = parse(input({ path: ".lore/a.lore", content: bare + bare }));
    expect(result.warnings).toEqual([]);
  });
});
