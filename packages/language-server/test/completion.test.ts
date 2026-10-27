import { describe, expect, test } from "bun:test";
import type { CompletionItem, TextEdit } from "vscode-languageserver/node";
import { complete, factsFor, type CompletionFacts } from "../src/completion";
import { diagnose } from "../src/diagnostics";

const NO_FACTS: CompletionFacts = { categories: ["functional_correctness", "security"], ids: [] };

function labels(items: CompletionItem[]): string[] {
  return items.map((item) => item.label);
}

// The cursor is where `|` stands in the text.
function at(marked: string, kind: "lore" | "config", facts = NO_FACTS): CompletionItem[] {
  const offset = marked.indexOf("|");
  const before = marked.slice(0, offset).split("\n");
  return complete(marked.replace("|", ""), { line: before.length - 1, character: before.at(-1)!.length }, kind, facts);
}

describe("completion", () => {
  test("completes custom categories from .loreconfig", () => {
    const text = "<rule id=\"a\" category=\"da\">\nText.\n</rule>\n";
    const input = {
      repo: [
        { path: ".loreconfig", content: "lore: 1\ncategories: [data_provenance]\n" },
        { path: ".lore/a.lore", content: text },
      ],
      given: [],
      remotes: [],
    };
    const facts = factsFor(diagnose(input), ".lore/a.lore");
    const items = complete(text, { line: 0, character: 25 }, "lore", facts);
    expect(labels(items)).toContain("data_provenance");
    expect(labels(items)).toContain("functional_correctness");
    const edit = items.find((item) => item.label === "data_provenance")!.textEdit as TextEdit;
    expect(edit).toEqual({ range: { start: { line: 0, character: 23 }, end: { line: 0, character: 25 } }, newText: "data_provenance" });
  });

  test("completes known ids in a disable list", () => {
    const rules = "<rule id=\"price-from-quote\">\nText.\n</rule>\n\n<context id=\"checkout-notes\">\nText.\n</context>\n";
    const input = { repo: [{ path: ".lore/a.lore", content: rules }], given: [], remotes: [] };
    const facts = factsFor(diagnose(input), "web/.loreconfig");
    expect(facts.ids).toEqual(["checkout-notes", "price-from-quote"]);
    expect(labels(at("lore: 1\ndisable:\n  - |\n", "config", facts))).toEqual(["checkout-notes", "price-from-quote"]);
    expect(labels(at("lore: 1\ndisable:\n- pr|\n", "config", facts))).toEqual(["checkout-notes", "price-from-quote"]);
    expect(labels(at("lore: 1\ndisable: [price-from-quote, |]\n", "config", facts))).toEqual(["checkout-notes", "price-from-quote"]);
    expect(at("lore: 1\ncategories:\n  - |\n", "config", facts)).toEqual([]);
  });

  test("a file the collection leaves out gets the fixed categories", () => {
    const facts = factsFor(diagnose({ repo: [], given: [], remotes: [] }), "notes/loose.lore");
    expect(facts.categories).toContain("code_style");
    expect(facts.categories).not.toContain("data_provenance");
  });

  test("tags at column 0 and inside entries", () => {
    expect(labels(at("<|", "lore"))).toEqual(["rule", "context", "defaults", "scope"]);
    expect(labels(at("<rule id=\"a\">\n  <|\n</rule>\n", "lore"))).toEqual(["meta", "scope", "when", "check"]);
    expect(labels(at("<context id=\"a\">\n<w|\n</context>\n", "lore"))).toEqual(["meta", "scope", "when"]);
    expect(at("<rule id=\"a\">\nText.\n</rule>\n  <|", "lore")).toEqual([]);
  });

  test("no child tags once the prose has started", () => {
    expect(at("<rule id=\"a\">\nSome prose.\n<|", "lore")).toEqual([]);
    expect(at("<rule id=\"a\">\nSome prose.\n  <|\n</rule>\n", "lore")).toEqual([]);
    expect(labels(at("<rule id=\"a\">\n\n<|\nSome prose.\n</rule>\n", "lore"))).toEqual(["meta", "scope", "when", "check"]);
  });

  test("a tag-shaped block after the prose starts is prose, so its keys get no completion", () => {
    const shape = "<rule id=\"currency-from-settings\" category=\"functional_correctness\">\n"
      + "Display text never hard-codes a currency code.\n<when>\n|\n</when>\n</rule>\n";
    expect(at(shape, "lore")).toEqual([]);
  });

  test("a fenced closing tag in prose does not end the entry", () => {
    const fenced = "<rule id=\"a\">\nShown like this:\n\n```lore\n<rule id=\"b\">\nText.\n</rule>\n```\n<|\n</rule>\n";
    expect(at(fenced, "lore")).toEqual([]);
    expect(labels(at(`${fenced.replace("<|", "More.")}\n<|`, "lore"))).toEqual(["rule", "context", "defaults", "scope"]);
  });

  test("comments and closed elements above are read in order", () => {
    expect(labels(at("<!-- note\n<rule id=\"x\">\n-->\n<|", "lore"))).toEqual(["rule", "context", "defaults", "scope"]);
    expect(at("<!-- note\n<|", "lore")).toEqual([]);
    expect(labels(at("<defaults>\nseverity: blocking\n</defaults>\n\n<rule id=\"a\">\n<|", "lore"))).toEqual(["meta", "scope", "when", "check"]);
  });

  test("a child the entry already has is not offered again", () => {
    const text = "<rule id=\"a\">\n<meta>\nowner: pricing\n</meta>\n<|\n<when>\nchanged: [\"x\"]\n</when>\n<check>\nx\n</check>\nText.\n</rule>\n";
    expect(labels(at(text, "lore"))).toEqual(["scope", "check"]);
  });

  test("attribute names per element, leaving out those already written", () => {
    expect(labels(at("<rule id=\"a\" |", "lore"))).toEqual(["category", "severity", "disabled"]);
    expect(labels(at("<context id=\"a\" |>", "lore"))).toEqual(["src", "disabled"]);
    expect(labels(at("<rule id=\"a\">\n  <check |\n", "lore"))).toEqual(["lang"]);
  });

  test("severity values, check languages and when keys", () => {
    expect(labels(at("<rule id=\"a\" severity=\"|\">", "lore"))).toEqual(["blocking", "advisory"]);
    expect(labels(at("<defaults>\nseverity: |\n</defaults>\n", "lore"))).toEqual(["blocking", "advisory"]);
    expect(labels(at("<defaults>\ncategory: |\n</defaults>\n", "lore"))).toEqual(["functional_correctness", "security"]);
    expect(labels(at("<rule id=\"a\">\n<check lang=\"|\">\n", "lore"))).toEqual(["regex", "ast-grep"]);
    expect(labels(at("<rule id=\"a\">\n  <when>\n    |\n  </when>\n</rule>\n", "lore")))
      .toEqual(["addedContains", "addedMatches", "changed", "unchanged"]);
    expect(at("<rule id=\"a\">\n  <scope>\n    |\n  </scope>\n</rule>\n", "lore")).toEqual([]);
  });
});
