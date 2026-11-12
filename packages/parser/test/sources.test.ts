import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { fingerprint, normalizeText, resolveSource, slug } from "../src/sources";
import type { Source } from "../src/types";

const FILE = "docs/review.md";
const DOC = "# Review\n\nIntro.\n\n## Money is integer minor units\n\nAmounts are cents.\n\n## Dates\n\nUse UTC.\n";
const MONEY = "a18621abaaba";
const WHOLE = "1c389287cfa9";

function src(partial: Partial<Source> & { file?: string } = {}): Source {
  return { file: FILE, heading: null, phrase: null, ...partial };
}

describe("slug", () => {
  test("lowers case, drops punctuation and turns spaces to hyphens", () => {
    expect(slug("Money is integer minor units")).toBe("money-is-integer-minor-units");
    expect(slug("Display casing (names, vehicles)")).toBe("display-casing-names-vehicles");
    expect(slug("snake_case and kebab-case")).toBe("snake_case-and-kebab-case");
  });
});

describe("normalizeText and fingerprint", () => {
  test("normalizes line endings, trailing whitespace and blank runs", () => {
    expect(normalizeText("\n\na  \r\n\r\n\r\n\t\nb\t\r\n\n")).toBe("a\n\nb");
  });

  test("a string is normalized before hashing, bytes are hashed as given", () => {
    expect(fingerprint("a  \r\nb\n")).toBe(fingerprint("a\nb"));
    const bytes = new Uint8Array([0xff, 0xfe, 0x00]);
    expect(fingerprint(bytes)).toBe(createHash("sha256").update(bytes).digest("hex").slice(0, 12));
  });
});

describe("resolveSource on Markdown", () => {
  test("a heading matches by text or by slug", () => {
    expect(resolveSource(src({ heading: "Money is integer minor units" }), DOC)).toEqual({ ok: true, hash: MONEY, ambiguous: false });
    expect(resolveSource(src({ heading: "money-is-integer-minor-units" }), DOC)).toEqual({ ok: true, hash: MONEY, ambiguous: false });
  });

  test("a file alone is the whole file", () => {
    expect(resolveSource(src(), DOC)).toEqual({ ok: true, hash: WHOLE, ambiguous: false });
  });

  test("a phrase alone takes the section of the nearest heading above, with whitespace collapsed", () => {
    expect(resolveSource(src({ phrase: "Amounts are   cents." }), DOC)).toEqual({ ok: true, hash: MONEY, ambiguous: false });
  });

  test("a phrase above the first heading, or under the first one, takes the whole-file section", () => {
    expect(resolveSource(src({ phrase: "Intro." }), DOC)).toEqual({ ok: true, hash: WHOLE, ambiguous: false });
  });

  test("a phrase before any heading takes the whole file", () => {
    const doc = "Preface.\n\n# One\n\nText.\n";
    expect(resolveSource(src({ phrase: "Preface." }), doc)).toEqual({ ok: true, hash: fingerprint(doc), ambiguous: false });
  });

  test("a phrase with a heading must sit inside that heading's section", () => {
    expect(resolveSource(src({ heading: "Dates", phrase: "Amounts" }), DOC)).toEqual({ ok: false, reason: "phrase" });
    expect(resolveSource(src({ heading: "Dates", phrase: "Use UTC." }), DOC)).toEqual({
      ok: true, hash: fingerprint("## Dates\n\nUse UTC."), ambiguous: false,
    });
  });

  test("a missing heading is reason heading", () => {
    expect(resolveSource(src({ heading: "Nope" }), DOC)).toEqual({ ok: false, reason: "heading" });
  });

  test("a phrase that is nowhere in the file is reason phrase", () => {
    expect(resolveSource(src({ phrase: "Nowhere" }), DOC)).toEqual({ ok: false, reason: "phrase" });
  });

  test("a phrase may span a line break, and its section is the one holding where it starts", () => {
    const doc = "## A\n\nfirst \u{1F600} line\nsecond line\n\n## B\n\nother\n";
    expect(resolveSource(src({ phrase: "line second" }), doc)).toEqual(resolveSource(src({ heading: "A" }), doc));
    expect(resolveSource(src({ phrase: "other" }), doc)).toEqual(resolveSource(src({ heading: "B" }), doc));
  });

  test("a phrase inside a heading line belongs to that heading's section", () => {
    expect(resolveSource(src({ phrase: "Dates" }), DOC)).toEqual(resolveSource(src({ heading: "Dates" }), DOC));
  });

  test("a phrase match is case-sensitive", () => {
    expect(resolveSource(src({ phrase: "amounts are cents." }), DOC)).toEqual({ ok: false, reason: "phrase" });
  });

  test("CRLF, trailing spaces and doubled blank lines give the same hashes", () => {
    const messy = DOC.replace(/\n/g, "  \r\n\r\n").replace(/^/, "\r\n\r\n");
    expect(resolveSource(src({ heading: "Money is integer minor units" }), messy)).toEqual({ ok: true, hash: MONEY, ambiguous: false });
    expect(resolveSource(src(), messy)).toEqual({ ok: true, hash: WHOLE, ambiguous: false });
    expect(resolveSource(src({ phrase: "Amounts are cents." }), messy)).toEqual({ ok: true, hash: MONEY, ambiguous: false });
  });

  test("a heading that appears twice resolves the first and is ambiguous", () => {
    const doc = "## Dates\n\nFirst.\n\n## Other\n\nx\n\n## Dates\n\nSecond.\n";
    expect(resolveSource(src({ heading: "Dates" }), doc)).toEqual({
      ok: true, hash: fingerprint("## Dates\n\nFirst."), ambiguous: true,
    });
  });

  test("two headings with the same slug are ambiguous", () => {
    const doc = "## Dates!\n\nFirst.\n\n## Dates?\n\nSecond.\n";
    const found = resolveSource(src({ heading: "Dates" }), doc);
    expect(found).toEqual({ ok: true, hash: fingerprint("## Dates!\n\nFirst."), ambiguous: true });
  });

  test("a heading line inside a fenced block is not a heading", () => {
    const doc = "## Intro\n\n```\n## Dates\n```\n\n## Dates\n\nReal.\n";
    expect(resolveSource(src({ heading: "Dates" }), doc)).toEqual({
      ok: true, hash: fingerprint("## Dates\n\nReal."), ambiguous: false,
    });
    expect(resolveSource(src({ heading: "Dates" }), "```\n## Dates\n```\n")).toEqual({ ok: false, reason: "heading" });
  });

  test("a closing run of # is not part of the heading text", () => {
    expect(resolveSource(src({ heading: "Dates" }), "## Dates ##\n\nUse UTC.\n")).toEqual({
      ok: true, hash: fingerprint("## Dates ##\n\nUse UTC."), ambiguous: false,
    });
  });

  test("a section ends at the next heading of the same or a higher level", () => {
    const doc = "## A\n\na\n\n### A1\n\na1\n\n## B\n\nb\n";
    expect(resolveSource(src({ heading: "A" }), doc)).toEqual({
      ok: true, hash: fingerprint("## A\n\na\n\n### A1\n\na1"), ambiguous: false,
    });
    expect(resolveSource(src({ heading: "A1" }), doc)).toEqual({
      ok: true, hash: fingerprint("### A1\n\na1"), ambiguous: false,
    });
  });

  test("the last section runs to the end of the file", () => {
    const doc = "# One\n\n## Two\n\ntail\n";
    expect(resolveSource(src({ heading: "Two" }), doc)).toEqual({ ok: true, hash: fingerprint("## Two\n\ntail"), ambiguous: false });
  });

  test("a heading needs a space after the markers", () => {
    expect(resolveSource(src({ heading: "Dates" }), "#Dates\n")).toEqual({ ok: false, reason: "heading" });
  });
});

