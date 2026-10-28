import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExamples } from "../../../tools/check/extract";
import { coveringEntries, missingSrcTargets, parse, parseWithContext, select, selectParsed } from "../src/index";
import { RegexLimitError } from "../src/regex";
import type { Change, Diagnostic, LoreInput, SelectOptions } from "../src/types";
import { astGrepBinary, stubAstGrep, toChange, toInput } from "./harness";

const examples = extractExamples(readFileSync(new URL("../../../spec/SPEC.md", import.meta.url), "utf8"));
const REMOTE = "https://github.com/acme/shop";
const ALL: SelectOptions = { capabilities: ["regex", "ast-grep"], astGrepBinary: astGrepBinary() };

function example(number: number) {
  const found = examples.find((e) => e.number === number);
  if (found === undefined) throw new Error(`no example ${number}`);
  return found;
}

test("an ast-grep check over a file with no content reports check-needs-file once and skips", async () => {
  const lore = `<rule id="no-any" category="code_style">\n<check lang="ast-grep">\n$A as any\n</check>\nNo casts to any.\n</rule>\n`;
  const input = { repo: [{ path: ".lore/a.lore", content: lore }], given: [], remotes: ["https://github.com/acme/shop"] };
  const change = { files: [
    { kind: "M" as const, path: "a.ts", added: [{ line: 1, text: "x as any" }] },
    { kind: "M" as const, path: "b.ts", added: [{ line: 1, text: "y as any" }] },
  ] };
  const result = await select(input, change, { capabilities: ["ast-grep"], astGrepBinary: astGrepBinary(), fileContent: () => null });
  expect(result.hits).toEqual([]);
  expect(result.warnings.map((w) => [w.name, w.file, w.line])).toEqual([["check-needs-file", ".lore/a.lore", 2]]);
});

test("an ast-grep run that fails reports ast-grep-failed for the changed file", async () => {
  const lore = `<rule id="no-any" category="code_style">\n<check lang="ast-grep">\n$A as any\n</check>\nNo casts to any.\n</rule>\n`;
  const input = { repo: [{ path: ".lore/a.lore", content: lore }], given: [], remotes: ["https://github.com/acme/shop"] };
  const change = { files: [{ kind: "M" as const, path: "a.ts", added: [{ line: 1, text: "x as any" }] }] };
  const stub = stubAstGrep("ast-grep 0.51.0");
  try {
    const result = await select(input, change, { capabilities: ["ast-grep"], astGrepBinary: stub.binary, fileContent: () => "x as any" });
    expect(result.hits).toEqual([]);
    expect(brief(result.warnings)).toEqual([{ name: "ast-grep-failed", file: "a.ts", entry: "no-any", line: 1 }]);
  } finally {
    stub.remove();
  }
});

test("ast-grep-failed warnings come out in the spec's diagnostic order, whichever run ends first", async () => {
  const lore = `<rule id="no-any" category="code_style">\n<check lang="ast-grep">\n$A as any\n</check>\nNo casts to any.\n</rule>\n`;
  const input = { repo: [{ path: ".lore/a.lore", content: lore }], given: [], remotes: ["https://github.com/acme/shop"] };
  const files = ["z.ts", "m.ts", "a.ts"];
  const change = { files: files.map((path) => ({ kind: "M" as const, path, added: [{ line: 1, text: "x as any" }] })) };
  const stub = stubAstGrep("ast-grep 0.51.0");
  try {
    const result = await select(input, change, { capabilities: ["ast-grep"], astGrepBinary: stub.binary, fileContent: () => "x as any" });
    expect(result.warnings.map((w) => w.file)).toEqual(["a.ts", "m.ts", "z.ts"]);
  } finally {
    stub.remove();
  }
});

const brief = (diagnostics: Diagnostic[]) => diagnostics.map(({ name, file, entry, line }) => ({ name, file, entry, line }));

function repo(files: Record<string, string>): LoreInput {
  return { repo: Object.entries(files).map(([path, content]) => ({ path, content })), given: [], remotes: [REMOTE] };
}

function rule(id: string, children = "", attributes = ""): string {
  return `<rule id="${id}" category="functional_correctness"${attributes}>\n${children}A rule.\n</rule>\n`;
}

const change = (...lines: string[]): Change => toChange(lines.join("\n"));

