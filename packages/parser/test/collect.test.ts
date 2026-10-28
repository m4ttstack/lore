import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExamples } from "../../../tools/check/extract";
import { collect, disabledFor } from "../src/collect";
import { FIXED_CATEGORIES } from "../src/blocks";
import { parse, parseWithContext } from "../src/model";
import type { InputFile, LoreInput } from "../src/types";
import { toInput } from "./harness";

const examples = extractExamples(readFileSync(new URL("../../../spec/SPEC.md", import.meta.url), "utf8"));
const SELECTION_WARNINGS = new Set(["missing-src-target", "unsupported-check-language", "ast-grep-no-language"]);
const REMOTE = "https://github.com/acme/shop";
const RULE = '<rule id="price-from-quote" category="functional_correctness">\nA price comes from its quote.\n</rule>\n';

const brief = (diagnostics: { name: string; file: string; entry: string | null; line: number }[]) =>
  diagnostics.map(({ name, file, entry, line }) => ({ name, file, entry, line }));

function example(number: number) {
  const found = examples.find((e) => e.number === number);
  if (found === undefined) throw new Error(`no example ${number}`);
  return found;
}

describe("collect", () => {
  test("a .lore file outside a Lore folder is not collected", () => {
    const collected = collect({
      repo: [
        { path: ".lore/checkout.lore", content: RULE },
        { path: "apps/web/src/checkout/rules.lore", content: RULE },
        { path: ".lore/README.md", content: RULE },
      ],
      given: [],
      remotes: [REMOTE],
    });
    expect(collected.files.map((f) => f.file)).toEqual([".lore/checkout.lore"]);
  });

  test("a file reached through two given folders is collected once", () => {
    const files: InputFile[] = [
      { path: "lore/shop/.loreconfig", content: "repo: github.com/acme/shop\n" },
      { path: "lore/shop/.lore/checkout.lore", content: RULE },
    ];
    const input: LoreInput = {
      repo: [],
      given: [{ folder: "lore", files }, { folder: "lore/shop", files: files.map((f) => ({ ...f })) }],
      remotes: [REMOTE],
    };
    expect(collect(input).files.map((f) => f.file)).toEqual(["external:lore/shop/.lore/checkout.lore"]);
    expect(parse(input).errors).toEqual([]);
    expect(parse(input).entries.map((e) => e.id)).toEqual(["price-from-quote"]);
  });

  test("given folders of different repositories are read separately", () => {
    const input: LoreInput = {
      repo: [],
      given: [
        { folder: "", files: [{ path: ".loreconfig", content: "repo: github.com/acme/shop\n" }, { path: ".lore/a.lore", content: RULE }] },
        { folder: "", files: [{ path: ".loreconfig", content: "repo: github.com/acme/shop\n" }, { path: ".lore/a.lore", content: RULE.replace("price", "cost") }] },
      ],
      remotes: [REMOTE],
    };
    expect(collect(input).files.map((f) => [f.file, f.tree])).toEqual([
      ["external:.lore/a.lore", 0],
      ["external:.lore/a.lore", 1],
    ]);
  });

  test("given folders with the same repository key are one repository, whatever their file lists hold", () => {
    const files: InputFile[] = [
      { path: "lore/shop/.loreconfig", content: "repo: github.com/acme/shop\n" },
      { path: "lore/shop/.lore/checkout.lore", content: RULE },
      { path: "lore/notes.md", content: "one" },
    ];
    const edited = files.map((f) => (f.path === "lore/notes.md" ? { ...f, content: "two" } : f));
    const input: LoreInput = {
      repo: [],
      given: [{ folder: "lore", files, repository: "/work/team" }, { folder: "lore/shop", files: edited, repository: "/work/team" }],
      remotes: [REMOTE],
    };
    expect(collect(input).files.map((f) => f.file)).toEqual(["external:lore/shop/.lore/checkout.lore"]);
    expect(parse(input).errors).toEqual([]);
  });

  test("given folders with different repository keys are two repositories, even with identical files", () => {
    const files: InputFile[] = [
      { path: ".loreconfig", content: "repo: github.com/acme/shop\n" },
      { path: ".lore/a.lore", content: RULE },
    ];
    const input: LoreInput = {
      repo: [],
      given: [{ folder: "", files, repository: "/work/a" }, { folder: "", files, repository: "/work/b" }],
      remotes: [REMOTE],
    };
    expect(collect(input).files.map((f) => [f.file, f.tree])).toEqual([
      ["external:.lore/a.lore", 0],
      ["external:.lore/a.lore", 1],
    ]);
    expect(brief(parse(input).errors).map((d) => d.name)).toEqual(["duplicate-id", "duplicate-id"]);
  });

  test("each repository of the given folders names the given folder that opened it", () => {
    const files: InputFile[] = [{ path: ".loreconfig", content: "repo: github.com/acme/shop\n" }];
    const input: LoreInput = {
      repo: [],
      given: [
        { folder: "", files, repository: "/work/a" },
        { folder: "", files, loose: true },
        { folder: "lore", files, repository: "/work/a" },
        { folder: "", files, repository: "/work/b" },
      ],
      remotes: [REMOTE],
    };
    expect(collect(input).repositoryGiven).toEqual([0, 1, 3]);
  });

  test("an external file's base is the directory it stands for, its Lore root is in its own repository", () => {
    const collected = collect(toInput(example(93)));
    expect(collected.files).toEqual([
      expect.objectContaining({
        file: "external:lore/shop/apps/web/.lore/web.lore", base: "apps/web", loreRoot: "lore", tree: 0,
        categories: [...FIXED_CATEGORIES],
      }),
    ]);
  });

  test("categories add down the tree and never come from beside or below", () => {
    const collected = collect(toInput(example(88)));
    const categories = Object.fromEntries(collected.files.map((f) => [f.file, f.categories.filter((c) => !FIXED_CATEGORIES.has(c))]));
    expect(categories).toEqual({
      ".lore/shop.lore": ["data_provenance"],
      "apps/api/.lore/api.lore": ["data_provenance"],
      "apps/web/.lore/web.lore": ["data_provenance", "web_vitals"],
    });
  });

  test("a root: true stops the lookup", () => {
    const collected = collect(toInput(example(87)));
    expect(collected.files.map((f) => [f.file, f.loreRoot])).toEqual([
      [".lore/shop.lore", ""],
      ["apps/web/.lore/web.lore", "apps/web"],
    ]);
  });

  test("a given folder below its repository's root reads the .loreconfig files above it", () => {
    const input: LoreInput = {
      repo: [],
      given: [{
        folder: "team/lore",
        files: [
          { path: ".loreconfig", content: "root: true\ncategories: [data_provenance]\n" },
          { path: "team/lore/shop/.loreconfig", content: "repo: github.com/acme/shop\n" },
          { path: "team/lore/shop/.lore/a.lore", content: RULE },
          { path: "other/.loreconfig", content: "root: yes\n" },
        ],
      }],
      remotes: [REMOTE],
    };
    const collected = collect(input);
    expect(collected.diagnostics).toEqual([]);
    expect(collected.files).toEqual([
      expect.objectContaining({ file: "external:team/lore/shop/.lore/a.lore", base: "", loreRoot: "" }),
    ]);
    expect(collected.files[0]!.categories).toContain("data_provenance");
  });

  test("a directory marked only above the given folder is not an external folder", () => {
    const input: LoreInput = {
      repo: [],
      given: [{
        folder: "shop/apps",
        files: [
          { path: "shop/.loreconfig", content: "repo: github.com/acme/shop\n" },
          { path: "shop/apps/.lore/a.lore", content: RULE },
        ],
      }],
      remotes: [REMOTE],
    };
    expect(collect(input).files).toEqual([]);
  });
});