describe("resolveSource on other files and missing content", () => {
  test("a phrase in a non-Markdown file fingerprints the whole file", () => {
    const code = "export function fromCents(n: number) {\n  return n;\n}\n";
    expect(resolveSource({ file: "src/money.ts", heading: null, phrase: "export function fromCents(" }, code)).toEqual({
      ok: true, hash: "5d622ccf21ca", ambiguous: false,
    });
  });

  test("null content is reason file", () => {
    expect(resolveSource(src(), null)).toEqual({ ok: false, reason: "file" });
  });

  test("one byte order mark at the start of text is ignored by matching and fingerprints", () => {
    const BOM = "\uFEFF";
    for (const source of [src(), src({ heading: "Review" }), src({ heading: "Money is integer minor units" }), src({ phrase: "Intro." })]) {
      expect(resolveSource(source, BOM + DOC)).toEqual(resolveSource(source, DOC));
    }
    expect(resolveSource(src(), BOM + DOC)).toEqual({ ok: true, hash: WHOLE, ambiguous: false });
    expect(resolveSource(src({ heading: "Review" }), BOM + DOC)).toMatchObject({ ok: true });
    expect(resolveSource({ file: "docs/notes.txt", heading: null, phrase: null }, `${BOM}Notes.\n`)).toEqual(resolveSource({ file: "docs/notes.txt", heading: null, phrase: null }, "Notes.\n"));
  });

  test("a second byte order mark, or one after the start, is an ordinary character", () => {
    const BOM = "\uFEFF";
    expect(resolveSource(src({ heading: "Review" }), BOM + BOM + DOC)).toEqual({ ok: false, reason: "heading" });
    expect(resolveSource(src(), BOM + BOM + DOC)).not.toEqual(resolveSource(src(), DOC));
    expect(resolveSource(src({ phrase: "Use UTC." }), DOC.replace("Use UTC.", `Use${BOM}UTC.`))).toEqual({ ok: false, reason: "phrase" });
    expect(resolveSource(src({ phrase: `Use${BOM}UTC.` }), DOC.replace("Use UTC.", `Use${BOM}UTC.`))).toMatchObject({ ok: true });
  });

  test("bytes that are not UTF-8 hash as given with a file alone and never resolve a phrase or heading", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41]);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    expect(resolveSource(src(), bytes)).toEqual({ ok: true, hash, ambiguous: false });
    expect(resolveSource(src({ phrase: "A" }), bytes)).toEqual({ ok: false, reason: "phrase" });
    expect(resolveSource(src({ heading: "A" }), bytes)).toEqual({ ok: false, reason: "heading" });
  });
});

