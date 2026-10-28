import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExamples } from "../../../tools/check/extract";
import { toChange } from "../../parser/test/harness";
import { parseUnifiedDiff } from "../src/diff";
import { InputError } from "../src/errors";

const examples = extractExamples(readFileSync(new URL("../../../spec/SPEC.md", import.meta.url), "utf8"));

function exampleChange(number: number) {
  const example = examples.find((e) => e.number === number);
  if (!example?.diff) throw new Error(`conformance example ${number} has no diff`);
  return toChange(example.diff);
}

describe("parseUnifiedDiff", () => {
  test("numbers added lines from each hunk's +start and skips context and removed lines", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 111..222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " keep",
      "-old",
      "+new one",
      "+new two",
      " keep",
      "@@ -20,2 +21,3 @@",
      " ctx",
      "+late",
      " ctx",
      "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({
      files: [{ kind: "M", path: "src/a.ts", added: [
        { line: 2, text: "new one" }, { line: 3, text: "new two" }, { line: 22, text: "late" },
      ] }],
    });
  });

  test("new file mode is an addition", () => {
    const diff = [
      "diff --git a/n.ts b/n.ts", "new file mode 100644", "--- /dev/null", "+++ b/n.ts",
      "@@ -0,0 +1,2 @@", "+one", "+two", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({
      files: [{ kind: "A", path: "n.ts", added: [{ line: 1, text: "one" }, { line: 2, text: "two" }] }],
    });
  });

  test("deleted file mode is a deletion with no added lines", () => {
    const diff = [
      "diff --git a/gone.ts b/gone.ts", "deleted file mode 100644", "--- a/gone.ts", "+++ /dev/null",
      "@@ -1,2 +0,0 @@", "-one", "-two", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "D", path: "gone.ts", added: [] }] });
  });

  test("a pure rename carries both paths", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts", "similarity index 100%", "rename from old.ts", "rename to new.ts", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "R", oldPath: "old.ts", path: "new.ts", added: [] }] });
  });

  test("a rename with edits keeps the added lines", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts", "similarity index 80%", "rename from old.ts", "rename to new.ts",
      "--- a/old.ts", "+++ b/new.ts", "@@ -1,2 +1,2 @@", " same", "-before", "+after", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({
      files: [{ kind: "R", oldPath: "old.ts", path: "new.ts", added: [{ line: 2, text: "after" }] }],
    });
  });

  test("a binary file is a changed file with no added lines", () => {
    const diff = ["diff --git a/x.png b/x.png", "index 1..2 100644", "Binary files a/x.png and b/x.png differ", ""].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "M", path: "x.png", added: [] }] });
  });

  test("a no-newline marker is not a line", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@",
      "-old", "\\ No newline at end of file", "+new", "\\ No newline at end of file", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "M", path: "a.ts", added: [{ line: 1, text: "new" }] }] });
  });

  test("CRLF input leaves no carriage return and keeps numbering", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,2 +1,3 @@", " ctx", "+added", " ctx", "",
    ].join("\r\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "M", path: "a.ts", added: [{ line: 2, text: "added" }] }] });
  });

  test("a quoted path is unescaped as UTF-8", () => {
    const diff = [
      'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"', '--- "a/caf\\303\\251.ts"', '+++ "b/caf\\303\\251.ts"',
      "@@ -1 +1 @@", "-a", "+b", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "M", path: "café.ts", added: [{ line: 1, text: "b" }] }] });
  });

  test("a path with a space survives", () => {
    const diff = [
      "diff --git a/my file.ts b/my file.ts", "--- a/my file.ts", "+++ b/my file.ts", "@@ -1 +1 @@", "-a", "+b", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "M", path: "my file.ts", added: [{ line: 1, text: "b" }] }] });
  });

  test("a plain diff -u without git headers is accepted", () => {
    const diff = [
      "--- a/p.ts\t2026-01-01 10:00:00", "+++ b/p.ts\t2026-01-02 10:00:00", "@@ -1 +1,2 @@", " x", "+y",
      "--- a/q.ts", "+++ b/q.ts", "@@ -1 +1 @@", "-m", "+n", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({
      files: [
        { kind: "M", path: "p.ts", added: [{ line: 2, text: "y" }] },
        { kind: "M", path: "q.ts", added: [{ line: 1, text: "n" }] },
      ],
    });
  });

  test("an empty string is an empty change", () => {
    expect(parseUnifiedDiff("")).toEqual({ files: [] });
  });

  test("text that is not a diff is an input error", () => {
    expect(() => parseUnifiedDiff("hello")).toThrow(InputError);
  });
});

