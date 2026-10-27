import { expect, test } from "bun:test";
import { extractExamples } from "../tools/check/extract";

const F = "``````";

function doc(...lines: string[]): string {
  return lines.join("\n");
}

test("extracts kind, section and number", () => {
  const md = doc(
    "# Title",
    "## Eligibility",
    F + "example eligibility",
    "=== a.md",
    "x",
    F,
    "### Parsing",
    F + "example parse",
    "=== b.lore",
    "y",
    F,
  );
  const ex = extractExamples(md);
  expect(ex.map((e) => [e.number, e.kind, e.section, e.line])).toEqual([
    [1, "eligibility", "Eligibility", 3],
    [2, "parse", "Parsing", 8],
  ]);
});

test("splits files, diff and expect", () => {
  const ex = extractExamples(
    doc(
      "## S",
      F + "example eligibility",
      "=== src/a.ts",
      "one",
      "two",
      "=== remote",
      "git@example.com:acme/shop.git",
      "=== diff",
      "+x",
      "=== expect",
      "ok",
      F,
    ),
  )[0]!;
  expect(ex.files).toEqual([{ path: "src/a.ts", place: "repo", content: "one\ntwo" }]);
  expect(ex.remote).toBe("git@example.com:acme/shop.git");
  expect(ex.diff).toBe("+x");
  expect(ex.expect).toBe("ok");
});

test("marks external: paths", () => {
  const ex = extractExamples(
    doc(F + "example eligibility", "=== external:../shared/r.lore", "z", "=== in.lore", "w", F),
  )[0]!;
  expect(ex.files).toEqual([
    { path: "external:../shared/r.lore", place: "external", content: "z" },
    { path: "in.lore", place: "repo", content: "w" },
  ]);
});

test("marks rules: and loose: paths", () => {
  const ex = extractExamples(
    doc(F + "example eligibility", "=== rules:.lore/a.lore", "z", "=== loose:a.lore", "y", F),
  )[0]!;
  expect(ex.files.map((f) => f.place)).toEqual(["rules", "loose"]);
});

test("reads requires lines", () => {
  const ex = extractExamples(
    doc(F + "example eligibility", "requires: git", "requires: network", "=== a", "b", F),
  )[0]!;
  expect(ex.requires).toEqual(["git", "network"]);
  expect(ex.files).toEqual([{ path: "a", place: "repo", content: "b" }]);
});

test("extracts an example whose input contains a triple-backtick fence", () => {
  const ex = extractExamples(
    doc(F + "example parse", "=== a.md", "```yaml", "id: x", "```", F, "after"),
  )[0]!;
  expect(ex.files[0]!.content).toBe("```yaml\nid: x\n```");
});

test("keeps file content byte-exact (no trimming, trailing newline excluded)", () => {
  const ex = extractExamples(
    doc(F + "example parse", "=== a", "  indented  ", "", "\ttab", "", F),
  )[0]!;
  expect(ex.files[0]!.content).toBe("  indented  \n\n\ttab\n");
});

test("ignores six-backtick blocks whose info string is not example", () => {
  const md = doc(
    "## Real",
    F + "text",
    "## Not a heading",
    F,
    F + "example parse",
    "=== a",
    "b",
    F,
  );
  const ex = extractExamples(md);
  expect(ex).toHaveLength(1);
  expect(ex[0]!.section).toBe("Real");
  expect(ex[0]!.line).toBe(5);
});

test("ignores headings and examples inside ordinary fenced code blocks", () => {
  const md = doc(
    "## Outer",
    "```md",
    "## Inside",
    "```",
    "~~~",
    F + "example parse",
    "=== a",
    "b",
    F,
    "~~~",
    F + "example parse",
    "=== a",
    "c",
    F,
  );
  const ex = extractExamples(md);
  expect(ex).toHaveLength(1);
  expect(ex[0]!.section).toBe("Outer");
  expect(ex[0]!.files[0]!.content).toBe("c");
});

test("treats remote, diff and expect as sections, never files", () => {
  const ex = extractExamples(doc(F + "example parse", "=== expect", "e", F))[0]!;
  expect(ex.files).toEqual([]);
  expect(ex.expect).toBe("e");
});

test("throws on an unterminated example, naming the line", () => {
  expect(() => extractExamples(doc("## S", F + "example parse", "=== a", "b"))).toThrow("line 2");
});

test("throws on a duplicate named section", () => {
  expect(() =>
    extractExamples(doc(F + "example parse", "=== diff", "a", "=== diff", "b", F)),
  ).toThrow('duplicate "diff"');
});

test("throws on text before the first section", () => {
  expect(() =>
    extractExamples(doc("x", F + "example parse", "requires: git", "stray", "=== a", "b", F)),
  ).toThrow("line 4");
});

test("throws on an example opener with no kind", () => {
  expect(() => extractExamples(doc("x", F + "example", "=== a", "b", F))).toThrow("line 2");
});

test("throws on text after the kind on the opener line", () => {
  expect(() => extractExamples(doc("x", F + "example parse extra", "=== a", "b", F))).toThrow("line 2");
  expect(() => extractExamples(doc("x", F + "example parse ", "=== a", "b", F))).toThrow("line 2");
});

test("throws on a section marker with an empty or padded path", () => {
  expect(() => extractExamples(doc(F + "example parse", "=== ", "b", F))).toThrow("line 2");
  expect(() => extractExamples(doc(F + "example parse", "=== a ", "b", F))).toThrow("line 2");
  expect(() => extractExamples(doc(F + "example parse", "===  a", "b", F))).toThrow("line 2");
});

test("returns diff and expect as null when absent", () => {
  const ex = extractExamples(doc(F + "example parse", "=== a", "b", F))[0]!;
  expect(ex.remote).toBeNull();
  expect(ex.diff).toBeNull();
  expect(ex.expect).toBeNull();
});