describe("the document model of every eligibility example", () => {
  for (const ex of examples.filter((e) => e.kind === "eligibility")) {
    test(`example ${ex.number} (${ex.section}): errors are its excluded, warnings its parse-time warnings`, () => {
      const expected = JSON.parse(ex.expect ?? "null");
      const model = parse(toInput(ex));
      expect(brief(model.errors)).toEqual(expected.excluded);
      expect(brief(model.warnings)).toEqual(expected.warnings.filter((w: { name: string }) => !SELECTION_WARNINGS.has(w.name)));
    });
  }
});

describe("disabledFor", () => {
  test("a governed disable list switches an entry off below its directory only", () => {
    const collected = collect(toInput(example(89)));
    expect(disabledFor(collected, "currency-from-settings", "apps/web/src/legacy/Price.tsx", "repo")).toBe(true);
    expect(disabledFor(collected, "currency-from-settings", "apps/web/src/checkout/Total.tsx", "repo")).toBe(false);
  });

  test("a governed list switches off an external entry, an external list never a governed one", () => {
    const collected = collect(toInput(example(97)));
    expect(disabledFor(collected, "shared-currency-from-settings", "apps/web/src/checkout/Price.tsx", 0)).toBe(true);
    expect(disabledFor(collected, "shared-currency-from-settings", "apps/api/orders.ts", 0)).toBe(false);
    expect(disabledFor(collected, "currency-from-settings", "apps/web/src/checkout/Price.tsx", "repo")).toBe(false);
  });

  test("an external list switches off its own tree's entries through the directory a path stands for", () => {
    const collected = collect({
      repo: [],
      given: [{
        folder: "",
        files: [
          { path: "shop/.loreconfig", content: "repo: github.com/acme/shop\n" },
          { path: "shop/apps/web/.loreconfig", content: "disable: [price-from-quote]\n" },
          { path: "shop/.lore/a.lore", content: RULE },
        ],
      }],
      remotes: [REMOTE],
    });
    expect(disabledFor(collected, "price-from-quote", "apps/web/src/Price.tsx", 0)).toBe(true);
    expect(disabledFor(collected, "price-from-quote", "apps/api/src/orders.ts", 0)).toBe(false);
  });
});

