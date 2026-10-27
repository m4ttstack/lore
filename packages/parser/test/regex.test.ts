import { describe, expect, test } from "bun:test";
import { parse } from "../src/model";
import { RegexLimitError, toRegExp, validateDialect, validateRegex } from "../src/regex";

const OUTSIDE = "regex-outside-dialect";

function matches(pattern: string, text: string): boolean {
  return toRegExp(pattern).test(text);
}

describe("validateRegex", () => {
  test("accepts the dialect's forms", () => {
    for (const pattern of [
      "a", ".", "\\.", "\\{", "\\}", "\\]", "\\'", "\\-", "\\t\\n\\v\\f\\r", "\\x41", "\\xfF", "\\d\\D\\w\\W\\s\\S",
      "[abc]", "[^abc]", "^a$", "\\bUSD\\B", "(a)", "(?:a)", "a|b", "a*", "a+", "a?", "a*?", "a+?", "a??", "a{2}?",
      "a{0}", "a{3}", "a{3,}", "a{3,5}", "a{0,1000}", "a{1000}", "(a{10}){100}", "((a{2}){2}){250}",
      "[a\\-z]", "[--a]", "[a-]", "[-a]", "[-]", "[a-z-]", "[-a-z]", "[\\]]", "[\\x41-\\x5A]", "[\\t-\\r]",
      "[\\d\\s\\W]", "[^^]", "[a^]", "[.*+?(){}|$]", "é", "٣", "😀+",
      "a|", "|", "(|s)", "()", "(?:)", "^(|export )const(?:) TAX_RATE()", "\\d+\\.\\d{2}", "style=\\{\\{",
    ]) {
      expect([pattern, validateRegex(pattern)]).toEqual([pattern, null]);
    }
  });

  test("lookahead and lookbehind are outside the dialect", () => {
    for (const pattern of ["USD(?=\\d)", "a(?!b)", "(?<=a)b", "(?<!a)b"]) expect(validateRegex(pattern)).toBe(OUTSIDE);
  });

  test("backreferences are outside the dialect", () => {
    for (const pattern of ["(\\d)\\1", "(a)\\9", "(?:a)\\k<code>"]) expect(validateRegex(pattern)).toBe(OUTSIDE);
  });

  test("named groups and inline flags are outside the dialect", () => {
    for (const pattern of ["(?<code>USD|EUR)", "(?P<code>USD)", "(?i)usd", "(?i:usd)", "(?", "(?:"]) {
      expect(validateRegex(pattern)).toBe(OUTSIDE);
    }
  });

  test("escapes not in the table are outside the dialect", () => {
    for (const pattern of ["\\0", "\\A", "\\z", "\\p{L}", "\\u0041", "\\cJ", "\\é", "\\ ", "\\", "a\\", "\\x4", "\\xG1", "\\x"]) {
      expect([pattern, validateRegex(pattern)]).toEqual([pattern, OUTSIDE]);
    }
  });

  test("a { that starts no quantifier is outside the dialect, and an escaped one is accepted", () => {
    for (const pattern of ["a{", "style={", "a{,2}", "a{2", "a{2,", "a{2,3", "a{a}", "a{ 2}", "a{}", "{2}"]) {
      expect([pattern, validateRegex(pattern)]).toEqual([pattern, OUTSIDE]);
    }
    expect(validateRegex("a\\{")).toBeNull();
    expect(validateRegex("style=\\{")).toBeNull();
  });

  test("a leading zero, a bound over 1000 or n above m is outside the dialect", () => {
    for (const pattern of ["a{01}", "a{00}", "a{1,02}", "a{1001}", "a{0,1001}", "a{99999999999999999999}", "a{3,2}"]) {
      expect([pattern, validateRegex(pattern)]).toEqual([pattern, OUTSIDE]);
    }
  });

  test("the product of nested bounds is at most 1000, with {0} counted as 1", () => {
    expect(validateRegex("(a{10}){100}")).toBeNull();
    expect(validateRegex("(a{10}){101}")).toBe(OUTSIDE);
    expect(validateRegex("(a{0}){1000}")).toBeNull();
    expect(validateRegex("(a{0,10}){100}")).toBeNull();
    expect(validateRegex("(a{0,11}){100}")).toBe(OUTSIDE);
    expect(validateRegex("(a{10,}){100}")).toBeNull();
    expect(validateRegex("(a{11,}){100}")).toBe(OUTSIDE);
    expect(validateRegex("((a{10})*){100}")).toBeNull();
    expect(validateRegex("((a{10})*){101}")).toBe(OUTSIDE);
    expect(validateRegex("(a{10}b{20}){50}")).toBeNull();
    expect(validateRegex("(a{10}b{21}){50}")).toBe(OUTSIDE);
    expect(validateRegex("(a{10})(b{2}){500}")).toBeNull();
    expect(validateRegex("(a{500}){2}(b{1000})")).toBeNull();
    expect(validateRegex("(((a{2}){2}){2}){126}")).toBe(OUTSIDE);
  });

  test("an unescaped } or ] outside a set is outside the dialect", () => {
    for (const pattern of ["a}", "}", "a]", "]"]) expect(validateRegex(pattern)).toBe(OUTSIDE);
  });

  test("a quantifier with nothing to repeat is outside the dialect", () => {
    for (const pattern of [
      "*a", "+", "?", "{2}", "(*a)", "(?:+a)", "a|*", "^*", "$+", "\\b?", "\\B{2}", "a**", "a*+", "a*{2}", "a???", "a{2}{3}",
    ]) {
      expect([pattern, validateRegex(pattern)]).toEqual([pattern, OUTSIDE]);
    }
  });

  test("unclosed groups and sets, stray ) and empty sets are outside the dialect", () => {
    for (const pattern of ["(a", "((a)", "a)", "())", "[a", "[^", "[", "[]", "[^]", "[]a]", "[a[b]", "[\\b]", "[\\B]"]) {
      expect([pattern, validateRegex(pattern)]).toEqual([pattern, OUTSIDE]);
    }
  });

  test("bad ranges and misplaced - in a set are outside the dialect", () => {
    for (const pattern of ["[z-a]", "[a-\\d]", "[\\d-a]", "[\\w-\\s]", "[a-b-c]", "[a--]", "[a-c-e]", "[\\x5A-\\x41]"]) {
      expect([pattern, validateRegex(pattern)]).toEqual([pattern, OUTSIDE]);
    }
    for (const pattern of ["[a\\-z]", "[!--]", "[a-c-]", "[---]", "[^-a]"]) expect([pattern, validateRegex(pattern)]).toEqual([pattern, null]);
  });

  test("set escapes outside the table are outside the dialect", () => {
    for (const pattern of ["[\\0]", "[\\p{L}]", "[\\1]", "[\\u0041]", "[\\é]"]) {
      expect([pattern, validateRegex(pattern)]).toEqual([pattern, OUTSIDE]);
    }
  });

  test("the empty pattern is outside the dialect", () => {
    expect(validateRegex("")).toBe(OUTSIDE);
  });

  test("a line feed or carriage return is regex-not-one-line, checked before the dialect", () => {
    expect(validateRegex("a\nb")).toBe("regex-not-one-line");
    expect(validateRegex("a\rb")).toBe("regex-not-one-line");
    expect(validateRegex("(?=a)\n")).toBe("regex-not-one-line");
  });

  test("validateDialect skips the one-line check, so a lone carriage return matches itself", () => {
    expect(validateDialect("a\rb")).toBeNull();
    expect(validateDialect("(?=a)")).toBe(OUTSIDE);
  });

  test("thousands of nested groups never overflow the stack", () => {
    const depth = 200_000;
    expect(validateRegex("(".repeat(depth) + "a" + ")".repeat(depth))).toBeNull();
    expect(validateRegex("(".repeat(depth) + "a")).toBe(OUTSIDE);
    expect(validateRegex("(".repeat(depth) + "a{2}" + "){1}".repeat(depth))).toBeNull();
    expect(validateRegex("[a-z]".repeat(depth))).toBeNull();
  });

  test("validation time grows linearly with the pattern's length", () => {
    const time = (n: number) => {
      const pattern = "((a|b{2}|[c-e]?)".repeat(n) + ")".repeat(n);
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        expect(validateRegex(pattern)).toBeNull();
        best = Math.min(best, performance.now() - start);
      }
      return Math.max(best, 5);
    };
    time(10_000);
    expect(time(80_000) / time(20_000)).toBeLessThan(10);
  });
});

