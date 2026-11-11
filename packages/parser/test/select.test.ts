import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExamples } from "../../../tools/check/extract";
import { coveringEntries, missingSrcTargets, parse, parseWithContext, select, selectDetailed, selectParsed } from "../src/index";
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

const brief = (diagnostics: Diagnostic[]) => diagnostics.map(({ name, file, entry, line }) => ({ name, file, entry, line }));

function repo(files: Record<string, string>): LoreInput {
  return { repo: Object.entries(files).map(([path, content]) => ({ path, content })), given: [], remotes: [REMOTE] };
}

function rule(id: string, children = "", attributes = ""): string {
  return `<rule id="${id}" category="functional_correctness"${attributes}>\n${children}A rule.\n</rule>\n`;
}

const change = (...lines: string[]): Change => toChange(lines.join("\n"));

function noAny(checks = 1): LoreInput {
  return repo({ ".lore/a.lore": rule("no-any", '<check lang="ast-grep">\n$A as any\n</check>\n'.repeat(checks)) });
}

function castIn(...paths: string[]): Change {
  return { files: paths.map((path) => ({ kind: "M" as const, path, added: [{ line: 1, text: "x as any" }], removed: [] })) };
}

const DEEP = `${"(".repeat(1001)}a${")".repeat(1001)}`;
const deepWhen = `<when>\naddedMatches: ['${DEEP}']\n</when>\n`;