describe("resolveSource finds fences by the line rule alone, and takes only spaces and tabs as whitespace", () => {
  const dates = (doc: string) => resolveSource(src({ heading: "Dates" }), doc);

  test("a tilde fence hides a heading", () => {
    expect(dates("~~~\n## Dates\n~~~\n")).toEqual({ ok: false, reason: "heading" });
  });

  test("a fence that never closes runs to the end of the file", () => {
    expect(dates("# Intro\n\n```ts\nx\n\n## Dates\n")).toEqual({ ok: false, reason: "heading" });
  });

  test("a fence line indented four spaces is not a fence", () => {
    expect(dates("    ```\n## Dates\n\nReal.\n")).toEqual({ ok: true, hash: fingerprint("## Dates\n\nReal."), ambiguous: false });
  });

  test("a fence line indented by a tab is not a fence", () => {
    expect(dates("\t~~~\n## Dates\n\nReal.\n")).toEqual({ ok: true, hash: fingerprint("## Dates\n\nReal."), ambiguous: false });
  });

  test("a closer shorter than its opener does not close, nor does one with text after it or one indented four spaces", () => {
    expect(dates("````\n```\n## Dates\n````\n")).toEqual({ ok: false, reason: "heading" });
    expect(dates("~~~\n~~~ x\n## Dates\n~~~\n")).toEqual({ ok: false, reason: "heading" });
    expect(dates("~~~\n    ~~~\n## Dates\n~~~\n")).toEqual({ ok: false, reason: "heading" });
    expect(dates("  ~~~\n   ~~~~ \t\n## Dates\n")).toEqual({ ok: true, hash: fingerprint("## Dates"), ambiguous: false });
  });

  test("normalization keeps U+00A0 and other characters that are not spaces or tabs", () => {
    expect(normalizeText("a \nb \t")).toBe("a \nb");
    expect(normalizeText(" \n\nb")).toBe(" \n\nb");
    expect(fingerprint("a ")).not.toBe(fingerprint("a"));
  });

  test("a phrase collapses spaces, tabs and line endings only", () => {
    const doc = "Round half to even.\nTotals  are\tkept\r\nin cents.\n";
    const file = { file: "docs/notes.txt", heading: null, phrase: null };
    expect(resolveSource({ ...file, phrase: "Totals are kept in cents." }, doc)).toEqual({ ok: true, hash: fingerprint(doc), ambiguous: false });
    expect(resolveSource({ ...file, phrase: "half to even" }, doc)).toEqual({ ok: false, reason: "phrase" });
    expect(resolveSource({ ...file, phrase: "half to even" }, doc)).toEqual({ ok: true, hash: fingerprint(doc), ambiguous: false });
  });

  test("a slug keeps combining marks and compares them as written", () => {
    expect(slug("Remise appliquée")).toBe("remise-appliquée");
    const doc = "## Remise appliquée\n\nText.\n";
    expect(resolveSource(src({ heading: "remise-appliquée" }), doc)).toEqual({
      ok: true, hash: fingerprint("## Remise appliquée\n\nText."), ambiguous: false,
    });
    expect(resolveSource(src({ heading: "remise-appliquée" }), doc)).toEqual({ ok: false, reason: "heading" });
  });

  test("a heading line may hold U+2028, which stays in its text and leaves its slug", () => {
    const doc = "## Totals and taxes\n\nText.\n";
    const section = { ok: true as const, hash: fingerprint("## Totals and taxes\n\nText."), ambiguous: false };
    expect(resolveSource(src({ heading: "Totals and taxes" }), doc)).toEqual(section);
    expect(resolveSource(src({ heading: "totalsand-taxes" }), doc)).toEqual(section);
  });

  test("a phrase that starts with whitespace begins on the line of its first other character", () => {
    const doc = "## Money\n\nCents.\n\n## Dates\n\nUse UTC.\n";
    expect(resolveSource(src({ phrase: " ## Dates" }), doc)).toEqual(resolveSource(src({ heading: "Dates" }), doc));
  });
});