describe("toRegExp", () => {
  test("uses the u and s flags", () => {
    expect(toRegExp("a").flags).toBe("su");
    expect(matches("^.$", "😀")).toBe(true);
    expect(matches("^.$", "\n")).toBe(true);
  });

  test("is an unanchored, case-sensitive search", () => {
    expect(matches("USD", "price in USD")).toBe(true);
    expect(matches("USD", "price in usd")).toBe(false);
    expect(matches("[Uu][Ss][Dd]", "usd")).toBe(true);
  });

  test("\\d and \\w are ASCII", () => {
    expect(matches("\\d", "٣")).toBe(false);
    expect(matches("\\d", "3")).toBe(true);
    expect(matches("\\w", "é")).toBe(false);
    expect(matches("\\D", "٣")).toBe(true);
    expect(matches("[\\d]", "٣")).toBe(false);
  });

  test("\\b is an ASCII word boundary", () => {
    expect(matches("\\bUSD\\b", "٣USD")).toBe(true);
    expect(matches("\\bUSD\\b", "aUSD")).toBe(false);
    expect(matches("\\BUSD", "éUSD")).toBe(false);
  });

  test("\\s and \\S are ASCII sets, inside and outside a set", () => {
    expect(matches("Total\\sUSD", "Total\u00a0USD")).toBe(false);
    expect(matches("Total\\sUSD", "Total USD")).toBe(true);
    for (const space of [" ", "\t", "\n", "\v", "\f", "\r"]) {
      expect(matches("^\\s$", space)).toBe(true);
      expect(matches("^\\S$", space)).toBe(false);
      expect(matches("^[\\s]$", space)).toBe(true);
      expect(matches("^[\\S]$", space)).toBe(false);
      expect(matches("^[^\\s]$", space)).toBe(false);
      expect(matches("^[^\\S]$", space)).toBe(true);
    }
    for (const other of ["\u00a0", "\u2003", "\u0085", "\ufeff", "a", "\0", "😀"]) {
      expect(matches("^\\s$", other)).toBe(false);
      expect(matches("^\\S$", other)).toBe(true);
      expect(matches("^[\\s]$", other)).toBe(false);
      expect(matches("^[\\S]$", other)).toBe(true);
      expect(matches("^[a\\S]$", other)).toBe(true);
      expect(matches("^[^\\S]$", other)).toBe(false);
    }
  });

  test("$ matches at the end of the text", () => {
    expect(matches("USD'$", "const fallback = 'USD'")).toBe(true);
    expect(matches("USD'$", "'USD' + x")).toBe(false);
    expect(matches("^const shipping", "  const shipping = 4.99")).toBe(false);
  });

  test("punctuation escapes the u flag rejects are written as the character", () => {
    expect(matches("\\'USD\\'", "'USD'")).toBe(true);
    for (const char of "!\"#%&',-:;<=>@_`~/") expect([char, matches(`^\\${char}$`, char)]).toEqual([char, true]);
    for (const char of "!\"#%&',-:;<=>@_`~/") expect([char, matches(`^[\\${char}]$`, char)]).toEqual([char, true]);
    expect(matches("^[a\\-z]+$", "-az")).toBe(true);
    expect(matches("^[a\\-z]$", "b")).toBe(false);
  });

  test("other escapes, sets and ranges", () => {
    expect(matches("^\\x41\\t$", "A\t")).toBe(true);
    expect(matches("^[\\x41-\\x43]+$", "ABC")).toBe(true);
    expect(matches("^[--a]$", "Z")).toBe(true);
    expect(matches("^[a-]+$", "a-")).toBe(true);
    expect(matches("^[^^]$", "^")).toBe(false);
    expect(matches("^[.*+?(){}|$]+$", ".*+?(){}|$")).toBe(true);
    expect(matches("style=\\{\\{", "<div style={{ color }}>")).toBe(true);
  });

  test("empty alternatives and groups match the empty string", () => {
    expect(matches("^(|export )const(?:) TAX_RATE()", "const TAX_RATE = 0.2")).toBe(true);
    expect(matches("^(|export )const(?:) TAX_RATE()", "export const TAX_RATE = 0.2")).toBe(true);
    expect(matches("^a|", "zzz")).toBe(true);
  });

  test("quantifiers keep their meaning", () => {
    expect(matches("^\\d+\\.\\d{2}$", "4.99")).toBe(true);
    expect(matches("^(ab){2,3}$", "ababab")).toBe(true);
    expect(matches("^(ab){2,3}$", "ab")).toBe(false);
    expect(matches("^a{0}b$", "b")).toBe(true);
    expect(matches("^a+?$", "aaa")).toBe(true);
  });

  test("groups nested past 1000 deep throw RegexLimitError before compiling", () => {
    const nested = (depth: number) => "(a|".repeat(depth) + "b" + ")".repeat(depth);
    expect(validateRegex(nested(1001))).toBeNull();
    expect(() => toRegExp(nested(1001))).toThrow(RegexLimitError);
    expect(() => toRegExp(nested(1001))).toThrow("1000");
    expect(toRegExp(nested(1000)).test("zb")).toBe(true);
    expect(toRegExp("(?:a|b)".repeat(5000)).test("ab".repeat(5000))).toBe(true);
  });

  test("an engine failure to compile is rethrown as RegexLimitError", () => {
    expect(() => toRegExp("(a|b)".repeat(200_000))).toThrow(RegexLimitError);
  });

  test("throws on a pattern outside the dialect", () => {
    expect(() => toRegExp("(?=a)")).toThrow(OUTSIDE);
  });
});

