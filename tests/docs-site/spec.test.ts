import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { splitSpec } from "../../site/scripts/spec";

const spec = readFileSync("spec/SPEC.md", "utf8");
const pages = splitSpec(spec, { ref: "main" });

describe("splitSpec", () => {
  test("one page per top-level section, in order", () => {
    expect(pages.map((p) => p.title)).toEqual([
      "Introduction", "Conventions", "Conformance examples", "Files and folders", "Parsing", "Defaults", "Rules",
      "Context", "Categories and severity", "Scope and globs", "Conditions", "Regex dialect", "Checks", "Sources",
      "Eligibility", "Auditing sources", "Error reach", ".loreconfig", "External folders", "Collecting files",
      "Document model", "Errors and warnings", "For agents (non-normative)", "Adopting Lore (non-normative)",
    ]);
    expect(pages.map((p) => p.position)).toEqual(pages.map((_, i) => i + 1));
  });
  test("ids from punctuated titles", () => {
    expect(pages.find((p) => p.title === ".loreconfig")!.id).toBe("loreconfig");
    expect(pages.find((p) => p.title === "For agents (non-normative)")!.id).toBe("for-agents-non-normative");
  });
  test("headings inside fences never split", () => {
    const md = "# T\n\n## A\n\n```````\n``````example parse\n=== a.lore\n## Not a page\n``````\n```````\n\n## B\n";
    expect(splitSpec(md, { ref: "main" }).map((p) => p.title)).toEqual(["A", "B"]);
  });
  test("cross-page anchors point at the right page", () => {
    const md = "# T\n\n## A\n\nSee [b](#b-two).\n\n## B\n\n### B two\n";
    expect(splitSpec(md, { ref: "main" })[0]!.body).toContain("](./b.md#b-two)");
  });
  test("deduped slugs follow GitHub", () => {
    const md = "# T\n\n## A\n\n### Refunds\n\n## B\n\n### Refunds\n\nSee [r](#refunds-1).\n";
    const [a, b] = splitSpec(md, { ref: "main" });
    expect(a!.body).toContain("### Refunds {#refunds}");
    expect(b!.body).toContain("### Refunds {#refunds-1}");
    expect(b!.body).toContain("](#refunds-1)");
  });
  test("an unknown anchor throws", () => {
    expect(() => splitSpec("# T\n\n## A\n\n[x](#nope)\n", { ref: "main" })).toThrow("spec link #nope matches no heading");
  });
  test("examples get numbered titles", () => {
    const all = pages.map((p) => p.body).join("\n");
    expect(all).toContain('``````text title="Example 1 (');
    // Only the demo inside the seven-backtick fence in "Conformance examples" keeps its raw opener.
    expect(all.match(/^``````example /gm)?.length).toBe(1);
  });
  test("an example inside a seven-backtick fence stays literal", () => {
    const md = "# T\n\n## A\n\n```````\n``````example parse\n=== a.lore\n``````\n```````\n";
    expect(splitSpec(md, { ref: "main" })[0]!.body).toContain("``````example parse");
  });
  test("file links are rewritten", () => {
    const all = pages.map((p) => p.body).join("\n");
    expect(all).toContain("](./for-agents-non-normative.md)");
    expect(all).toContain("](./schemas/audit.md)");
    expect(all).toContain("https://github.com/m4ttstack/lore/blob/main/LICENSE");
  });
  test("an unknown relative link throws", () => {
    expect(() => splitSpec("# T\n\n## A\n\n[x](other.md)\n", { ref: "main" })).toThrow("other.md");
  });
});
