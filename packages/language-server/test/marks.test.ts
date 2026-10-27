import { describe, expect, test } from "bun:test";
import { parse } from "@lore/parser";
import { governs, markOver, marksOf, repoKey, rulesInput } from "../src/marks";

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

  test("an invalid-loreconfig marks nothing, even with a valid repo", () => {
    const files = [{ path: "shop/.loreconfig", content: "lore: 1\nrepo: github.com/acme/shop\nbogus: true\n" }];
    expect(marksOf(files)).toEqual([]);
    expect(parse({ repo: [], given: [{ folder: "", files }], remotes: ["https://github.com/acme/shop"] }).errors
      .map((d) => d.name)).toEqual(["invalid-loreconfig"]);
  });

  test("the deepest mark over a path is the one that holds it", () => {
    const marks = [{ dir: "a", repo: "github.com/acme/a" }, { dir: "a/b", repo: "github.com/acme/b" }];
    expect(markOver(marks, "a/b/.lore/x.lore")).toEqual(marks[1]);
    expect(markOver(marks, "a/.lore/x.lore")).toEqual(marks[0]);
  });

  test("the rules input collects the mark's repository only, a repo value with a port included", () => {
    const files = [
      { path: "shop/.loreconfig", content: "lore: 1\nrepo: git.example.com:8443/acme/shop\n" },
      { path: "shop/.lore/a.lore", content: RULE },
      { path: "pay/.loreconfig", content: "lore: 1\nrepo: git.example.com/acme/payments\n" },
      { path: "pay/.lore/a.lore", content: RULE },
      { path: "own/.lore/b.lore", content: "stray\n" },
    ];
    const [shop, pay] = marksOf(files) as [{ dir: string; repo: string }, { dir: string; repo: string }];
    const input = rulesInput("/rules", files, shop);
    expect(parse(input)).toMatchObject({ errors: [], warnings: [], entries: [{ id: "a", file: "external:shop/.lore/a.lore" }] });
    expect(parse(rulesInput("/rules", files, pay)).entries.map((e) => e.file)).toEqual(["external:pay/.lore/a.lore"]);
    expect(governs(input, "/rules", shop)).toBe(true);
    expect(governs(input, "/rules", pay)).toBe(false);
    expect(governs(input, "/elsewhere", shop)).toBe(false);
    expect(repoKey("GitHub.com/Acme/Shop")).toBe(repoKey("github.com/acme/shop"));
  });

  test("repository keys follow the parser's remote normalization", () => {
    expect(repoKey("git.example.com:8443/Acme/Shop")).toBe(repoKey("git.example.com:8443/acme/shop"));
    expect(repoKey("github.com/Acme/Web/Shop")).toBe(repoKey("github.com/acme/web/shop"));
    expect(repoKey("github.com/acme/shop")).not.toBe(repoKey("github.com/acme/payments"));
  });
});
