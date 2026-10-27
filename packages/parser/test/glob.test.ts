import { describe, expect, test } from "bun:test";
import { disjoint, matchFromBase, matchGlob, resolveGlob, validateGlob } from "../src/glob";

function timed(run: () => boolean): { result: boolean; ms: number } {
  const start = performance.now();
  const result = run();
  return { result, ms: performance.now() - start };
}

describe("validateGlob", () => {
  test("accepts the spec's glob forms", () => {
    for (const glob of [
      "**", "**/*.ts", "src/**/checkout/*.tsx", "[!A-Z]*.tsx", "{cart,checkout}/*.tsx", "*.{ts,}",
      "pages/[[]id].tsx", "pages/[{]slug}.tsx", "[]]", "[!]]", "[a-]", "[-a]", "[--a]", "[!^]", "a]b", "a}b,c",
      "{a,[}]}", "{*.ts,?x}", "..x", ".env",
    ]) {
      expect(validateGlob(glob, "files")).toBeNull();
    }
  });

  test("an empty glob, an empty segment or a . segment is invalid-glob", () => {
    for (const glob of ["", "src//a.ts", "src/", "./src", "src/./a.ts"]) expect(validateGlob(glob, "files")).toBe("invalid-glob");
  });

  test("a leading ! is invalid-glob", () => {
    expect(validateGlob("!**/*.test.tsx", "ignores")).toBe("invalid-glob");
    expect(validateGlob("a!b", "files")).toBeNull();
  });

  test("** inside a longer segment is invalid-glob, outside sets only", () => {
    for (const glob of ["src/**.tsx", "***", "a**", "{**,a}"]) expect(validateGlob(glob, "files")).toBe("invalid-glob");
    expect(validateGlob("[**]", "files")).toBeNull();
    expect(validateGlob("*[a]*", "files")).toBeNull();
  });

  test("a set without a closing ] in its segment is invalid-glob", () => {
    for (const glob of ["src/[a", "[]", "[!]", "[a/]", "[!"]) expect(validateGlob(glob, "files")).toBe("invalid-glob");
  });

  test("a ^ directly after [ is invalid-glob", () => {
    expect(validateGlob("[^a]", "files")).toBe("invalid-glob");
    expect(validateGlob("[a^]", "files")).toBeNull();
  });

  test("ranges are read left to right and must not end before they start", () => {
    expect(validateGlob("[z-a]", "files")).toBe("invalid-glob");
    expect(validateGlob("[a--]", "files")).toBe("invalid-glob");
    expect(validateGlob("[a-c-e]", "files")).toBe("invalid-glob");
    expect(validateGlob("[a-cx-z]", "files")).toBeNull();
    expect(validateGlob("[a-a]", "files")).toBeNull();
  });

  test("an unclosed or nested brace is invalid-glob", () => {
    for (const glob of ["src/**/*.{ts,tsx", "{a/b}", "{a,{b}}", "{a{b}"]) {
      expect(validateGlob(glob, "files")).toBe("invalid-glob");
    }
  });

  test("a \\ anywhere is invalid-glob", () => {
    expect(validateGlob("src/\\*.ts", "files")).toBe("invalid-glob");
    expect(validateGlob("[\\]", "files")).toBe("invalid-glob");
  });

  test("a scope glob with a leading / is leading-slash, before invalid-glob", () => {
    expect(validateGlob("/apps/web/src/**", "files")).toBe("leading-slash");
    expect(validateGlob("/", "ignores")).toBe("leading-slash");
  });

  test("changed and unchanged allow a leading / and read the rest as a glob", () => {
    expect(validateGlob("/apps/api/**", "changed")).toBeNull();
    expect(validateGlob("/apps/web/src/__generated__/**", "unchanged")).toBeNull();
    expect(validateGlob("/", "changed")).toBe("invalid-glob");
    expect(validateGlob("//a", "changed")).toBe("invalid-glob");
    expect(validateGlob("/!a", "unchanged")).toBe("invalid-glob");
  });

  test("a .. segment is glob-escapes-base in every place, after invalid-glob", () => {
    expect(validateGlob("src/../tests/**", "ignores")).toBe("glob-escapes-base");
    expect(validateGlob("../lib/**", "files")).toBe("glob-escapes-base");
    expect(validateGlob("apps/web/../api/schema.graphql", "changed")).toBe("glob-escapes-base");
    expect(validateGlob("/apps/../api/**", "unchanged")).toBe("glob-escapes-base");
    expect(validateGlob("../src//a", "files")).toBe("invalid-glob");
  });
});

