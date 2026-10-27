import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff } from "../src/diff";
import { InputError } from "../src/errors";

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
