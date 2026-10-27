import { describe, expect, test } from "bun:test";
import { readBlock } from "../src/yaml";

// Blocks here open on file line 1, so body line k (0-based) is file line k + 2.
function read(body: string): ReturnType<typeof readBlock> {
  const lines = body.split("\n");
  return readBlock(lines, 2, lines.length + 2);
}

function value(body: string): unknown {
  const result = read(body);
  expect(result.diagnostic).toBeNull();
  return result.value;
}

function problem(body: string): { name: string; line: number } | null {
  return read(body).diagnostic;
}

describe("values", () => {
  test("JSON and YAML give the same value", () => {
    const json = value('{ "files": ["apps/web/**/*.tsx"], "ignores": ["**/*.test.tsx"] }');
    const yaml = value("files:\n  - apps/web/**/*.tsx\nignores: ['**/*.test.tsx']");
    expect(json).toEqual({ files: ["apps/web/**/*.tsx"], ignores: ["**/*.test.tsx"] });
    expect(yaml).toEqual(json);
  });

  test("a block of blank lines and comments is an empty mapping", () => {
    expect(value("")).toEqual({});
    expect(value("\n\n")).toEqual({});
    expect(value("# owner to be decided\n\n  # later")).toEqual({});
  });

  test("a comment holding a CR, U+2028 or U+2029 still leaves an empty mapping", () => {
    expect(value("# owner\rlater")).toEqual({});
    expect(value("# owner\u2028later\n# x\u2029y")).toEqual({});
    expect(value("# owner\r")).toEqual({});
  });

  test("an explicit null stays null", () => {
    expect(value("~")).toBeNull();
    expect(value("null")).toBeNull();
  });

  test("the core schema reads yes and off as strings and dates as strings", () => {
    expect(value("reviewed: yes\nlegacy: off\nenforced: true\nowner: ~\nsince: 2026\non: 2026-03-01")).toEqual({
      reviewed: "yes", legacy: "off", enforced: true, owner: null, since: 2026, on: "2026-03-01",
    });
  });

  test("a single-quoted backslash is kept", () => {
    expect(value("addedMatches: ['\\d+\\.\\d{2}']")).toEqual({ addedMatches: ["\\d+\\.\\d{2}"] });
  });

  test("a # after a space starts a comment, even inside a plain scalar", () => {
    expect(value("owner: checkout #pricing team\nsource: docs/review.md#todos")).toEqual({
      owner: "checkout", source: "docs/review.md#todos",
    });
  });

  test("unquoted brackets inside a flow sequence nest a sequence", () => {
    expect(value("addedMatches: [[$€£]]")).toEqual({ addedMatches: [["$€£"]] });
  });

  test("a trailing comma in a flow sequence or mapping is accepted", () => {
    expect(value('{ "files": ["apps/web/**/*.tsx",], }')).toEqual({ files: ["apps/web/**/*.tsx"] });
  });

  test("a __proto__ key is an ordinary key", () => {
    const result = value("__proto__: x") as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});

describe("invalid-yaml", () => {
  test("an unquoted glob starting with * is an undefined alias, reported at the alias", () => {
    expect(problem("files: [**/*.ts]")).toEqual({ name: "invalid-yaml", line: 2 });
    expect(problem("files:\n  - src/**\n  - **/*.ts")).toEqual({ name: "invalid-yaml", line: 4 });
  });

  test('"\\d" in double quotes is a bad escape', () => {
    expect(problem('addedMatches: ["\\d+\\.\\d{2}"]')).toEqual({ name: "invalid-yaml", line: 2 });
  });

  test("[[A-Z]+_PRICE] is invalid", () => {
    expect(problem("addedMatches: [[A-Z]+_PRICE]")).toEqual({ name: "invalid-yaml", line: 2 });
  });

  test("a // comment is text, reported where it stands", () => {
    expect(problem('{\n  "files": ["apps/web/**/*.tsx"] // web only\n}')).toEqual({ name: "invalid-yaml", line: 3 });
  });

  test("a block that ends before its document is complete is reported at the closing tag line", () => {
    expect(readBlock(['files: ["**/*.tsx"'], 3, 4).diagnostic).toEqual({ name: "invalid-yaml", line: 4 });
    expect(readBlock(['files: "abc', ""], 3, 9).diagnostic).toEqual({ name: "invalid-yaml", line: 9 });
    expect(readBlock(["{ a: 1", "# trailing"], 3, 7).diagnostic).toEqual({ name: "invalid-yaml", line: 7 });
  });

  test("a multi-line implicit key is reported where the document breaks, not at the key", () => {
    expect(problem("owner: checkout\n  team: pricing")).toEqual({ name: "invalid-yaml", line: 3 });
    expect(problem("a: 1\n b: 2\nc: 3")).toEqual({ name: "invalid-yaml", line: 3 });
  });

  test("a second document is invalid at its start", () => {
    expect(problem("a: 1\n---\nb: 2")).toEqual({ name: "invalid-yaml", line: 3 });
  });

  test("invalid-yaml wins over an earlier duplicate key or feature", () => {
    expect(problem("a: &x 1\na: 2\nb: [**/*.ts]")).toEqual({ name: "invalid-yaml", line: 4 });
  });
});

describe("yaml-feature-not-allowed", () => {
  test("every tag, standard or custom", () => {
    expect(problem("a: 1\nb: !!str 2")).toEqual({ name: "yaml-feature-not-allowed", line: 3 });
    expect(problem("a: !money 1")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
    expect(problem("a: ! x")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
    expect(problem("a: 1\nb: !!timestamp x")).toEqual({ name: "yaml-feature-not-allowed", line: 3 });
    expect(problem("a: !e!foo x")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
    expect(problem("a:\n  - [x, !!str y]")).toEqual({ name: "yaml-feature-not-allowed", line: 3 });
  });

  test("an anchor, even one no alias uses, at the anchor", () => {
    expect(problem("addedContains: &codes [\"'USD'\"]")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
    expect(problem("a: &x 1\nb: *x")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
  });

  test("a directive", () => {
    expect(problem("%YAML 1.2\n---\na: 1")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
  });

  test("a key that is not a string", () => {
    expect(problem("a: 1\n2026: reviewed")).toEqual({ name: "yaml-feature-not-allowed", line: 3 });
    expect(problem("~: x")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
    expect(problem("true: x")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
    expect(problem("a: 1\n? [b]\n: c")).toEqual({ name: "yaml-feature-not-allowed", line: 3 });
    expect(problem("a: { 1: b }")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
  });

  test(".inf, -.inf and .nan", () => {
    expect(problem("a: .inf")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
    expect(problem("a: [1, -.Inf]")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
    expect(problem("a: 1\nb:\n  c: .NaN")).toEqual({ name: "yaml-feature-not-allowed", line: 4 });
  });
});

describe("duplicate-key", () => {
  test("at the second occurrence, in JSON and YAML", () => {
    expect(problem('{ "files": ["**/*.tsx"], "files": ["**/*.ts"] }')).toEqual({ name: "duplicate-key", line: 2 });
    expect(problem('files: ["**/*.tsx"]\nfiles: ["**/*.ts"]')).toEqual({ name: "duplicate-key", line: 3 });
  });

  test("keys are compared after quoting is resolved", () => {
    expect(problem('files: []\nignores: []\n"files": []')).toEqual({ name: "duplicate-key", line: 4 });
  });

  test("in a nested mapping", () => {
    expect(problem("links:\n  a: x\n  b: y\n  'a': z")).toEqual({ name: "duplicate-key", line: 5 });
  });

  test("the earlier of a duplicate key and a feature wins", () => {
    expect(problem("a: 1\na: 2\nb: !!str 3")).toEqual({ name: "duplicate-key", line: 3 });
    expect(problem("a: !!str 1\nb: 2\nb: 3")).toEqual({ name: "yaml-feature-not-allowed", line: 2 });
  });
});