describe("select: ast-grep availability", () => {
  const totals = example(78);
  const skipped = {
    eligible: ["totals-from-quote"],
    hits: [],
    excluded: [],
    warnings: [{ name: "unsupported-check-language", file: "apps/web/src/checkout/.lore/totals.lore", entry: "totals-from-quote", line: 6 }],
  };

  test("without the binary, ast-grep checks are skipped and warned", async () => {
    const result = await select(toInput(totals), toChange(totals.diff!), { capabilities: ["regex", "ast-grep"], astGrepBinary: null });
    expect({ ...result, warnings: brief(result.warnings) }).toEqual(skipped);
  });

  test("a binary that cannot be started counts as no binary", async () => {
    const result = await select(toInput(totals), toChange(totals.diff!), {
      capabilities: ["ast-grep"], astGrepBinary: "/nonexistent/lore-test/ast-grep",
    });
    expect({ ...result, warnings: brief(result.warnings) }).toEqual(skipped);
  });

  test("a binary of another release counts as no binary", async () => {
    const stub = stubAstGrep("ast-grep 0.40.0");
    try {
      const result = await select(toInput(totals), toChange(totals.diff!), { capabilities: ["ast-grep"], astGrepBinary: stub.binary });
      expect({ ...result, warnings: brief(result.warnings) }).toEqual(skipped);
    } finally {
      stub.remove();
    }
  });

  test("without the ast-grep capability, the binary is not used", async () => {
    const result = await select(toInput(totals), toChange(totals.diff!), { capabilities: ["regex"], astGrepBinary: astGrepBinary() });
    expect({ ...result, warnings: brief(result.warnings) }).toEqual(skipped);
  });

  test("with the binary, example 78 finds its hit", async () => {
    const result = await select(toInput(totals), toChange(totals.diff!), ALL);
    expect(result.hits).toEqual([
      { rule: "totals-from-quote", file: "apps/web/src/checkout/CartTotal.tsx", line: 4, text: "    (sum, item) => sum + item.price," },
    ]);
  });
});

describe("select: checks", () => {
  const cart = [
    "export function CartTotal({ items }) {",
    "  const total = items.reduce(",
    "    (sum, item) => sum + item.price,",
    "    0,",
    "  )",
    "  return total",
    "}",
  ].join("\n");

  test("without the regex capability, a regex check is skipped and warned", async () => {
    const input = repo({ ".lore/a.lore": rule("totals-from-quote", "<check>\nreduce\n</check>\n") });
    const result = await select(input, change("M src/Cart.ts", "+2 items.reduce("), { capabilities: [] });
    expect(result.eligible).toEqual(["totals-from-quote"]);
    expect(result.hits).toEqual([]);
    expect(brief(result.warnings)).toEqual([
      { name: "unsupported-check-language", file: ".lore/a.lore", entry: "totals-from-quote", line: 2 },
    ]);
  });

  test("a line found by several checks and matches is one hit", async () => {
    const checks = '<check lang="ast-grep">\n$L.reduce($$$)\n</check>\n<check lang="ast-grep">\n$L.reduce($$$)\n</check>\n<check>\nitem\n</check>\n';
    const input = repo({ ".lore/a.lore": rule("totals-from-quote", checks), "src/Cart.tsx": cart });
    const result = await select(input, change("M src/Cart.tsx", "+3     (sum, item) => sum + item.price,", "+4     0,", "+6   return total"), ALL);
    expect(result.hits.map((hit) => hit.line)).toEqual([3, 4]);
    expect(result.warnings).toEqual([]);
  });

  test("an ast-grep check finds nothing in a changed file whose content is not given", async () => {
    const input = repo({ ".lore/a.lore": rule("totals-from-quote", '<check lang="ast-grep">\n$L.reduce($$$)\n</check>\n') });
    const result = await select(input, change("M src/Cart.tsx", "+2   const total = items.reduce(0)"), ALL);
    expect(result.eligible).toEqual(["totals-from-quote"]);
    expect(result.hits).toEqual([]);
  });

  test("a file named only by a dot has no extension, and is warned about once per rule and file", async () => {
    const checks = '<check lang="ast-grep">\nA=$B\n</check>\n<check lang="ast-grep">\nA=$B\n</check>\n';
    const input = repo({ ".lore/a.lore": rule("env-reviewed", checks), ".env": "A=1\n" });
    const result = await select(input, change("M .env", "+1 A=1", "D old.ts", "M Makefile", "+1 all:"), ALL);
    expect(brief(result.warnings)).toEqual([
      { name: "ast-grep-no-language", file: ".env", entry: "env-reviewed", line: 1 },
      { name: "ast-grep-no-language", file: "Makefile", entry: "env-reviewed", line: 1 },
    ]);
  });

  test("checks search a renamed file by its new path and its new version", async () => {
    const input = repo({ ".lore/a.lore": rule("totals-from-quote", '<check lang="ast-grep">\n$L.reduce($$$)\n</check>\n'), "src/New.tsx": cart });
    const result = await select(input, change("R src/Old.tsx -> src/New.tsx", "+2   const total = items.reduce("), ALL);
    expect(result.hits).toEqual([{ rule: "totals-from-quote", file: "src/New.tsx", line: 2, text: "  const total = items.reduce(" }]);
  });

  test("a pattern past the regex engine's limits fails the run", async () => {
    const pattern = `${"(".repeat(1001)}a${")".repeat(1001)}`;
    const input = repo({ ".lore/a.lore": rule("deep-pattern", `<when>\naddedMatches: ['${pattern}']\n</when>\n`) });
    expect(parse(input).errors).toEqual([]);
    await expect(select(input, change("M a.ts", "+1 a"), ALL)).rejects.toBeInstanceOf(RegexLimitError);
  });

  test("a regex limit error starts with the Lore file and entry id, and stays short", async () => {
    const deep = `${"(".repeat(1001)}a${")".repeat(1001)}`;
    const input = repo({ ".lore/pricing.lore": rule("deep-pattern", `<when>\naddedMatches: ['${deep}']\n</when>\n`) });
    const error = await select(input, change("M a.ts", "+1 a"), ALL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RegexLimitError);
    const { message } = error as RegexLimitError;
    expect(message).toStartWith(".lore/pricing.lore entry deep-pattern: groups nested 1001 deep, past the limit of 1000: ");
    expect(message.length).toBeLessThan(300);
  });

  test("a check pattern past the limit names its file and entry too", async () => {
    const deep = `${"(".repeat(1001)}a${")".repeat(1001)}`;
    const input = repo({ ".lore/a.lore": rule("deep-check", `<check lang="regex">\n${deep}\n</check>\n`) });
    const error = await select(input, change("M a.ts", "+1 a"), ALL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RegexLimitError);
    expect((error as RegexLimitError).message).toStartWith(".lore/a.lore entry deep-check: ");
  });

  test("selectParsed gives select's result from an input parsed already", async () => {
    const input = repo({ ".lore/a.lore": rule("no-usd", '<when>\naddedContains: ["USD"]\n</when>\n') });
    const changed = change("M a.ts", '+1 const c = "USD";');
    expect(await selectParsed(input, parseWithContext(input), changed, ALL)).toEqual(await select(input, changed, ALL));
  });

  test("a pattern past the engine's limits in a rule that can never be eligible does not fail the run", async () => {
    const deep = `<when>\naddedMatches: ['${"(".repeat(1001)}a${")".repeat(1001)}']\n</when>\n`;
    const input = repo({
      ".lore/a.lore": rule("deep-disabled", deep, " disabled"),
      "web/.lore/b.lore": '<scope>\nfiles: ["**/*.ts"]\n</scope>\n' +
        rule("deep-empty-in-ts", `<scope>\nfiles: ["**/*.md"]\n</scope>\n${deep}`),
    });
    expect(parse(input).warnings.map((w) => w.entry)).toEqual(["deep-empty-in-ts"]);
    const result = await select(input, change("M web/a.ts", "+1 a"), ALL);
    expect(result.eligible).toEqual([]);
  });
});

