import { expect, test } from "bun:test";
import { decode, firstInvalidLine } from "../src/text";

test("lines split on LF, a CR before LF belongs to the break, a lone CR stays", () => {
  const text = decode("a\r\nb\rc\nd");
  expect(text.lines).toEqual(["a", "b\rc", "d"]);
  expect(text.lineStarts).toEqual([0, 3, 7]);
  expect(text.hadBom).toBe(false);
});

test("a BOM is not part of the first line", () => {
  const text = decode("﻿<rule>\nx");
  expect(text.hadBom).toBe(true);
  expect(text.lines).toEqual(["<rule>", "x"]);
  expect(text.lineStarts).toEqual([1, 8]);
});

test("positionAt and offsetAt round-trip over a file with a BOM and non-ASCII text", () => {
  const content = "﻿<rule id=\"café\">\nPrices in € 🙂 stay\n</rule>\n";
  const text = decode(content);
  for (let offset = 1; offset <= content.length; offset++) {
    expect(text.offsetAt(text.positionAt(offset))).toBe(offset);
  }
  expect(text.positionAt(1)).toEqual({ line: 0, character: 0 });
  const emoji = content.indexOf("🙂");
  expect(text.positionAt(emoji + 2)).toEqual({ line: 1, character: 14 });
  expect(text.positionAt(content.length)).toEqual({ line: 3, character: 0 });
});

test("positions count UTF-16 units and exclude the CR of a CRLF break", () => {
  const text = decode("ab\r\n🙂x");
  expect(text.positionAt(2)).toEqual({ line: 0, character: 2 });
  expect(text.positionAt(3)).toEqual({ line: 0, character: 2 });
  expect(text.positionAt(7)).toEqual({ line: 1, character: 3 });
  expect(text.offsetAt({ line: 0, character: 99 })).toBe(2);
  expect(text.offsetAt({ line: 5, character: 0 })).toBe(7);
  expect(text.offsetAt({ line: 1, character: 2 })).toBe(6);
});

test("a lone surrogate is an invalid byte, reported at its line", () => {
  expect(firstInvalidLine(decode("ok\nbad \uD800 here\n"))).toBe(2);
  expect(firstInvalidLine(decode("pair 🙂 is fine"))).toBeNull();
});
