import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { astGrepAvailable, astGrepLanguage, astGrepSpans } from "../src/astgrep";
import { astGrepBinary, stubAstGrep } from "./harness";

const binary = astGrepBinary();

describe("astGrepLanguage", () => {
  test("maps an extension through the spec's table, case-sensitively", () => {
    expect(astGrepLanguage("apps/web/src/CartTotal.tsx")).toBe("tsx");
    expect(astGrepLanguage("types/index.d.ts")).toBe("typescript");
    expect(astGrepLanguage("src/main.c++")).toBe("cpp");
    expect(astGrepLanguage("infra/main.tf")).toBe("hcl");
    expect(astGrepLanguage("README.md")).toBe("markdown");
    expect(astGrepLanguage("src/Main.TS")).toBeNull();
    expect(astGrepLanguage("schema/quote.graphql")).toBeNull();
  });

  test("a name with no dot, or only a leading one, has no extension", () => {
    expect(astGrepLanguage("Makefile")).toBeNull();
    expect(astGrepLanguage("apps/web/.env")).toBeNull();
    expect(astGrepLanguage("src.ts/Makefile")).toBeNull();
    expect(astGrepLanguage("apps/web/.env.sh")).toBe("bash");
  });

  test("names on the object prototype are not extensions", () => {
    expect(astGrepLanguage("a.constructor")).toBeNull();
    expect(astGrepLanguage("a.__proto__")).toBeNull();
  });
});

describe("astGrepAvailable", () => {
  test("is true for the pinned binary and false for a missing one", async () => {
    expect(await astGrepAvailable(binary)).toBe(true);
    expect(await astGrepAvailable("/nonexistent/lore-test/ast-grep")).toBe(false);
  });

  test("is false for any release other than 0.51.0", async () => {
    for (const version of ["ast-grep 0.40.0", "ast-grep 0.51.1", "ast-grep 0.51.0-beta"]) {
      const stub = stubAstGrep(version);
      try {
        expect(await astGrepAvailable(stub.binary)).toBe(false);
      } finally {
        stub.remove();
      }
    }
  });
});

describe("astGrepSpans", () => {
  test("a binary that fails yields null, not an empty match list", async () => {
    const stub = stubAstGrep("ast-grep 0.51.0");
    try { expect(await astGrepSpans(stub.binary, "$A", "typescript", "x")).toBeNull(); } finally { stub.remove(); }
  });
  const CART = [
    "export function CartTotal({ items, fees }) {",
    "  const feeTotal = fees.reduce((sum, fee) => sum + fee, 0)",
    "  const total = items.reduce(",
    "    (sum, item) => sum + item.price,",
    "    0,",
    "  )",
    "  return <span>{total + feeTotal}</span>",
    "}",
  ].join("\n");

  test("gives each match's lines, from its first character to its last", async () => {
    expect(await astGrepSpans(binary, "$LIST.reduce($$$)", "tsx", CART)).toEqual([
      { first: 2, last: 2 },
      { first: 3, last: 6 },
    ]);
  });

  test("no match or a pattern ast-grep reads as an error node finds nothing, an unknown language fails", async () => {
    expect(await astGrepSpans(binary, "nothingLikeThis()", "tsx", CART)).toEqual([]);
    expect(await astGrepSpans(binary, "(((", "tsx", CART)).toEqual([]);
    expect(await astGrepSpans(binary, "$X", "no-such-language", CART)).toBeNull();
  });

  test("a pattern is one argument, even when it looks like an option", async () => {
    expect(await astGrepSpans(binary, "--version", "tsx", CART)).toEqual([]);
    expect(await astGrepSpans(binary, "-1", "tsx", "const a = -1\n")).toEqual([{ first: 1, last: 1 }]);
  });

  test("a pattern that cannot be passed as an argument fails", async () => {
    expect(await astGrepSpans(binary, "a\0b", "tsx", CART)).toBeNull();
  });

  test("a missing binary fails", async () => {
    expect(await astGrepSpans("/nonexistent/lore-test/ast-grep", "$X", "tsx", CART)).toBeNull();
  });

  test("an sgconfig.yml around the working directory is not read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-astgrep-"));
    const cwd = process.cwd();
    try {
      writeFileSync(join(dir, "sgconfig.yml"), "this: [is broken\n");
      process.chdir(dir);
      expect(await astGrepSpans(binary, "$LIST.reduce($$$)", "tsx", CART)).toHaveLength(2);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