describe("quoted paths", () => {
  const quoted = (path: string) =>
    [`diff --git "a/${path}" "b/${path}"`, `--- "a/${path}"`, `+++ "b/${path}"`, "@@ -1 +1 @@", "-a", "+b", ""].join("\n");
  const pathsOf = (diff: string) => parseUnifiedDiff(diff).files.map((f) => f.path);

  test("alert, backspace, form feed and vertical tab escapes decode", () => {
    expect(pathsOf(quoted("x\\a\\b\\f\\v.ts"))).toEqual(["x\x07\x08\x0c\x0b.ts"]);
  });

  test("a raw astral character inside a quoted path survives", () => {
    expect(pathsOf(quoted("\\t\u{1F600}.ts"))).toEqual(["\t\u{1F600}.ts"]);
  });

  test("octal escapes, escaped quotes and astral characters mix", () => {
    expect(pathsOf(quoted('\u{1F600}\\303\\251\\"q.ts'))).toEqual(['\u{1F600}é"q.ts']);
  });

  test("only the right side quoted", () => {
    const diff = ['diff --git a/x y.ts "b/x\\ty.ts"', "--- a/x y.ts", '+++ "b/x\\ty.ts"', "@@ -1 +1 @@", "-a", "+b", ""].join("\n");
    expect(pathsOf(diff)).toEqual(["x\ty.ts"]);
  });
});

describe("prefixes", () => {
  const diffWith = (header: string, minus: string, plus: string) =>
    [`diff --git ${header}`, `--- ${minus}`, `+++ ${plus}`, "@@ -1 +1 @@", "-a", "+b", ""].join("\n");
  const pathOf = (diff: string) => parseUnifiedDiff(diff).files.map((f) => f.path);

  test.each([
    ["i/", "w/"], ["c/", "i/"], ["c/", "w/"], ["o/", "w/"], ["c/", "c/"], ["w/", "i/"], ["1/", "2/"],
  ])("mnemonic pair %s %s is stripped", (left, right) => {
    expect(pathOf(diffWith(`${left}src/x.ts ${right}src/x.ts`, `${left}src/x.ts`, `${right}src/x.ts`))).toEqual(["src/x.ts"]);
  });

  test("a diff.noprefix diff strips nothing", () => {
    expect(pathOf(diffWith("x.ts x.ts", "x.ts", "x.ts"))).toEqual(["x.ts"]);
  });

  test("noprefix paths that start with a/ or b/ stay whole", () => {
    expect(pathOf(diffWith("a/x.ts a/x.ts", "a/x.ts", "a/x.ts"))).toEqual(["a/x.ts"]);
    expect(pathOf(diffWith("b/x.ts b/x.ts", "b/x.ts", "b/x.ts"))).toEqual(["b/x.ts"]);
  });

  test("an unknown pair is not stripped", () => {
    expect(pathOf(diffWith("old/x.ts new/x.ts", "old/x.ts", "new/x.ts"))).toEqual(["new/x.ts"]);
  });

  test("a mnemonic pair with a space in the path", () => {
    expect(pathOf(diffWith("i/my file.ts w/my file.ts", "i/my file.ts", "w/my file.ts"))).toEqual(["my file.ts"]);
  });

  test("a rename under mnemonic prefixes keeps its unprefixed rename lines", () => {
    const diff = ["diff --git c/old.ts w/new.ts", "similarity index 100%", "rename from old.ts", "rename to new.ts", ""].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "R", oldPath: "old.ts", path: "new.ts", added: [] }] });
  });

  test("a header-only mnemonic binary file takes its path from the header", () => {
    const diff = ["diff --git i/x.png w/x.png", "Binary files i/x.png and w/x.png differ", ""].join("\n");
    expect(pathOf(diff)).toEqual(["x.png"]);
  });

  test("a plain diff strips a/ and b/ only as a pair", () => {
    const plain = (minus: string, plus: string) => `--- ${minus}\n+++ ${plus}\n@@ -1 +1 @@\n-a\n+b\n`;
    expect(pathOf(plain("a/p.ts", "b/p.ts"))).toEqual(["p.ts"]);
    expect(pathOf(plain("a/p.ts", "p.ts"))).toEqual(["p.ts"]);
    expect(pathOf(plain("a/p.ts", "c/p.ts"))).toEqual(["c/p.ts"]);
    expect(pathOf(plain("old/p.ts", "new/p.ts"))).toEqual(["new/p.ts"]);
    expect(pathOf(plain("b/p.ts", "b/p.ts"))).toEqual(["b/p.ts"]);
  });

  test("a plain diff against /dev/null still strips the other side", () => {
    expect(pathOf("--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1 @@\n+x\n")).toEqual(["n.ts"]);
    expect(pathOf("--- a/n.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n")).toEqual(["n.ts"]);
  });
});