describe("select: counted files and disable", () => {
  const input = repo({
    "legacy/.loreconfig": "disable: [prices-from-quote]\n",
    ".lore/a.lore": rule("prices-from-quote", "<when>\naddedContains: [\"'USD'\"]\n</when>\n"),
  });

  test("a renamed file switched off for its old path counts through its new path", async () => {
    const result = await select(input, change("R legacy/Price.tsx -> checkout/Price.tsx", "+3 'USD'"), ALL);
    expect(result.eligible).toEqual(["prices-from-quote"]);
  });

  test("a file switched off for each of its paths does not count", async () => {
    const result = await select(input, change("R legacy/Price.tsx -> legacy/new/Price.tsx", "+3 'USD'", "M checkout/Total.tsx", "+1 total"), ALL);
    expect(result.eligible).toEqual([]);
  });

  test("a deleted file counts by its old path and adds no lines", async () => {
    const plain = repo({ "legacy/.lore/a.lore": rule("legacy-removals-logged") + rule("legacy-usd", "<when>\naddedContains: [\"'USD'\"]\n</when>\n") });
    const result = await select(plain, change("D legacy/Price.tsx"), ALL);
    expect(result.eligible).toEqual(["legacy-removals-logged"]);
  });
});

describe("missingSrcTargets", () => {
  test("reports a src the governed repository does not hold, with no change", () => {
    const input = repo({
      ".lore/a.lore": '<context id="architecture" src="docs/architecure.md">\n</context>\n',
      "docs/architecture.md": "# Architecture\n",
    });
    expect(brief(missingSrcTargets(input, parse(input)))).toEqual([
      { name: "missing-src-target", file: ".lore/a.lore", entry: "architecture", line: 1 },
    ]);
    const fixed = repo({
      ".lore/a.lore": '<context id="architecture" src="docs/architecture.md">\n</context>\n',
      "docs/architecture.md": "# Architecture\n",
    });
    expect(missingSrcTargets(fixed, parse(fixed))).toEqual([]);
  });

  test("a model not built by parse is parsed again", () => {
    const input = repo({ ".lore/a.lore": '<context id="architecture" src="docs/gone.md">\n</context>\n' });
    const copy = structuredClone(parse(input));
    expect(brief(missingSrcTargets(input, copy))).toEqual([
      { name: "missing-src-target", file: ".lore/a.lore", entry: "architecture", line: 1 },
    ]);
  });
});