describe("matchGlob", () => {
  test("** matches zero or more whole segments", () => {
    expect(matchGlob("apps/web/src/**/checkout/*.tsx", "apps/web/src/checkout/Price.tsx")).toBe(true);
    expect(matchGlob("apps/web/src/**/checkout/*.tsx", "apps/web/src/a/b/checkout/Price.tsx")).toBe(true);
    expect(matchGlob("**", "a/b/c")).toBe(true);
    expect(matchGlob("**/*.ts", "a.ts")).toBe(true);
    expect(matchGlob("a/**", "a")).toBe(true);
    expect(matchGlob("**/b/**/d", "a/b/c/b/x/d")).toBe(true);
    expect(matchGlob("**/b/**/d", "a/b/c/e")).toBe(false);
  });

  test("*, ? and sets stay within one segment", () => {
    expect(matchGlob("*.json", "messages.json")).toBe(true);
    expect(matchGlob("*.json", "apps/messages.json")).toBe(false);
    expect(matchGlob("a?b", "a/b")).toBe(false);
    expect(matchGlob("a?c", "abc")).toBe(true);
    expect(matchGlob("a*", "a")).toBe(true);
  });

  test("* and ** match dotfiles and dot-directories", () => {
    expect(matchGlob("apps/web/*.production", "apps/web/.env.production")).toBe(true);
    expect(matchGlob("**/*.ts", ".config/a.ts")).toBe(true);
    expect(matchGlob("?env", ".env")).toBe(true);
  });

  test("[!...] matches one character not in the set", () => {
    expect(matchGlob("apps/web/src/checkout/[!A-Z]*.tsx", "apps/web/src/checkout/Price.tsx")).toBe(false);
    expect(matchGlob("apps/web/src/checkout/[!A-Z]*.tsx", "apps/web/src/checkout/format.tsx")).toBe(true);
    expect(matchGlob("[abc]", "b")).toBe(true);
    expect(matchGlob("[a-c]", "d")).toBe(false);
  });

  test("{a,b} matches any one alternative, empty and wildcard ones included", () => {
    expect(matchGlob("apps/web/src/{cart,checkout}/*.tsx", "apps/web/src/checkout/Price.tsx")).toBe(true);
    expect(matchGlob("apps/web/src/{cart,checkout}/*.tsx", "apps/web/src/catalog/Price.tsx")).toBe(false);
    expect(matchGlob("a.ts{,x}", "a.ts")).toBe(true);
    expect(matchGlob("a.ts{,x}", "a.tsx")).toBe(true);
    expect(matchGlob("{*.test,?}.ts", "Cart.test.ts")).toBe(true);
    expect(matchGlob("**/*.{ts,tsx}", "src/Cart.test.tsx")).toBe(true);
  });

  test("special characters are matched through sets", () => {
    expect(matchGlob("pages/[[]id].tsx", "pages/[id].tsx")).toBe(true);
    expect(matchGlob("pages/[{]slug}.tsx", "pages/{slug}.tsx")).toBe(true);
    expect(matchGlob("[*]", "*")).toBe(true);
    expect(matchGlob("[*]", "a")).toBe(false);
    expect(matchGlob("a]b", "a]b")).toBe(true);
    expect(matchGlob("a,b}", "a,b}")).toBe(true);
    expect(matchGlob("[]]", "]")).toBe(true);
    expect(matchGlob("[--a]", "Z")).toBe(true);
    expect(matchGlob("[a-]", "-")).toBe(true);
  });

  test("matching is by code point and case-sensitive, with no normalization", () => {
    expect(matchGlob("?.txt", "😀.txt")).toBe(true);
    expect(matchGlob("[😀-😂]", "😁")).toBe(true);
    expect(matchGlob("*.TS", "a.ts")).toBe(false);
    expect(matchGlob("café", "café")).toBe(false);
  });

  test("regex metacharacters are literal", () => {
    expect(matchGlob("a.b", "axb")).toBe(false);
    expect(matchGlob("(a)+|$", "(a)+|$")).toBe(true);
  });

  test("many stars or starred alternatives in one segment match in linear time", () => {
    const a = (n: number) => "a".repeat(n);
    for (const run of [
      () => matchGlob(`${"*a".repeat(12)}*b`, a(60)),
      () => matchGlob(`${"{*,a}".repeat(12)}b`, a(60)),
      () => matchGlob(`${"{a,a}".repeat(24)}b`, a(24)),
    ]) {
      const { result, ms } = timed(run);
      expect(result).toBe(false);
      expect(ms).toBeLessThan(50);
    }
    expect(matchGlob(`${"*a".repeat(12)}*b`, `${a(60)}b`)).toBe(true);
    expect(matchGlob(`${"{*,a}".repeat(12)}b`, `${a(60)}b`)).toBe(true);
  });

  test("an invalid glob matches nothing", () => {
    expect(matchGlob("src/[a", "src/[a")).toBe(false);
    expect(matchGlob("", "")).toBe(false);
  });
});

