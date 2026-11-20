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
  test("the preamble under the title opens the first page", () => {
    expect(pages[0]!.body).toContain("Version 1. Status: draft.");
  });
  test("edit links point at SPEC.md, not the generated page", () => {
    for (const p of pages) expect(p.body).toMatch(/^custom_edit_url: https:\/\/github\.com\/m4ttstack\/lore\/edit\/main\/spec\/SPEC\.md$/m);
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
  test("level-one headings count toward GitHub's deduped slugs", () => {
    const md = "# Rules\n\n## A\n\n### Rules\n\nSee [r](#rules-1).\n";
    const [a] = splitSpec(md, { ref: "main" });
    expect(a!.body).toContain("### Rules {#rules-1}");
    expect(a!.body).toContain("](#rules-1)");
  });
  test("an unknown anchor throws", () => {
    expect(() => splitSpec("# T\n\n## A\n\n[x](#nope)\n", { ref: "main" })).toThrow("spec link #nope matches no heading");
  });
  test("examples get numbered, linkable labels", () => {
    const all = pages.map((p) => p.body).join("\n");
    expect(all).toMatch(/^#### Example 1 \(.*\) \{#example-1\}$/m);
    // Only the demo inside the seven-backtick fence in "Conformance examples" keeps its raw opener.
    expect(all.match(/^``````example /gm)?.length).toBe(1);
  });
  test("each example section is its own highlighted block", () => {
    const md = [
      "# T", "", "## A", "",
      "``````example eligibility",
      "requires: regex",
      "=== .lore/a.lore",
      "<rule id=\"r\">",
      "  Text with ``` inside.",
      "</rule>",
      "=== .loreconfig",
      "root: true",
      "=== diff",
      "M src/a.ts",
      "+1 x",
      "=== expect",
      "{}",
      "``````",
    ].join("\n");
    const body = splitSpec(md, { ref: "main" })[0]!.body;
    expect(body).toContain("#### Example 1 (eligibility, requires regex) {#example-1}");
    expect(body).toContain('````html title=".lore/a.lore"\n<rule id="r">\n  Text with ``` inside.\n</rule>\n````');
    expect(body).toContain('```yaml title=".loreconfig"\nroot: true\n```');
    expect(body).toContain('```diff title="Change"\nM src/a.ts\n+1 x\n```');
    expect(body).toContain('```json title="Expected output"\n{}\n```');
    expect(body).not.toContain("=== ");
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