describe("select: missing-src-target", () => {
  test("a file-relative src in an external folder is looked for in that folder's repository", async () => {
    const team = (files: Record<string, string>) => ({
      repo: [],
      given: [{
        folder: "",
        files: Object.entries({
          "shop/.loreconfig": "repo: github.com/acme/shop\n",
          "shop/.lore/a.lore": '<context id="team-handbook" src="./handbook.md">\n</context>\n',
          ...files,
        }).map(([path, content]) => ({ path, content })),
      }],
      remotes: [REMOTE],
    });
    const missing = await select(team({}), change("M a.ts"), ALL);
    expect(brief(missing.warnings)).toEqual([
      { name: "missing-src-target", file: "external:shop/.lore/a.lore", entry: "team-handbook", line: 1 },
    ]);
    const found = await select(team({ "shop/.lore/handbook.md": "# Handbook\n" }), change("M a.ts"), ALL);
    expect(found.warnings).toEqual([]);
  });

  test("a file the change adds is a target", async () => {
    const input = repo({ ".lore/a.lore": '<context id="architecture" src="docs/architecture.md">\n</context>\n' });
    const result = await select(input, change("A docs/architecture.md", "+1 # Architecture"), ALL);
    expect(result.warnings).toEqual([]);
  });
});

describe("coveringEntries", () => {
  const input = repo({
    "apps/web/src/legacy/.loreconfig": "disable: [currency-from-settings]\n",
    ".lore/checkout.lore":
      rule("currency-from-settings") +
      rule("price-from-quote", "<when>\naddedContains: [\"'USD'\"]\n</when>\n") +
      rule("old-rule", "", " disabled") +
      rule("tsx-only", '<scope>\nfiles: ["**/*.tsx"]\n</scope>\n'),
    "apps/[web]/.lore/web.lore": rule("web-rule"),
  });
  const model = parse(input);
  const ids = (path: string, from = model) => coveringEntries(input, from, path).map((entry) => entry.id);

  test("coveringEntries omits a rule switched off by disable for that path", () => {
    expect(ids("apps/web/src/legacy/Price.tsx")).toEqual(["price-from-quote", "tsx-only"]);
    expect(ids("apps/web/src/checkout/Price.tsx")).toEqual(["currency-from-settings", "price-from-quote", "tsx-only"]);
  });

  test("ignores <when>, omits disabled entries and follows scope", () => {
    expect(ids("apps/web/src/checkout/total.ts")).toEqual(["currency-from-settings", "price-from-quote"]);
  });

  test("matches a base literally, never as a glob", () => {
    expect(ids("apps/[web]/index.ts")).toContain("web-rule");
    expect(ids("apps/w/index.ts")).not.toContain("web-rule");
  });

  test("works on a copy of the model", () => {
    const copy = structuredClone(model);
    expect(ids("apps/web/src/legacy/Price.tsx", copy)).toEqual(["price-from-quote", "tsx-only"]);
  });
});

test("with rules given, a src target counts only when the rules revision tracks it", async () => {
  const context = `<context id="guide" src="docs/guide.md">\nRead it.\n</context>\n`;
  const input = {
    repo: [{ path: "docs/guide.md", content: "" }],
    rules: [{ path: ".lore/a.lore", content: context }],
    given: [], remotes: ["https://github.com/acme/shop"],
  };
  const result = await select(input, { files: [{ kind: "M", path: "x.ts", added: [] }] });
  expect(result.warnings.map((w) => [w.name, w.file])).toEqual([["missing-src-target", "rules:.lore/a.lore"]]);
});

test("a file-relative src in a rules file resolves to a plain governed path", () => {
  const context = `<context id="guide" src="./guide.md">\nRead it.\n</context>\n`;
  const model = parse({
    repo: [], given: [], remotes: ["https://github.com/acme/shop"],
    rules: [{ path: "docs/.lore/a.lore", content: context }, { path: "docs/.lore/guide.md", content: "" }],
  });
  expect(model.entries[0]!.src).toBe("docs/.lore/guide.md");
});

test("a governed file literally named external:... keeps that name in a resolved src", () => {
  const context = `<context id="guide" src="./guide.md">\nRead it.\n</context>\n`;
  const model = parse({
    repo: [{ path: "external:docs/.lore/a.lore", content: context }],
    given: [], remotes: ["https://github.com/acme/shop"],
  });
  expect(model.entries[0]!.src).toBe("external:docs/.lore/guide.md");
});
