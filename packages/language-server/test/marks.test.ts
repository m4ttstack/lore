import { describe, expect, test } from "bun:test";
import { parse } from "@lore/parser";
import { governs, markOver, marksOf, rulesInput } from "../src/marks";

const RULE = "<rule id=\"a\" category=\"functional_correctness\">\nText.\n</rule>\n";

describe("marks", () => {
  test("only a valid .loreconfig with repo outside a Lore folder marks its directory", () => {
    const marks = marksOf([
      { path: "shop/.loreconfig", content: "lore: 1\nrepo: github.com/acme/shop\n" },
      { path: ".loreconfig", content: "lore: 1\nroot: true\n" },
      { path: "x/.lore/.loreconfig", content: "lore: 1\nrepo: github.com/acme/x\n" },
      { path: "bad/.loreconfig", content: "lore: 1\nrepo: 5\n" },
    ]);
    expect(marks).toEqual([{ dir: "shop", repo: "github.com/acme/shop" }]);
    expect(markOver(marks, "shop/.loreconfig")).toEqual(marks[0]);
    expect(markOver(marks, "shop/.lore/a.lore")).toEqual(marks[0]);
    expect(markOver(marks, "shopping/.lore/a.lore")).toBeUndefined();
  });

  test("the rules input collects every marked directory, a repo value with a port included", () => {
    const files = [
      { path: "shop/.loreconfig", content: "lore: 1\nrepo: git.example.com:8443/acme/shop\n" },
      { path: "shop/.lore/a.lore", content: RULE },
      { path: "own/.lore/b.lore", content: "stray\n" },
    ];
    const input = rulesInput("/rules", files, marksOf(files));
    expect(parse(input)).toMatchObject({ errors: [], warnings: [], entries: [{ id: "a", file: "external:shop/.lore/a.lore" }] });
    expect(governs(input, "/rules", marksOf(files)[0]!)).toBe(true);
    expect(governs(input, "/elsewhere", marksOf(files)[0]!)).toBe(false);
  });
});