describe("resolveGlob", () => {
  test("prefixes the base literally", () => {
    expect(resolveGlob("apps/web/src/checkout", "**/*.tsx")).toBe("apps/web/src/checkout/**/*.tsx");
    expect(resolveGlob("apps/[web]", "*.ts")).toBe("apps/[web]/*.ts");
  });

  test("a glob at the repository root is unchanged", () => {
    expect(resolveGlob("", "**/*.ts")).toBe("**/*.ts");
  });

  test("a leading / resolves from the repository root", () => {
    expect(resolveGlob("apps/web/src/checkout", "/apps/api/schema.graphql")).toBe("apps/api/schema.graphql");
    expect(resolveGlob("", "/apps/api/**")).toBe("apps/api/**");
  });
});

describe("matchFromBase", () => {
  test("the base is compared character by character, never read as a glob", () => {
    expect(matchFromBase("app/[id]", "*.ts", "app/[id]/a.ts")).toBe(true);
    expect(matchFromBase("app/[id]", "*.ts", "app/i/a.ts")).toBe(false);
    expect(matchFromBase("app/[ab]", "x", "app/a/x")).toBe(false);
    expect(matchFromBase("app/[ab]", "x", "app/[ab]/x")).toBe(true);
  });

  test("a path must be below the base", () => {
    expect(matchFromBase("apps/web", "**", "apps/web/src/a.ts")).toBe(true);
    expect(matchFromBase("apps/web", "**", "apps/website/a.ts")).toBe(false);
    expect(matchFromBase("apps/web", "**", "apps/web")).toBe(false);
    expect(matchFromBase("apps/web/src/checkout", "*.json", "apps/web/src/checkout/cart/a.json")).toBe(false);
  });

  test("at the repository root the whole path is matched", () => {
    expect(matchFromBase("", "*.json", "package.json")).toBe(true);
    expect(matchFromBase("", "*.json", "apps/package.json")).toBe(false);
  });

  test("a leading / matches from the repository root", () => {
    expect(matchFromBase("apps/web/src/checkout", "/apps/api/schema.graphql", "apps/api/schema.graphql")).toBe(true);
    expect(matchFromBase("apps/web/src/checkout", "/apps/api/**", "apps/web/src/checkout/a.ts")).toBe(false);
  });
});

describe("disjoint", () => {
  test("conflicting tails are disjoint", () => {
    expect(disjoint("**/*.ts", "**/*.md")).toBe(true);
    expect(disjoint("**/*.ts", "**/price*.ts")).toBe(false);
    expect(disjoint("*.tsx", "*.ts")).toBe(true);
    expect(disjoint("*.ts", "a.d.ts")).toBe(false);
    expect(disjoint("a/{x,y}.ts", "b.ts")).toBe(true);
  });

  test("conflicting heads are disjoint", () => {
    expect(disjoint("checkout/**", "cart/**")).toBe(true);
    expect(disjoint("checkout/**", "checkout/cart/**")).toBe(false);
    expect(disjoint("src/a/*.ts", "src/b/*.ts")).toBe(true);
    expect(disjoint("src/*/a.ts", "lib/**")).toBe(true);
  });

  test("a glob ending in ** has no tail and conflicts with none", () => {
    expect(disjoint("**", "**/*.md")).toBe(false);
    expect(disjoint("src/**", "**/*.md")).toBe(false);
  });

  test("a head ends at the first segment with a wildcard, set or brace", () => {
    expect(disjoint("src/[ab]/x", "src/c/x")).toBe(false);
    expect(disjoint("{a,b}/x", "c/x")).toBe(false);
  });

  test("a tail is the text after the last *, ?, ] or } of the last segment", () => {
    expect(disjoint("[ab].ts", "x.ts")).toBe(false);
    expect(disjoint("a{b,c}.md", "**/*.ts")).toBe(true);
    expect(disjoint("a?", "ab")).toBe(false);
  });
});
