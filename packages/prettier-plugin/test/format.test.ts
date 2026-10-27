import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as prettier from "prettier";
import { parse, parseFile, type Diagnostic, type DocumentModel, type InputFile, type LoreInput } from "@lore/parser";
import { extractExamples } from "../../../tools/check/extract";
import { toInput } from "../../parser/test/harness";
import * as plugin from "../src/index";
import { splitProse } from "../src/print";

const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
const examples = extractExamples(readFileSync(new URL("../../../spec/SPEC.md", import.meta.url), "utf8"));

function format(text: string, options: prettier.Options = {}): Promise<string> {
  return prettier.format(text, { parser: "lore", plugins: [plugin], ...options });
}

function firstReadmeSample(): string {
  const open = "```html\n";
  const start = readme.indexOf(open) + open.length;
  return readme.slice(start, readme.indexOf("\n```", start)) + "\n";
}

function flushLeft(text: string): string {
  return text.split("\n").map((line) => line.trimStart()).join("\n");
}

function markdown(text: string): Promise<string> {
  return prettier.format(text, { parser: "markdown", proseWrap: "preserve" });
}

async function comparable(model: DocumentModel) {
  const entries = await Promise.all(model.entries.map(async (entry) => {
    const { first, rest } = splitProse(entry.prose.split("\n"));
    return { ...entry, prose: { first, rest: rest === null ? null : await markdown(rest.join("\n")) } };
  }));
  const withoutLines = (list: Diagnostic[]) =>
    list.map(({ line: _line, range: _range, ...rest }) => JSON.stringify(rest)).sort();
  return { entries, errors: withoutLines(model.errors), warnings: withoutLines(model.warnings) };
}

async function formatInput(input: LoreInput): Promise<LoreInput> {
  const formatFiles = (files: InputFile[]) =>
    Promise.all(files.map(async (file) =>
      file.path.endsWith(".lore") ? { ...file, content: await format(file.content, { filepath: file.path }) } : file));
  return {
    ...input,
    repo: await formatFiles(input.repo),
    given: await Promise.all(input.given.map(async (folder) => ({ ...folder, files: await formatFiles(folder.files) }))),
  };
}

function loreFiles(input: LoreInput): InputFile[] {
  return [...input.repo, ...input.given.flatMap((folder) => folder.files)].filter((file) => file.path.endsWith(".lore"));
}

function commentTexts(content: string): string[] {
  const lore = parseFile("x.lore", content);
  return lore.nodes.flatMap((node) =>
    node.kind === "comment" ? [lore.text.lines.slice(node.openLine - 1, node.closeLine).join("\n")] : []);
}

