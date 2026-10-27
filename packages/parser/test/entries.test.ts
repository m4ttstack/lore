import { describe, expect, test } from "bun:test";
import { parse } from "../src/model";
import type { DocumentModel } from "../src/types";

const PATH = ".lore/checkout.lore";

function model(content: string, path = PATH): DocumentModel {
  return parse({ repo: [{ path, content }], given: [], remotes: [] });
}

function errors(content: string, path = PATH) {
  return model(content, path).errors.map(({ name, entry, line }) => ({ name, entry, line }));
}

function rule(tag: string, body = "A displayed price must come from the quote.") {
  return `${tag}\n${body}\n</rule>\n`;
}

function context(tag: string, body = "Read before changing prices.") {
  return `${tag}\n${body}\n</context>\n`;
}

function only(content: string, path = PATH) {
  const found = errors(content, path);
  expect(found).toHaveLength(1);
  return found[0];
}

describe("attribute check order", () => {
  test("1. a repeated attribute name is duplicate-attribute, met before a later problem", () => {
    expect(only(rule("<rule id=\"a\" category=\"security\" category=\"accessibility\">"))).toEqual({
      name: "duplicate-attribute", entry: "a", line: 1,
    });
    expect(only(rule("<rule id=\"a\" id=\"b\" owner=\"web\">"))).toEqual({ name: "duplicate-attribute", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" disabled disabled>"))).toEqual({ name: "duplicate-attribute", entry: "a", line: 1 });
  });

  test("2. an attribute the element does not define is unknown-attribute", () => {
    expect(only(rule("<rule id=\"a\" src=\"README.md\">"))).toEqual({ name: "unknown-attribute", entry: "a", line: 1 });
    expect(only(context("<context id=\"a\" category=\"documentation\">"))).toEqual({ name: "unknown-attribute", entry: "a", line: 1 });
    expect(only(context("<context id=\"a\" severity=\"blocking\">"))).toEqual({ name: "unknown-attribute", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" owner=\"web\" severity=\"high\">"))).toEqual({ name: "unknown-attribute", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" constructor=\"x\">"))).toEqual({ name: "unknown-attribute", entry: "a", line: 1 });
  });

  test("3. a value the attribute does not allow is met in reading order, with its specific name", () => {
    expect(only(rule("<rule id=\"a\" severity=\"high\" owner=\"web\">"))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 1 });
    expect(only(rule("<rule id category=\"security\">"))).toEqual({ name: "invalid-attribute-value", entry: null, line: 1 });
    expect(only(rule("<rule id=\"priceFromQuote\">"))).toEqual({ name: "invalid-id", entry: null, line: 1 });
    expect(only(rule("<rule id=\"\">"))).toEqual({ name: "invalid-id", entry: null, line: 1 });
    expect(only(rule("<rule id=\"a\" category=\"data_lineage\">"))).toEqual({ name: "unknown-category", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" category=\"Security\">"))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" category>"))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" category=\"security\" severity>"))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" category=\"security\" disabled=\"\">"))).toEqual({ name: "disabled-has-value", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" category=\"security\" disabled=\"false\">"))).toEqual({ name: "disabled-has-value", entry: "a", line: 1 });
  });

  test("4. a tag that ends with no id is missing-id, after every other attribute problem", () => {
    expect(only(rule("<rule category=\"security\">"))).toEqual({ name: "missing-id", entry: null, line: 1 });
    expect(only(rule("<rule>"))).toEqual({ name: "missing-id", entry: null, line: 1 });
    expect(only(rule("<rule category=\"Security\">"))).toEqual({ name: "invalid-attribute-value", entry: null, line: 1 });
    expect(only(rule("<rule owner=\"pricing\">"))).toEqual({ name: "unknown-attribute", entry: null, line: 1 });
  });

  test("a malformed attribute list is met at the character where it stops being valid", () => {
    expect(only(rule("<rule id=\"a\" owner=\"y\" category=z>"))).toEqual({ name: "unknown-attribute", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" category=z owner=\"y\">"))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 1 });
    expect(only(rule("<rule category=z id=\"a\">"))).toEqual({ name: "invalid-attribute-value", entry: null, line: 1 });
    expect(only(rule("<rule id=a>"))).toEqual({ name: "invalid-attribute-value", entry: null, line: 1 });
    expect(only(rule("<rule id=\"a\"category=\"security\">"))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 1 });
  });

  test("an attribute with a malformed value is the malformation, whatever its name", () => {
    expect(only(rule("<rule id=\"a\" owner=z>"))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" id=z>"))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" category=\"security>"))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 1 });
  });

  test("the readable id is the first id attribute's value, read anywhere on a well-formed tag", () => {
    expect(only(rule("<rule owner=\"web\" id=\"a\">"))).toEqual({ name: "unknown-attribute", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"a\" id=\"Bad\">"))).toEqual({ name: "duplicate-attribute", entry: "a", line: 1 });
    expect(only(rule("<rule id=\"Bad\" id=\"a\">"))).toEqual({ name: "invalid-id", entry: null, line: 1 });
  });
});