describe("parseWithContext", () => {
  test("keeps each entry's base, external ones included", () => {
    const { model, placeOf } = parseWithContext(toInput(example(93)));
    expect(model.entries.map((e) => ({ base: placeOf.get(e)!.base, tree: placeOf.get(e)!.tree }))).toEqual([
      { base: "apps/web", tree: 0 }, { base: "apps/web", tree: 0 }, { base: "apps/web", tree: 0 },
    ]);
  });
});

test("with rules given, Lore files come from rules and carry the rules: prefix", () => {
  const lore = (id: string) => `<rule id="${id}" category="documentation">\nText.\n</rule>\n`;
  const collected = collect({
    repo: [{ path: ".lore/a.lore", content: lore("from-repo") }],
    rules: [{ path: ".lore/a.lore", content: lore("from-rules") }],
    given: [], remotes: ["https://github.com/acme/shop"],
  });
  expect(collected.files.map((f) => f.file)).toEqual(["rules:.lore/a.lore"]);
  expect(collected.files[0]!.base).toBe("");
});

test("a loose given folder is collected whole, except dot-folders, with a warning", () => {
  const lore = (id: string) => `<rule id="${id}" category="documentation">\nText.\n</rule>\n`;
  const collected = collect({
    repo: [], remotes: ["https://github.com/acme/shop"],
    given: [{ folder: "", loose: true, files: [
      { path: ".loreconfig", content: "repo: github.com/acme/shop\n" },
      { path: ".lore/a.lore", content: lore("kept") },
      { path: ".cache/.lore/b.lore", content: lore("dropped") },
    ] }],
  });
  expect(collected.files.map((f) => f.file)).toEqual(["loose:.lore/a.lore"]);
  expect(collected.warnings).toEqual([{ name: "untracked-given-folder", file: "loose:.", entry: null, line: 1 }]);
});