describe("prettier plugin", () => {
  test("formats the README sample to the README layout", async () => {
    const sample = firstReadmeSample();
    expect(await format(flushLeft(sample))).toBe(sample);
    expect(await format(sample)).toBe(sample);
  });

  test("round-trips every conformance input", async () => {
    for (const example of examples) {
      const input = toInput(example);
      const formatted = await formatInput(input);
      const label = `example ${example.number}`;
      expect({ label, model: await comparable(parse(formatted)) })
        .toEqual({ label, model: await comparable(parse(input)) });
      const again = await formatInput(formatted);
      expect({ label, files: loreFiles(again) }).toEqual({ label, files: loreFiles(formatted) });
    }
  });

  test("keeps every top-level comment byte for byte", async () => {
    const written = [
      "<!-- Checkout rules, owned by the pricing team. -->  ",
      "<rule id=\"price-from-quote\" category=\"functional_correctness\">",
      "A displayed price must come from the quote that produced it.",
      "</rule>",
      "<!--",
      "    Drafts below,   kept for the pricing review.  ",
      "\t-->\t",
      "",
      "",
      "<!-- one --><!-- two -->",
    ].join("\n");
    const output = await format(written);
    expect(commentTexts(output)).toEqual(commentTexts(written));
    expect(commentTexts(written)).toHaveLength(3);

    for (const example of examples) {
      for (const file of loreFiles(toInput(example))) {
        const comments = commentTexts(file.content);
        if (comments.length === 0) continue;
        const out = await format(file.content, { filepath: file.path });
        for (const comment of comments) expect(out).toContain(comment);
      }
    }
  });

  test("returns a file with a file-level error unchanged", async () => {
    const written = [
      "<rule id=\"price-from-quote\"   category=\"functional_correctness\">",
      "      A displayed price must come from the quote that produced it.",
      "</rule>",
      "",
      "",
      "Rules below this line need review.",
      "<rule id=\"currency-from-settings\" category=\"functional_correctness\">",
      "Display text never hard-codes a currency code.",
      "</rule>",
      "",
    ].join("\n");
    expect(await format(written)).toBe(written);
    const badDefaults = "<defaults>\ncategory: [unclosed\n</defaults>\n\n\n<rule id=\"a\">\nText.\n</rule>\n";
    expect(await format(badDefaults)).toBe(badDefaults);
  });

  test("leaves an entry with an entry-level error as written", async () => {
    const broken = [
      "<rule severity=\"blocking\" id=\"currency-from-settings\" category=\"functional_correctness\">",
      "\tDisplay text never hard-codes a currency code.",
      "  It uses the shop's `currency` setting.",
      "</rule>",
    ].join("\n");
    const written = `${broken}\n<rule category="functional_correctness" id="price-from-quote">\nA displayed price must come from the quote.\n</rule>\n`;
    expect(await format(written)).toBe(
      `${broken}\n\n<rule id="price-from-quote" category="functional_correctness">\n  A displayed price must come from the quote.\n</rule>\n`,
    );
  });

  test("keeps a list directly under the first sentence in the summary", async () => {
    const written = [
      "<rule id=\"checkout-prices-from-quote\" category=\"functional_correctness\">",
      "Every price the checkout page shows comes from the quote:  ",
      "* each line item's price;",
      "* the order total.",
      "",
      "A helper that recomputes a price *from its inputs* drops:",
      "* quote-level discounts.",
      "</rule>",
    ].join("\n");
    expect(await format(written)).toBe([
      "<rule id=\"checkout-prices-from-quote\" category=\"functional_correctness\">",
      "  Every price the checkout page shows comes from the quote:  ",
      "  * each line item's price;",
      "  * the order total.",
      "",
      "  A helper that recomputes a price _from its inputs_ drops:",
      "",
      "  - quote-level discounts.",
      "</rule>",
      "",
    ].join("\n"));
  });

  test("uses a tab with useTabs", async () => {
    const sample = firstReadmeSample();
    const tabbed = sample.replace(/^ +/gm, (spaces) => "\t".repeat(spaces.length / 2));
    expect(await format(flushLeft(sample), { useTabs: true })).toBe(tabbed);
  });

  test("orders attributes and indents children, YAML and checks", async () => {
    const written = [
      "<scope>",
      "files:   [ \"src/**\" ]",
      "</scope>",
      "<rule disabled severity=\"blocking\" category=\"security\" id=\"no-eval\">",
      "",
      "<check   lang=\"regex\">",
      "eval\\(  ",
      "</check>",
      "<meta>",
      "owner: {team: 'web'}",
      "</meta>",
      "Code never calls `eval`.",
      "</rule>",
    ].join("\n");
    expect(await format(written)).toBe([
      "<scope>",
      "  files: [\"src/**\"]",
      "</scope>",
      "",
      "<rule id=\"no-eval\" category=\"security\" severity=\"blocking\" disabled>",
      "  <check lang=\"regex\">",
      "    eval\\(  ",
      "  </check>",
      "  <meta>",
      "    owner: { team: \"web\" }",
      "  </meta>",
      "  Code never calls `eval`.",
      "</rule>",
      "",
    ].join("\n"));
  });
});