describe("select: ast-grep availability", () => {
  const totals = example(83);
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

  test("with the binary, the ast-grep check finds the line that sums the items", async () => {
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

  test("an ast-grep check over a file with no content reports check-needs-file once and skips", async () => {
    const result = await select(noAny(), castIn("a.ts", "b.ts"), { capabilities: ["ast-grep"], astGrepBinary: astGrepBinary(), fileContent: () => null });
    expect(result.hits).toEqual([]);
    expect(result.warnings.map((w) => [w.name, w.file, w.line])).toEqual([["check-needs-file", ".lore/a.lore", 2]]);
  });

  describe("when ast-grep fails", () => {
    const fails = async (input: LoreInput, files: string[]) => {
      const stub = stubAstGrep("ast-grep 0.51.0");
      try {
        return await select(input, castIn(...files), { capabilities: ["ast-grep"], astGrepBinary: stub.binary, fileContent: () => "x as any" });
      } finally {
        stub.remove();
      }
    };

    test("it reports ast-grep-failed for the changed file", async () => {
      const result = await fails(noAny(), ["a.ts"]);
      expect(result.hits).toEqual([]);
      expect(brief(result.warnings)).toEqual([{ name: "ast-grep-failed", file: "a.ts", entry: "no-any", line: 1 }]);
    });

    test("two failing checks of one rule give one warning per file", async () => {
      const result = await fails(noAny(2), ["a.ts", "b.ts"]);
      expect(brief(result.warnings)).toEqual([
        { name: "ast-grep-failed", file: "a.ts", entry: "no-any", line: 1 },
        { name: "ast-grep-failed", file: "b.ts", entry: "no-any", line: 1 },
      ]);
    });

    test("the warnings are sorted by file", async () => {
      const result = await fails(noAny(), ["z.ts", "m.ts", "a.ts"]);
      expect(result.warnings.map((w) => w.file)).toEqual(["a.ts", "m.ts", "z.ts"]);
    });
  });

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
    const input = repo({ ".lore/pricing.lore": rule("deep-pattern", deepWhen) });
    const error = await select(input, change("M a.ts", "+1 a"), ALL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RegexLimitError);
    const { message } = error as RegexLimitError;
    expect(message).toStartWith(".lore/pricing.lore entry deep-pattern: groups nested 1001 deep, past the limit of 1000: ");
    expect(message.length).toBeLessThan(300);
  });

  test("the rewrapped regex limit error keeps the original as its cause", async () => {
    const input = repo({ ".lore/a.lore": rule("deep-pattern", deepWhen) });
    const error = (await select(input, change("M a.ts", "+1 a"), ALL).catch((caught: unknown) => caught)) as Error;
    expect(error.cause).toBeInstanceOf(RegexLimitError);
    expect((error.cause as Error).message).toStartWith("groups nested 1001 deep");
  });

  test("select always returns a promise, even when the input cannot be parsed", async () => {
    const promise = select(null as never, change("M a.ts", "+1 a"), ALL);
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).rejects.toBeInstanceOf(Error);
  });

  test("a check pattern past the limit names its file and entry too", async () => {
    const input = repo({ ".lore/a.lore": rule("deep-check", `<check lang="regex">\n${DEEP}\n</check>\n`) });
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

describe("select: removed lines", () => {
  test("removedContains selects on a removed line and reports it on the old side", async () => {
    const input = repo({ ".lore/a.lore": rule("fallback-kept", '<when>\nremovedContains: ["??"]\n</when>\n') });
    const result = await select(input, change("M a.ts", "-2 const x = y ?? ''", "+2 const x = y"), ALL);
    expect(result.eligible).toEqual(["fallback-kept"]);
    expect(result.hits).toEqual([{ rule: "fallback-kept", file: "a.ts", line: 2, text: "const x = y ?? ''", side: "old" }]);
  });

  test("removedMatches searches removed lines only", async () => {
    const input = repo({ ".lore/a.lore": rule("flag-read-kept", "<when>\nremovedMatches: ['^\\s*isEnabled\\(']\n</when>\n") });
    expect((await select(input, change("M a.ts", "+1   isEnabled('x')"), ALL)).eligible).toEqual([]);
    expect((await select(input, change("M a.ts", "-1   isEnabled('x')"), ALL)).eligible).toEqual(["flag-read-kept"]);
  });

  test("both sides must hold, and hits order new before old without duplicates", async () => {
    const input = repo({ ".lore/a.lore": rule("expectation-replaced", '<when>\naddedContains: ["expect("]\nremovedContains: ["expect("]\n</when>\n') });
    expect((await select(input, change("M a.test.ts", "+5 expect(a).toBe(1)"), ALL)).eligible).toEqual([]);
    const result = await select(input, change("M a.test.ts", "-5 expect(a).toBe(2)", "+5 expect(a).toBe(1)"), ALL);
    expect(result.hits).toEqual([
      { rule: "expectation-replaced", file: "a.test.ts", line: 5, text: "expect(a).toBe(1)" },
      { rule: "expectation-replaced", file: "a.test.ts", line: 5, text: "expect(a).toBe(2)", side: "old" },
    ]);
  });

  test("a deleted file's removed lines count and are named by its path", async () => {
    const input = repo({ ".lore/a.lore": rule("legacy-usd", "<when>\nremovedContains: [\"'USD'\"]\n</when>\n") });
    const result = await select(input, change("D legacy/Price.tsx", "-3 const c = 'USD'"), ALL);
    expect(result.hits).toEqual([{ rule: "legacy-usd", file: "legacy/Price.tsx", line: 3, text: "const c = 'USD'", side: "old" }]);
  });

  test("a renamed file's removed lines are hits by its old path", async () => {
    const input = repo({ "checkout/.lore/a.lore": rule("usd", "<when>\nremovedContains: [\"'USD'\"]\n</when>\n") });
    const result = await select(input, change("R legacy/Price.tsx -> checkout/Price.tsx", "-3 'USD'", "+3 settings.currency"), ALL);
    expect(result.hits.map((hit) => hit.file)).toEqual(["legacy/Price.tsx"]);
  });

  test("a removed line never counts for an added condition or a check", async () => {
    const added = repo({ ".lore/a.lore": rule("no-usd", "<when>\naddedContains: [\"'USD'\"]\n</when>\n") });
    expect((await select(added, change("M a.ts", "-1 'USD'"), ALL)).eligible).toEqual([]);
    const checked = repo({ ".lore/a.lore": rule("usd-gone", "<when>\nremovedContains: [\"'USD'\"]\n</when>\n<check>\n'USD'\n</check>\n") });
    const result = await select(checked, change("M a.ts", "-1 'USD'"), ALL);
    expect(result.eligible).toEqual(["usd-gone"]);
    expect(result.hits).toEqual([{ rule: "usd-gone", file: "a.ts", line: 1, text: "'USD'", side: "old" }]);
  });

  test("a rename whose old path alone is in scope counts, with hits by the old path", async () => {
    const input = repo({ "legacy/.lore/a.lore": rule("usd", "<when>\nremovedContains: [\"'USD'\"]\n</when>\n") });
    const result = await select(input, change("R legacy/Price.tsx -> checkout/Price.tsx", "-3 'USD'"), ALL);
    expect(result.eligible).toEqual(["usd"]);
    expect(result.hits).toEqual([{ rule: "usd", file: "legacy/Price.tsx", line: 3, text: "'USD'", side: "old" }]);
  });
});

describe("select: dropped lines", () => {
  const dropped = (id: string, when: string) => repo({ ".lore/a.lore": rule(id, `<when>\n${when}\n</when>\n`) });
  const FALLBACK = dropped("fallback-dropped", 'droppedContains: ["??"]');

  test("an edit that adds the item back is not found, and the removed pair still is", async () => {
    const edited = change("M a.ts", "-2 const x = y ?? ''", "+2 const x = z ?? ''");
    expect((await select(FALLBACK, edited, ALL)).eligible).toEqual([]);
    expect((await select(dropped("fallback-touched", 'removedContains: ["??"]'), edited, ALL)).eligible).toEqual(["fallback-touched"]);
  });

  test("an edit that does not add the item back is found, as an old-side hit", async () => {
    const result = await select(FALLBACK, change("M a.ts", "-2 const x = y ?? ''", "+2 const x = y"), ALL);
    expect(result.eligible).toEqual(["fallback-dropped"]);
    expect(result.hits).toEqual([{ rule: "fallback-dropped", file: "a.ts", line: 2, text: "const x = y ?? ''", side: "old" }]);
  });

  test("an unchanged line between the removed and the added line makes two edits", async () => {
    const input = dropped("guard-dropped", 'droppedContains: ["if (!q)"]');
    const result = await select(input, change("M a.ts", "-3 if (!q) return null", "+4 if (!q) return fallback"), ALL);
    expect(result.hits.map((hit) => hit.line)).toEqual([3]);
    expect((await select(input, change("M a.ts", "-3 if (!q) return null", "+3 if (!q) return fallback"), ALL)).eligible).toEqual([]);
  });

  test("lines listed in any order give the same edits", async () => {
    expect((await select(FALLBACK, change("M a.ts", "+2 const x = z ?? ''", "-2 const x = y ?? ''"), ALL)).eligible).toEqual([]);
    const result = await select(FALLBACK, change("M a.ts", "+8 const cap = c.cap", "-8 const cap = c.cap ?? 9", "-7 const rate = c.rate ?? 0", "+7 const rate = c.rate"), ALL);
    expect(result.hits.map((hit) => hit.line)).toEqual([7, 8]);
  });

  test("an edit after earlier edits of unequal size is still paired", async () => {
    expect((await select(FALLBACK, change("M a.ts", "-2 a", "-3 b", "+2 c", "-10 const x = y ?? 0", "+9 const x = z ?? 0"), ALL)).eligible).toEqual([]);
    const result = await select(FALLBACK, change("M a.ts", "-2 a", "-3 b", "+2 c", "-10 const x = y ?? 0", "+9 const x = y"), ALL);
    expect(result.hits.map((hit) => hit.line)).toEqual([10]);
  });

  test("pairing is by edit, not line by line", async () => {
    const lines = ["M a.ts", "-7 const rate = c.rate ?? 0", "-8 const cap = c.cap ?? 9", "+7 const rate = c.rate ?? 0.05", "+8 const cap = c.cap"];
    expect((await select(FALLBACK, change(...lines), ALL)).eligible).toEqual([]);
  });

  test("each item is paired on its own", async () => {
    const input = dropped("branch-or-fallback-dropped", "droppedMatches: ['\\?\\?', '^\\s*if \\(']");
    const result = await select(input, change("M a.ts", "-4   if (code ?? fallback) {", "+4   if (code) {"), ALL);
    expect(result.hits).toEqual([{ rule: "branch-or-fallback-dropped", file: "a.ts", line: 4, text: "  if (code ?? fallback) {", side: "old" }]);
    expect((await select(input, change("M a.ts", "-4   if (code ?? fallback) {", "+4   if (code ?? other) {"), ALL)).eligible).toEqual([]);
  });

  test("a deleted file's matching lines are all found", async () => {
    const result = await select(FALLBACK, change("D legacy/a.ts", "-1 const x = y ?? 0", "-2 const z = 1", "-3 const w = v ?? 1"), ALL);
    expect(result.hits.map((hit) => [hit.file, hit.line])).toEqual([["legacy/a.ts", 1], ["legacy/a.ts", 3]]);
  });

  test("a renamed file pairs removed lines under the old path with added lines under the new one", async () => {
    const input = repo({ ".lore/a.lore": rule("usd-dropped", "<when>\ndroppedContains: [\"'USD'\"]\n</when>\n") });
    expect((await select(input, change("R legacy/P.tsx -> checkout/P.tsx", "-3 'USD'", "+3 settings.currency ?? 'USD'"), ALL)).eligible).toEqual([]);
    const result = await select(input, change("R legacy/P.tsx -> checkout/P.tsx", "-3 'USD'", "+3 settings.currency"), ALL);
    expect(result.hits.map((hit) => hit.file)).toEqual(["legacy/P.tsx"]);
  });

  test("a rule with both pairs has one hit per removed line", async () => {
    const input = dropped("both", 'removedContains: ["??"]\ndroppedContains: ["??"]');
    const result = await select(input, change("M a.ts", "-2 const x = y ?? ''", "+2 const x = y"), ALL);
    expect(result.hits).toEqual([{ rule: "both", file: "a.ts", line: 2, text: "const x = y ?? ''", side: "old" }]);
  });

  test("every condition must hold, and an empty list never does", async () => {
    const gone = change("M a.ts", "-2 const x = y ?? ''", "+2 const x = y");
    expect((await select(dropped("needs-added", 'addedContains: ["parseFloat("]\ndroppedContains: ["??"]'), gone, ALL)).eligible).toEqual([]);
    expect((await select(dropped("empty", "droppedContains: []"), gone, ALL)).eligible).toEqual([]);
  });

  test("a removed line in a file outside the rule's scope is not found", async () => {
    const input = repo({ "checkout/.lore/a.lore": rule("scoped", '<when>\ndroppedContains: ["??"]\n</when>\n') });
    expect((await select(input, change("M legacy/a.ts", "-2 const x = y ?? ''"), ALL)).eligible).toEqual([]);
  });

  test("a removed line in a file the entry is switched off for is not found", async () => {
    const files = { ".lore/a.lore": rule("fallback-dropped", '<when>\ndroppedContains: ["??"]\n</when>\n') };
    const gone = change("M legacy/a.ts", "-2 const x = y ?? ''", "+2 const x = y");
    expect((await select(repo(files), gone, ALL)).eligible).toEqual(["fallback-dropped"]);
    const off = repo({ ...files, "legacy/.loreconfig": "disable: [fallback-dropped]\n" });
    expect((await select(off, gone, ALL)).eligible).toEqual([]);
  });

  test("a context with droppedContains is eligible when a line is found, and has no hits", async () => {
    const input = repo({ ".lore/a.lore": '<context id="fallbacks">\n<when>\ndroppedContains: ["??"]\n</when>\nFallbacks.\n</context>\n' });
    const result = await select(input, change("M a.ts", "-2 const x = y ?? ''", "+2 const x = y"), ALL);
    expect(result.eligible).toEqual(["fallbacks"]);
    expect(result.hits).toEqual([]);
    expect((await select(input, change("M a.ts", "-2 const x = y ?? ''", "+2 const x = z ?? ''"), ALL)).eligible).toEqual([]);
  });

  test("a droppedMatches pattern past the regex engine's limits fails the run, even with no file in scope", async () => {
    const input = repo({ "checkout/.lore/a.lore": rule("deep-dropped", `<when>\ndroppedMatches: ['${DEEP}']\n</when>\n`) });
    expect(parse(input).errors).toEqual([]);
    await expect(select(input, change("M legacy/a.ts", "-1 a"), ALL)).rejects.toBeInstanceOf(RegexLimitError);
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

describe("selectDetailed: in scope, not triggered", () => {
  const eur = "<when>\naddedContains: [\"EUR\"]\n</when>\n";
  const input = repo({
    "checkout/.lore/c.lore": '<scope>\nfiles: ["**/*.ts"]\n</scope>\n' +
      rule("usd-added", "<when>\naddedContains: [\"USD\"]\n</when>\n") +
      rule("eur-added", eur) +
      rule("no-when") +
      `<context id="eur-context">\n${eur}Euros.\n</context>\n` +
      rule("eur-disabled", eur, " disabled") +
      rule("eur-in-md", `<scope>\nfiles: ["**/*.md"]\n</scope>\n${eur}`),
    "legacy/.lore/l.lore": rule("legacy-eur", eur),
    "gone/.lore/g.lore": rule("gone-eur", eur),
    ".lore/r.lore": rule("tsx-eur", `<scope>\nfiles: ["**/*.tsx"]\n</scope>\n${eur}`),
    "styles/.loreconfig": "disable: [all-off]\n",
    "styles/old/.loreconfig": "disable: [half-off]\n",
    "styles/.lore/s.lore": rule("half-off", eur) + rule("all-off", eur),
  });
  const changed = change(
    "M checkout/Total.ts", '+1 const c = "USD";',
    "R legacy/Price.tsx -> shop/Price.tsx", "+3 price",
    "D gone/Old.ts", "-1 old",
    "M styles/old/b.css", "+1 b",
    "M styles/a.css", "+1 a",
  );

  test("lists the rules in scope whose <when> did not hold, with the paths each counts for", async () => {
    const { untriggered } = await selectDetailed(input, parseWithContext(input), changed, ALL);
    expect(untriggered).toEqual([
      { id: "eur-added", paths: ["checkout/Total.ts"] },
      { id: "gone-eur", paths: ["gone/Old.ts"] },
      { id: "half-off", paths: ["styles/a.css"] },
      { id: "legacy-eur", paths: ["legacy/Price.tsx"] },
      { id: "tsx-eur", paths: ["legacy/Price.tsx", "shop/Price.tsx"] },
    ]);
  });

  test("a rename out of a folder that switches the rule off lists only the path it still counts for", async () => {
    const rename = change("R styles/old/c.css -> styles/c.css", "+1 c");
    const { untriggered } = await selectDetailed(input, parseWithContext(input), rename, ALL);
    expect(untriggered).toEqual([{ id: "half-off", paths: ["styles/c.css"] }]);
  });

  test("its result is what selectParsed returns", async () => {
    const { result } = await selectDetailed(input, parseWithContext(input), changed, ALL);
    expect(result.eligible).toEqual(["no-when", "usd-added"]);
    expect(result).toEqual(await selectParsed(input, parseWithContext(input), changed, ALL));
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

  describe("in a loose folder", () => {
    const loose = (files: Record<string, string>): LoreInput => ({
      repo: [],
      given: [{
        folder: "", loose: true,
        files: Object.entries({ ".loreconfig": "repo: github.com/acme/shop\n", ...files }).map(([path, content]) => ({ path, content })),
      }],
      remotes: [REMOTE],
    });
    const guide = (src: string) => `<context id="guide" src="${src}">\n</context>\n`;

    test("a file-relative src resolves to loose:<path> and is found there", async () => {
      const input = loose({ ".lore/a.lore": guide("./guide.md"), ".lore/guide.md": "# Guide\n" });
      expect(parse(input).entries[0]!.src).toBe("loose:.lore/guide.md");
      expect((await select(input, change("M a.ts"), ALL)).warnings.map((w) => w.name)).toEqual(["untracked-given-folder"]);
    });

    test("a file-relative src to a file the folder lacks is missing-src-target", async () => {
      const result = await select(loose({ ".lore/a.lore": guide("./guide.md") }), change("M a.ts"), ALL);
      expect(result.warnings.map((w) => w.name)).toEqual(["untracked-given-folder", "missing-src-target"]);
    });

    test("a src that climbs above the Lore root is src-escapes-root", () => {
      expect(parse(loose({ ".lore/a.lore": guide("./../../guide.md") })).errors.map((e) => e.name)).toEqual(["src-escapes-root"]);
    });
  });

  test("a file the change adds is a target", async () => {
    const input = repo({ ".lore/a.lore": '<context id="architecture" src="docs/architecture.md">\n</context>\n' });
    const result = await select(input, change("A docs/architecture.md", "+1 # Architecture"), ALL);
    expect(result.warnings).toEqual([]);
  });

  test("with rules given, a src target counts only when the rules revision tracks it", async () => {
    const context = `<context id="guide" src="docs/guide.md">\nRead it.\n</context>\n`;
    const input = {
      repo: [{ path: "docs/guide.md", content: "" }],
      rules: [{ path: ".lore/a.lore", content: context }],
      given: [], remotes: ["https://github.com/acme/shop"],
    };
    const result = await select(input, { files: [{ kind: "M", path: "x.ts", added: [], removed: [] }] });
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