describe("rules", () => {
  test("disabled is kept on the entry", () => {
    const { entries } = model(rule("<rule id=\"a\" category=\"security\" disabled>"));
    expect(entries.map((e) => e.disabled)).toEqual([true]);
  });

  test("category and severity come from the attribute, then <defaults>, then null and advisory", () => {
    const file = [
      "<defaults>\ncategory: security\nseverity: blocking\n</defaults>\n",
      rule("<rule id=\"a\">"),
      rule("<rule id=\"b\" category=\"performance\" severity=\"advisory\">"),
      context("<context id=\"c\">"),
    ].join("\n");
    const { entries } = model(file);
    expect(entries.map(({ id, category, severity }) => ({ id, category, severity }))).toEqual([
      { id: "a", category: "security", severity: "blocking" },
      { id: "b", category: "performance", severity: "advisory" },
      { id: "c", category: null, severity: null },
    ]);
  });

  test("a rule with no category anywhere gets missing-category; a context never does", () => {
    const result = model([rule("<rule id=\"a\" severity=\"blocking\">"), context("<context id=\"b\">")].join("\n"));
    expect(result.entries.map((e) => [e.id, e.category, e.severity])).toEqual([["a", null, "blocking"], ["b", null, null]]);
    expect(result.warnings.map(({ name, entry, line }) => ({ name, entry, line }))).toEqual([
      { name: "missing-category", entry: "a", line: 1 },
    ]);
  });

  test("a rule excluded by an error gets no missing-category warning", () => {
    expect(model(rule("<rule id=\"a\" severity=\"high\">")).warnings).toEqual([]);
  });
});

describe("<defaults>", () => {
  test("an unknown category in <defaults> is file-level, after invalid-defaults", () => {
    const file = `<defaults>\ncategory: data_lineage\n</defaults>\n\n${rule("<rule id=\"a\" category=\"security\">")}`;
    expect(model(file).entries).toEqual([]);
    expect(errors(file)).toEqual([{ name: "unknown-category", entry: null, line: 1 }]);
    expect(errors("<defaults>\ncategory: data_lineage\nowner: web\n</defaults>\n")).toEqual([
      { name: "invalid-defaults", entry: null, line: 1 },
    ]);
  });

  test("a <defaults> error comes before a later file block's error", () => {
    const file = "<defaults>\ncategory: data_lineage\n</defaults>\n<scope>\nfiles: []\n</scope>\n";
    expect(errors(file)).toEqual([{ name: "unknown-category", entry: null, line: 1 }]);
  });
});

describe("children", () => {
  test("a child's name is checked first, then whether it repeats, then its attributes, indentation and contents", () => {
    expect(only(rule("<rule id=\"a\" category=\"security\">\n<example owner=\"x\">\n\tx\n  y\n</example>"))).toEqual({
      name: "unknown-child", entry: "a", line: 2,
    });
    expect(only(context("<context id=\"a\">\n<check>\nx\n</check>"))).toEqual({ name: "unknown-child", entry: "a", line: 2 });
    expect(only(rule("<rule id=\"a\" category=\"security\">\n<meta>\nowner: web\n</meta>\n<meta owner=\"x\">\n- a\n</meta>"))).toEqual({
      name: "duplicate-child", entry: "a", line: 5,
    });
    expect(only(rule("<rule id=\"a\" category=\"security\">\n<when owner=\"x\">\n\tx\n  y\n</when>"))).toEqual({
      name: "unknown-attribute", entry: "a", line: 2,
    });
    expect(only(rule("<rule id=\"a\" category=\"security\">\n<when>\n\tx: [\n  y\n</when>"))).toEqual({
      name: "inconsistent-indentation", entry: "a", line: 2,
    });
    expect(only(rule("<rule id=\"a\" category=\"security\">\n<when>\naddedContains: [\n</when>"))).toEqual({
      name: "invalid-yaml", entry: "a", line: 4,
    });
  });

  test("the entry's own indentation is checked before its children", () => {
    expect(only(rule("<rule id=\"a\" category=\"security\">\n\t<example>\n  </example>", "  Prose."))).toEqual({
      name: "inconsistent-indentation", entry: "a", line: 1,
    });
  });

  test("children are checked in order and the first problem wins", () => {
    const tag = "<rule id=\"a\" category=\"security\">";
    expect(only(rule(`${tag}\n<meta>\n- a\n</meta>\n<when>\n{}\n</when>`))).toEqual({ name: "invalid-meta", entry: "a", line: 2 });
    expect(only(rule(`${tag}\n<when>\n{}\n</when>\n<meta>\n- a\n</meta>`))).toEqual({ name: "empty-when", entry: "a", line: 2 });
    expect(only(rule(`${tag}\n<scope>\nfiles: []\n</scope>`))).toEqual({ name: "empty-files", entry: "a", line: 2 });
  });

  test("a malformed child tag names the entry", () => {
    expect(only(rule("<rule id=\"a\" category=\"security\">\n<check lang=regex>\nx\n</check>"))).toEqual({
      name: "invalid-attribute-value", entry: "a", line: 2,
    });
  });

  test("children values land in the model; a child <scope> resolves from the base", () => {
    const content = [
      "<scope>\nfiles: [\"**/*.tsx\"]\nignores: [\"**/*.test.tsx\"]\n</scope>\n",
      "<rule id=\"a\" category=\"security\">",
      "<meta>\nowner: web\n</meta>",
      "<scope>\nfiles: [\"cart/**\"]\n</scope>",
      "<when>\naddedContains: [\"'USD'\"]\n</when>",
      "<check>\n'USD'\n</check>",
      "<check lang=\"ast-grep\">\n$A.reduce(\n  $$$\n)\n</check>",
      "Totals come from the quote.\n</rule>\n",
    ].join("\n");
    const [entry] = model(content, "apps/web/.lore/web.lore").entries;
    expect(entry).toMatchObject({
      meta: { owner: "web" },
      scopes: [
        { files: ["apps/web/**/*.tsx"], ignores: ["apps/web/**/*.test.tsx"] },
        { files: ["apps/web/cart/**"], ignores: [] },
      ],
      when: { addedContains: ["'USD'"] },
      checks: [{ lang: "regex", body: "'USD'" }, { lang: "ast-grep", body: "$A.reduce(\n  $$$\n)" }],
    });
  });
});