describe("copies", () => {
  test("a pure copy is an added file at the new path", () => {
    const diff = ["diff --git a/src.ts b/dst.ts", "similarity index 100%", "copy from src.ts", "copy to dst.ts", ""].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "A", path: "dst.ts", added: [] }] });
  });

  test("a copy with edits keeps the added lines", () => {
    const diff = [
      "diff --git a/src.ts b/dst.ts", "similarity index 80%", "copy from src.ts", "copy to dst.ts",
      "--- a/src.ts", "+++ b/dst.ts", "@@ -1,2 +1,2 @@", " same", "-before", "+after", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "A", path: "dst.ts", added: [{ line: 2, text: "after" }] }] });
  });
});

describe("diff -ruN", () => {
  test("a binary line without a git header is a modified file", () => {
    const diff = ["diff -ruN a/x.png b/x.png", "Binary files a/x.png and b/x.png differ", ""].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "M", path: "x.png", added: [] }] });
  });

  test("a binary line against /dev/null is an addition or a deletion", () => {
    expect(parseUnifiedDiff("Binary files /dev/null and b/n.png differ\n")).toEqual({
      files: [{ kind: "A", path: "n.png", added: [] }],
    });
    expect(parseUnifiedDiff("Binary files a/g.png and /dev/null differ\n")).toEqual({
      files: [{ kind: "D", path: "g.png", added: [] }],
    });
  });

  test("a binary path with ' and ' in it", () => {
    expect(parseUnifiedDiff("Binary files a/salt and pepper.png and b/salt and pepper.png differ\n")).toEqual({
      files: [{ kind: "M", path: "salt and pepper.png", added: [] }],
    });
  });

  test("Only in lines are ignored and a binary line sits between text files", () => {
    const diff = [
      "diff -ruN a/p.ts b/p.ts", "--- a/p.ts", "+++ b/p.ts", "@@ -1 +1 @@", "-a", "+b",
      "Binary files a/x.png and b/x.png differ",
      "Only in b: extra.ts",
      "diff -ruN a/q.ts b/q.ts", "--- a/q.ts", "+++ b/q.ts", "@@ -1 +1 @@", "-c", "+d", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({
      files: [
        { kind: "M", path: "p.ts", added: [{ line: 1, text: "b" }] },
        { kind: "M", path: "x.png", added: [] },
        { kind: "M", path: "q.ts", added: [{ line: 1, text: "d" }] },
      ],
    });
  });

  test("a diff of only Only in lines is an empty change", () => {
    expect(parseUnifiedDiff("Only in a: gone.ts\nOnly in b: new.ts\n")).toEqual({ files: [] });
  });
});

describe("header-only entries", () => {
  test.each([
    ["a space", "my file.png", "diff --git a/my file.png b/my file.png", "Binary files a/my file.png and b/my file.png differ"],
    ["a quoted path", "caf\u00e9.png", 'diff --git "a/caf\\303\\251.png" "b/caf\\303\\251.png"', 'Binary files "a/caf\\303\\251.png" and "b/caf\\303\\251.png" differ'],
  ])("a binary file with %s", (_name, path, header, binary) => {
    const diff = [header, "index 1..2 100644", binary, ""].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "M", path, added: [] }] });
  });

  test.each([
    ["a space", "my file.ts", "diff --git a/my file.ts b/my file.ts"],
    ["a quoted path", "caf\u00e9.ts", 'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"'],
  ])("a mode-only change with %s", (_name, path, header) => {
    const diff = [header, "old mode 100644", "new mode 100755", ""].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "M", path, added: [] }] });
  });

  test("a pure rename with a space in both paths", () => {
    const diff = [
      "diff --git a/old name.ts b/new name.ts", "similarity index 100%", "rename from old name.ts", "rename to new name.ts", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "R", oldPath: "old name.ts", path: "new name.ts", added: [] }] });
  });

  test("a pure rename with quoted paths", () => {
    const diff = [
      'diff --git "a/old\\tname.ts" "b/new\\303\\251.ts"', "similarity index 100%",
      'rename from "old\\tname.ts"', 'rename to "new\\303\\251.ts"', "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "R", oldPath: "old\tname.ts", path: "new\u00e9.ts", added: [] }] });
  });
});

