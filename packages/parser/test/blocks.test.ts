import { describe, expect, test } from "bun:test";
import { checkDefaults, checkMeta, checkScope, checkWhen } from "../src/blocks";
import { parse } from "../src/model";

const LINE = 7;

describe("checkDefaults", () => {
  test("accepts category and severity, either or both", () => {
    expect(checkDefaults({ category: "functional_correctness", severity: "blocking" }, LINE)).toBeNull();
    expect(checkDefaults({ severity: "advisory" }, LINE)).toBeNull();
    expect(checkDefaults({}, LINE)).toBeNull();
  });

  test("any other shape is invalid-defaults at the given line", () => {
    const invalid = { name: "invalid-defaults", line: LINE };
    expect(checkDefaults(["functional_correctness"], LINE)).toEqual(invalid);
    expect(checkDefaults(null, LINE)).toEqual(invalid);
    expect(checkDefaults("blocking", LINE)).toEqual(invalid);
    expect(checkDefaults({ severity: "critical" }, LINE)).toEqual(invalid);
    expect(checkDefaults({ category: "functional_correctness", owner: "web" }, LINE)).toEqual(invalid);
    expect(checkDefaults({ category: "Functional" }, LINE)).toEqual(invalid);
    expect(checkDefaults({ category: 3 }, LINE)).toEqual(invalid);
  });
});

describe("checkScope", () => {
  test("accepts files and ignores, both optional", () => {
    expect(checkScope({}, LINE)).toBeNull();
    expect(checkScope({ files: ["**/*.tsx"], ignores: [] }, LINE)).toBeNull();
    expect(checkScope({ ignores: ["**/*.test.tsx"] }, LINE)).toBeNull();
  });

  test("a value that is not a mapping of string lists is invalid-scope", () => {
    const invalid = { name: "invalid-scope", line: LINE };
    expect(checkScope(["**"], LINE)).toEqual(invalid);
    expect(checkScope(null, LINE)).toEqual(invalid);
    expect(checkScope({ files: "src/**" }, LINE)).toEqual(invalid);
    expect(checkScope({ files: [["src/**"]] }, LINE)).toEqual(invalid);
    expect(checkScope({ files: ["src/**"], owner: "web" }, LINE)).toEqual(invalid);
  });

  test("invalid-scope comes before empty-files", () => {
    expect(checkScope({ files: [], ignores: [3] }, LINE)).toEqual({ name: "invalid-scope", line: LINE });
  });

  test("an empty files list is empty-files", () => {
    expect(checkScope({ files: [] }, LINE)).toEqual({ name: "empty-files", line: LINE });
  });
});

describe("checkWhen", () => {
  test("accepts the four conditions, empty lists included", () => {
    expect(
      checkWhen({ addedContains: ["'USD'"], addedMatches: ["\\d+"], changed: ["/schema.graphql"], unchanged: [] }, LINE),
    ).toBeNull();
    expect(checkWhen({ addedContains: [] }, LINE)).toBeNull();
  });

  test("a value that is not a mapping is invalid-when", () => {
    expect(checkWhen(["x"], LINE)).toEqual({ name: "invalid-when", line: LINE });
    expect(checkWhen(null, LINE)).toEqual({ name: "invalid-when", line: LINE });
  });

  test("a mapping with no keys is empty-when", () => {
    expect(checkWhen({}, LINE)).toEqual({ name: "empty-when", line: LINE });
  });

  test("an unknown key is unknown-condition, before any value check", () => {
    expect(checkWhen({ addedContain: ["'USD'"] }, LINE)).toEqual({ name: "unknown-condition", line: LINE });
    expect(checkWhen({ addedContains: 3, removedContains: ["x"] }, LINE)).toEqual({
      name: "unknown-condition", line: LINE,
    });
  });

  test("a condition whose value is not a list of strings is invalid-when", () => {
    const invalid = { name: "invalid-when", line: LINE };
    expect(checkWhen({ addedContains: "'USD'" }, LINE)).toEqual(invalid);
    expect(checkWhen({ addedMatches: [["$€£"]] }, LINE)).toEqual(invalid);
    expect(checkWhen({ changed: [1] }, LINE)).toEqual(invalid);
    expect(checkWhen({ unchanged: null }, LINE)).toEqual(invalid);
  });

  test("an addedContains string that is empty or holds a line break is invalid-when", () => {
    const invalid = { name: "invalid-when", line: LINE };
    expect(checkWhen({ addedContains: [""] }, LINE)).toEqual(invalid);
    expect(checkWhen({ addedContains: ["a\nb"] }, LINE)).toEqual(invalid);
    expect(checkWhen({ addedContains: ["a\rb"] }, LINE)).toEqual(invalid);
  });
});

describe("checkMeta", () => {
  test("accepts any mapping", () => {
    expect(checkMeta({}, LINE)).toBeNull();
    expect(checkMeta({ owner: "checkout", links: { decision: "docs/0042.md" } }, LINE)).toBeNull();
  });

  test("anything else is invalid-meta", () => {
    const invalid = { name: "invalid-meta", line: LINE };
    expect(checkMeta("checkout team", LINE)).toEqual(invalid);
    expect(checkMeta(["checkout", "pricing"], LINE)).toEqual(invalid);
    expect(checkMeta(null, LINE)).toEqual(invalid);
  });
});

describe("file blocks in parse", () => {
  const errors = (content: string) =>
    parse({ repo: [{ path: ".lore/checkout.lore", content }], given: [], remotes: [] }).errors.map(
      ({ name, entry, line }) => ({ name, entry, line }),
    );

  test("a YAML problem in a file block is a file-level error at its line", () => {
    expect(errors("<scope>\nfiles: [**/*.tsx]\n</scope>\n\n<rule id=\"a\">\nA.\n</rule>\n")).toEqual([
      { name: "invalid-yaml", entry: null, line: 2 },
    ]);
  });

  test("a shape problem is reported at the block's opening tag line", () => {
    expect(errors("\n<defaults>\nseverity: critical\n</defaults>\n")).toEqual([
      { name: "invalid-defaults", entry: null, line: 2 },
    ]);
    expect(errors("<scope>\nfiles: []\n</scope>\n")).toEqual([{ name: "empty-files", entry: null, line: 1 }]);
  });

  test("inconsistent indentation in a file block is file-level at its opening tag line", () => {
    expect(errors("<scope>\n\tfiles: []\n  ignores: []\n</scope>\n")).toEqual([
      { name: "inconsistent-indentation", entry: null, line: 1 },
    ]);
  });

  test("a block error comes before a later structural error", () => {
    expect(errors("<scope>\nfiles: a\nfiles: b\n</scope>\nstray text\n")).toEqual([
      { name: "duplicate-key", entry: null, line: 3 },
    ]);
  });

  test("an indented block is read after its indentation is removed", () => {
    expect(errors("<scope>\n  files:\n    - src/**\n</scope>\n\n<rule id=\"a\">\nA.\n</rule>\n")).toEqual([]);
  });
});