describe("<check>", () => {
  const tag = "<rule id=\"a\" category=\"security\">";

  test("lang written bare or empty is invalid-attribute-value; any other attribute is unknown-attribute", () => {
    expect(only(rule(`${tag}\n<check lang>\nx\n</check>`))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 2 });
    expect(only(rule(`${tag}\n<check lang="">\nx\n</check>`))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 2 });
    expect(only(rule(`${tag}\n<check name="x">\nx\n</check>`))).toEqual({ name: "unknown-attribute", entry: "a", line: 2 });
    expect(only(rule(`${tag}\n<check lang="regex" lang="regex">\nx\n</check>`))).toEqual({ name: "duplicate-attribute", entry: "a", line: 2 });
  });

  test("a regex body of two or more lines is regex-not-one-line; other languages are not checked", () => {
    expect(only(rule(`${tag}\n<check>\n'USD'\n|'EUR'\n</check>`))).toEqual({ name: "regex-not-one-line", entry: "a", line: 2 });
    expect(only(rule(`${tag}\n<check lang="regex">\n'USD'\n\n</check>`))).toEqual({ name: "regex-not-one-line", entry: "a", line: 2 });
    const { entries } = model(rule(`${tag}\n<check lang="structural">\na\n\nb  \n</check>`));
    expect(entries[0]?.checks).toEqual([{ lang: "structural", body: "a\n\nb  " }]);
  });

  test("the body has the entry's and then the check's indentation removed", () => {
    const { entries } = model(rule(`${tag}\n  <check lang="ast-grep">\n      $A(\n        $$$\n      )\n  </check>`, "  Prose."));
    expect(entries[0]?.checks).toEqual([{ lang: "ast-grep", body: "$A(\n  $$$\n)" }]);
  });
});

describe("context src", () => {
  const PATH_IN = "apps/web/src/checkout/.lore/context.lore";
  const src = (value: string, path = PATH_IN) => {
    const result = model(context(`<context id="a" src="${value}">`), path);
    return result.entries[0]?.src ?? result.errors.map((e) => e.name).join();
  };

  test("a plain src resolves from the base; a file-relative one from the Lore file's directory", () => {
    expect(src("ARCHITECTURE.md")).toBe("apps/web/src/checkout/ARCHITECTURE.md");
    expect(src("docs/a.md")).toBe("apps/web/src/checkout/docs/a.md");
    expect(src("./glossary.md")).toBe("apps/web/src/checkout/.lore/glossary.md");
    expect(src("../ARCHITECTURE.md")).toBe("apps/web/src/checkout/ARCHITECTURE.md");
    expect(src(".././../x.md")).toBe("apps/web/src/x.md");
    expect(src("ARCHITECTURE.md", ".lore/context.lore")).toBe("ARCHITECTURE.md");
    expect(src("./../README.md", ".lore/context.lore")).toBe("README.md");
    expect(src("../README.md", ".lore/sub/context.lore")).toBe(".lore/README.md");
  });

  test("a src that is not a relative file path is invalid-attribute-value", () => {
    for (const value of ["", "/README.md", "docs/", "docs//a.md", "docs/../a.md", "docs/./a.md", "./..", ".", "..", "./"]) {
      expect(src(value)).toBe("invalid-attribute-value");
    }
    expect(only(context("<context id=\"a\" src>"))).toEqual({ name: "invalid-attribute-value", entry: "a", line: 1 });
  });

  test("a .. that moves up from the Lore root is src-escapes-root", () => {
    expect(src("./../../README.md", ".lore/context.lore")).toBe("src-escapes-root");
    expect(src("../../../../../../x.md")).toBe("src-escapes-root");
    expect(src("../../../../../x.md")).toBe("x.md");
  });

  test("a rule has a null src and a context with no src has null", () => {
    expect(model(context("<context id=\"a\">")).entries[0]?.src).toBeNull();
    expect(model(rule("<rule id=\"a\" category=\"security\">")).entries[0]?.src).toBeNull();
  });
});