describe("hunk bodies", () => {
  test("content lines that look like file markers stay content", () => {
    const diff = [
      "diff --git a/q.sql b/q.sql", "--- a/q.sql", "+++ b/q.sql", "@@ -1,3 +1,3 @@",
      " select 1;", "--- x", "+++ y", " select 2;", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "M", path: "q.sql", added: [{ line: 2, text: "++ y" }] }] });
  });

  test("two files in one diff", () => {
    const one = (name: string) => [`diff --git a/${name} b/${name}`, `--- a/${name}`, `+++ b/${name}`, "@@ -1 +1 @@", "-a", "+b"];
    expect(parseUnifiedDiff([...one("one.ts"), ...one("two.ts"), ""].join("\n"))).toEqual({
      files: [
        { kind: "M", path: "one.ts", added: [{ line: 1, text: "b" }] },
        { kind: "M", path: "two.ts", added: [{ line: 1, text: "b" }] },
      ],
    });
  });

  test("a no-newline marker after a removed line mid-hunk keeps the numbering", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,3 +1,4 @@",
      " keep", "-old", "\\ No newline at end of file", "+new", "+more", " tail", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual({
      files: [{ kind: "M", path: "a.ts", added: [{ line: 2, text: "new" }, { line: 3, text: "more" }] }],
    });
  });
});

describe("conformance fixtures", () => {
  test("a diff of three modified files equals example 76's change", () => {
    const diff = [
      "diff --git a/apps/web/src/checkout/Price.tsx b/apps/web/src/checkout/Price.tsx",
      "index 1111111..2222222 100644",
      "--- a/apps/web/src/checkout/Price.tsx", "+++ b/apps/web/src/checkout/Price.tsx",
      "@@ -11,2 +11,4 @@", " function Price() {", "+  const label = 'USD'", '+  const note = "EUR"', " }",
      "diff --git a/apps/web/src/checkout/Summary.tsx b/apps/web/src/checkout/Summary.tsx",
      "index 3333333..4444444 100644",
      "--- a/apps/web/src/checkout/Summary.tsx", "+++ b/apps/web/src/checkout/Summary.tsx",
      "@@ -3,1 +3,2 @@", " function Summary() {", "+  return <span>{'EUR'} {total}</span>",
      "diff --git a/apps/web/src/checkout/currency.ts b/apps/web/src/checkout/currency.ts",
      "index 5555555..6666666 100644",
      "--- a/apps/web/src/checkout/currency.ts", "+++ b/apps/web/src/checkout/currency.ts",
      "@@ -1,1 +1,2 @@", " // currencies", "+export const DEFAULT_CURRENCY = 'USD'", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual(exampleChange(76));
  });

  test("a diff with a deletion and a rename equals example 80's change", () => {
    const diff = [
      "diff --git a/apps/web/src/legacy/OldPrice.tsx b/apps/web/src/legacy/OldPrice.tsx",
      "deleted file mode 100644", "index 1111111..0000000",
      "--- a/apps/web/src/legacy/OldPrice.tsx", "+++ /dev/null",
      "@@ -1,2 +0,0 @@", "-export const OldPrice = 1", "-export default OldPrice",
      "diff --git a/apps/web/src/checkout/Price.tsx b/apps/web/src/pricing/Price.tsx",
      "similarity index 90%", "rename from apps/web/src/checkout/Price.tsx", "rename to apps/web/src/pricing/Price.tsx",
      "index 2222222..3333333 100644",
      "--- a/apps/web/src/checkout/Price.tsx", "+++ b/apps/web/src/pricing/Price.tsx",
      "@@ -2,2 +2,2 @@", " export function Price() {", "-  const label = 'EUR'", "+  const label = 'USD'", "",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual(exampleChange(80));
  });
});