describe("parse-time regex checks", () => {
  const PATH = ".lore/checkout.lore";
  function errors(content: string) {
    return parse({ repo: [{ path: PATH, content }], given: [], remotes: [] }).errors.map(({ name, entry, line }) => ({ name, entry, line }));
  }

  test("an addedMatches pattern outside the dialect is an error at the <when> line", () => {
    expect(errors("<rule id=\"a\" category=\"security\">\n<when>\naddedMatches: ['ok', '(?i)usd']\n</when>\nProse.\n</rule>\n")).toEqual([
      { name: OUTSIDE, entry: "a", line: 2 },
    ]);
    expect(errors("<rule id=\"a\" category=\"security\">\n<when>\naddedMatches: [\"a\\nb\"]\n</when>\nProse.\n</rule>\n")).toEqual([
      { name: "regex-not-one-line", entry: "a", line: 2 },
    ]);
  });

  test("a regex check body outside the dialect is an error at the <check> line; other languages are not checked", () => {
    expect(errors("<rule id=\"a\" category=\"security\">\n<check>\n(\\d)\\1\n</check>\nProse.\n</rule>\n")).toEqual([
      { name: OUTSIDE, entry: "a", line: 2 },
    ]);
    expect(errors("<rule id=\"a\" category=\"security\">\n<check lang=\"regex\">\n</check>\nProse.\n</rule>\n")).toEqual([
      { name: OUTSIDE, entry: "a", line: 2 },
    ]);
    expect(errors("<rule id=\"a\" category=\"security\">\n<check lang=\"ast-grep\">\n(?=a)\n</check>\nProse.\n</rule>\n")).toEqual([]);
    expect(errors("<rule id=\"a\" category=\"security\">\n<check>\nstyle=\\{\\{\n</check>\nProse.\n</rule>\n")).toEqual([]);
  });

  test("a single-line regex check body with a lone carriage return is in the dialect", () => {
    expect(errors("<rule id=\"a\" category=\"security\">\n<check>\na\rb\n</check>\nProse.\n</rule>\n")).toEqual([]);
  });
});
