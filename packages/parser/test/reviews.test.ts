import { describe, expect, test } from "bun:test";
import { LOCK_NAME, readReviews, sameSource, writeReviews, type ReviewRecord } from "../src/reviews";

const HEADER = '{"lore-reviews":1}';

function record(partial: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    rule: "money-in-minor-units",
    file: "docs/checkout-review.md",
    heading: "Money is integer minor units",
    phrase: null,
    reviewed: "2026-11-12",
    hash: "3fa9c1d2e7b4",
    ...partial,
  };
}

function line(partial: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...record(), ...partial });
}

function lock(...lines: string[]): string {
  return [HEADER, ...lines].join("\n") + "\n";
}

describe("LOCK_NAME", () => {
  test("is the lock file name", () => {
    expect(LOCK_NAME).toBe("lore-reviews.lock");
  });
});

describe("writeReviews", () => {
  test("no records is the header line only", () => {
    expect(writeReviews([])).toBe(`${HEADER}\n`);
  });

  test("starts with the header and ends with one line feed", () => {
    const text = writeReviews([record()]);
    expect(text.startsWith(`${HEADER}\n`)).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  test("writes the keys in the fixed order on one line", () => {
    const shuffled = { hash: "3fa9c1d2e7b4", reviewed: "2026-11-12", phrase: null, heading: "H", file: "f.md", rule: "r" };
    expect(writeReviews([shuffled])).toBe(
      `${HEADER}\n{"rule":"r","file":"f.md","heading":"H","phrase":null,"reviewed":"2026-11-12","hash":"3fa9c1d2e7b4"}\n`,
    );
  });

  test("escapes only what standard JSON serialization escapes, and writes every other character as itself", () => {
    const phrase = 'say "\\x"\tthen\u2028déjà\u0001\u001f\u007f\ud800 \b\f\n\r';
    const written = writeReviews([record({ heading: null, phrase })]).split("\n")[1];
    const escaped = 'say \\"\\\\x\\"\\tthen\u2028déjà\\u0001\\u001f\u007f\\ud800 \\b\\f\\n\\r';
    expect(written).toBe(
      `{"rule":"money-in-minor-units","file":"docs/checkout-review.md","heading":null,"phrase":"${escaped}","reviewed":"2026-11-12","hash":"3fa9c1d2e7b4"}`,
    );
    expect(readReviews(writeReviews([record({ heading: null, phrase })]))).toEqual({ records: [record({ heading: null, phrase })] });
  });

  test("sorts by rule, file, heading, then phrase, null first and by code point", () => {
    const sorted = [
      record({ rule: "a", file: "a.md", heading: null, phrase: null }),
      record({ rule: "a", file: "a.md", heading: null, phrase: "x" }),
      record({ rule: "a", file: "a.md", heading: "B", phrase: null }),
      record({ rule: "a", file: "a.md", heading: "B", phrase: "a" }),
      record({ rule: "a", file: "a.md", heading: "B", phrase: "b" }),
      record({ rule: "a", file: "b.md", heading: null, phrase: null }),
      record({ rule: "B", file: "a.md", heading: null, phrase: null }),
      record({ rule: "b", file: "a.md", heading: null, phrase: null }),
    ];
    const expected = writeReviews(sorted);
    expect(writeReviews([...sorted].reverse())).toBe(expected);
    expect(readReviews(expected)).toEqual({ records: [sorted[6]!, ...sorted.slice(0, 6), sorted[7]!] });
  });

  test("orders astral characters by code point, not by UTF-16 unit", () => {
    const astral = record({ rule: "\u{1F600}" });
    const bmp = record({ rule: "～" });
    expect(readReviews(writeReviews([astral, bmp]))).toEqual({ records: [bmp, astral] });
  });

  test("does not change its input", () => {
    const input = [record({ rule: "b" }), record({ rule: "a" })];
    writeReviews(input);
    expect(input.map((r) => r.rule)).toEqual(["b", "a"]);
  });
});

describe("readReviews", () => {
  test("reads back what writeReviews wrote, sorted", () => {
    const records = [
      record({ rule: "b", phrase: "two" }),
      record({ rule: "a", heading: null }),
      record({ rule: "a", heading: "Z", phrase: null }),
    ];
    const result = readReviews(writeReviews(records));
    expect(result).toEqual({ records: [records[1]!, records[2]!, records[0]!] });
  });

  test("reads a header-only file as no records", () => {
    expect(readReviews(`${HEADER}\n`)).toEqual({ records: [] });
  });

  test("accepts CRLF line endings and a missing final line feed", () => {
    const text = [HEADER, line()].join("\r\n");
    expect(readReviews(text)).toEqual({ records: [record()] });
  });

  test("accepts keys in any order", () => {
    const text = lock('{"hash":"3fa9c1d2e7b4","reviewed":"2026-11-12","phrase":null,"heading":null,"file":"f.md","rule":"r"}');
    expect(readReviews(text)).toEqual({
      records: [{ rule: "r", file: "f.md", heading: null, phrase: null, reviewed: "2026-11-12", hash: "3fa9c1d2e7b4" }],
    });
  });

  test("compares the header by value and reads whitespace and escapes, and writing again gives the canonical form", () => {
    const text = `{ "lore-reviews" : 1 }\r\n{ "rule" : "\\u006doney-in-minor-units", "file": "docs/checkout-review.md", "heading": "Money is integer minor units", "phrase": null, "reviewed": "2026-11-12", "hash": "3fa9c1d2e7b4" }`;
    const read = readReviews(text);
    expect(read).toEqual({ records: [record({ rule: "money-in-minor-units" })] });
    expect(writeReviews((read as { records: ReviewRecord[] }).records)).toBe(lock(line()));
  });

  describe("problems", () => {
    function problem(content: string): { problem: string; line: number } {
      const result = readReviews(content);
      if (!("problem" in result)) throw new Error("expected a problem");
      return result;
    }

    test("an empty file", () => {
      expect(problem("")).toMatchObject({ line: 1 });
      expect(problem("\n")).toMatchObject({ line: 1 });
    });

    test("a wrong header", () => {
      expect(problem('{"lore-reviews":2}\n')).toMatchObject({ line: 1 });
      expect(problem('{"lore-reviews":1,"x":1}\n')).toMatchObject({ line: 1 });
      expect(problem("not json\n")).toMatchObject({ line: 1 });
      expect(problem(`${line()}\n`)).toMatchObject({ line: 1 });
    });

    test("a line that is not JSON", () => {
      expect(problem(lock(line(), "{nope"))).toMatchObject({ line: 3 });
    });

    test("a line that is JSON but not an object", () => {
      expect(problem(lock("[]"))).toMatchObject({ line: 2 });
      expect(problem(lock("null"))).toMatchObject({ line: 2 });
      expect(problem(lock('"text"'))).toMatchObject({ line: 2 });
    });

    test("a record with a missing key", () => {
      const { hash: _hash, ...missing } = record();
      expect(problem(lock(line(), JSON.stringify(missing)))).toMatchObject({ line: 3 });
    });

    test("a record with an extra key", () => {
      expect(problem(lock(line({ note: "x" })))).toMatchObject({ line: 2 });
    });

    test("a key of the wrong type", () => {
      expect(problem(lock(line({ rule: 1 })))).toMatchObject({ line: 2 });
      expect(problem(lock(line({ file: null })))).toMatchObject({ line: 2 });
      expect(problem(lock(line({ heading: 3 })))).toMatchObject({ line: 2 });
      expect(problem(lock(line({ phrase: false })))).toMatchObject({ line: 2 });
    });

    test("a reviewed that is not YYYY-MM-DD", () => {
      expect(problem(lock(line({ reviewed: "12/11/2026" })))).toMatchObject({ line: 2 });
      expect(problem(lock(line({ reviewed: "2026-1-2" })))).toMatchObject({ line: 2 });
      expect(problem(lock(line({ reviewed: 20261112 })))).toMatchObject({ line: 2 });
    });

    test("a reviewed that is not a real date", () => {
      expect(problem(lock(line({ reviewed: "2026-02-30" })))).toMatchObject({ line: 2 });
      expect(problem(lock(line({ reviewed: "2026-13-01" })))).toMatchObject({ line: 2 });
      expect(problem(lock(line({ reviewed: "2026-00-10" })))).toMatchObject({ line: 2 });
      expect(readReviews(lock(line({ reviewed: "2028-02-29" })))).toHaveProperty("records");
    });

    test("a hash that is not 12 lower-case hex characters", () => {
      for (const hash of ["3FA9C1D2E7B4", "3fa9c1d2e7b", "3fa9c1d2e7b4a", "3fa9c1d2e7bg", "", 12]) {
        expect(problem(lock(line({ hash })))).toMatchObject({ line: 2 });
      }
    });

    test("two records for the same rule and source, reported at the second", () => {
      const other = line({ rule: "other" });
      expect(problem(lock(line(), other, line({ reviewed: "2026-11-13" })))).toMatchObject({ line: 4 });
    });

    test("records for the same rule with different sources are fine", () => {
      const text = lock(line(), line({ heading: null }), line({ phrase: "cents" }), line({ file: "other.md" }));
      const result = readReviews(text);
      expect("records" in result && result.records).toHaveLength(4);
    });

    test("a blank line, in the middle or at the end", () => {
      expect(problem(`${HEADER}\n\n${line()}\n`)).toMatchObject({ line: 2 });
      expect(problem(`${HEADER}\n${line()}\n\n`)).toMatchObject({ line: 3 });
      expect(problem(`${HEADER}\n${line()}\n  \n`)).toMatchObject({ line: 3 });
    });

    test("every problem has a message", () => {
      expect(problem("").problem.length).toBeGreaterThan(0);
    });
  });
});

describe("sameSource", () => {
  const rec = record({ heading: "H", phrase: "p" });
  const source = { file: "docs/checkout-review.md", heading: "H", phrase: "p" };

  test("is true when the rule, file, heading and phrase all match", () => {
    expect(sameSource(rec, "money-in-minor-units", source)).toBe(true);
  });

  test("is false when any of them differs", () => {
    expect(sameSource(rec, "other", source)).toBe(false);
    expect(sameSource(rec, "money-in-minor-units", { ...source, file: "x.md" })).toBe(false);
    expect(sameSource(rec, "money-in-minor-units", { ...source, heading: null })).toBe(false);
    expect(sameSource(rec, "money-in-minor-units", { ...source, phrase: null })).toBe(false);
  });

  test("treats null as equal to null only", () => {
    const bare = record({ heading: null, phrase: null });
    expect(sameSource(bare, "money-in-minor-units", { file: bare.file, heading: null, phrase: null })).toBe(true);
    expect(sameSource(bare, "money-in-minor-units", { file: bare.file, heading: "", phrase: null })).toBe(false);
  });
});
