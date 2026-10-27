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
  return prettier.format(text, { parser: "markdown", proseWrap: "preserve", embeddedLanguageFormatting: "off" });
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

async function formatInput(input: LoreInput, options: prettier.Options = {}): Promise<LoreInput> {
  const formatFiles = (files: InputFile[]) =>
    Promise.all(files.map(async (file) =>
      file.path.endsWith(".lore") ? { ...file, content: await format(file.content, { ...options, filepath: file.path }) } : file));
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
    for (const embedded of ["auto", "off"] as const) {
      const options = { embeddedLanguageFormatting: embedded };
      for (const example of examples) {
        const input = toInput(example);
        const formatted = await formatInput(input, options);
        const label = `example ${example.number}, embedded ${embedded}`;
        expect({ label, model: await comparable(parse(formatted)) })
          .toEqual({ label, model: await comparable(parse(input)) });
        const again = await formatInput(formatted, options);
        expect({ label, files: loreFiles(again) }).toEqual({ label, files: loreFiles(formatted) });
      }
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
    ].join("\n");
    const output = await format(written);
    expect(output).toContain("\n  A displayed price must come from the quote that produced it.\n");
    expect(commentTexts(output)).toEqual(commentTexts(written));
    expect(commentTexts(written)).toHaveLength(2);

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
    const deep = `<scope>\nfiles: ${"[".repeat(10_000)}${"]".repeat(10_000)}\n</scope>\n\n<rule id="a">\nText.\n</rule>\n`;
    expect(await format(deep)).toBe(deep);
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

  test("keeps the prose as written when the Markdown printer would break a Lore fence", async () => {
    const rests = [
      "-\n  ```js\n  const x = 1;\n  ```",
      "1.\n   ```\n   x\n   ```",
      "~~~ a`b\nx\n~~~",
    ];
    for (const rest of rests) {
      const content = `<rule id="fenced" category="documentation">\nSummary.\n\n${rest}\n</rule>\n`;
      const input: LoreInput = { repo: [{ path: ".lore/docs.lore", content }], given: [], remotes: [] };
      const formatted = await formatInput(input);
      const model = parse(formatted);
      expect({ rest, errors: model.errors }).toEqual({ rest, errors: [] });
      expect(await comparable(model)).toEqual(await comparable(parse(input)));
      expect(loreFiles(await formatInput(formatted))).toEqual(loreFiles(formatted));
    }
  });

  test("keeps fenced code in the prose byte for byte", async () => {
    const written = [
      "<rule id=\"single-quotes\" category=\"code_style\">",
      "Strings use single quotes.",
      "",
      "```ts",
      "const s = 'x';",
      "if(x){y()}",
      "```",
      "</rule>",
    ].join("\n");
    expect(await format(written)).toContain("\n  ```ts\n  const s = 'x';\n  if(x){y()}\n  ```\n");
  });

  test("keeps a prose rest that starts indented as written", async () => {
    const written = [
      "<rule id=\"listed\" category=\"documentation\">",
      "Summary:",
      "- *one*",
      "",
      "  continues the *item*.",
      "</rule>",
    ].join("\n");
    expect(await format(written)).toBe([
      "<rule id=\"listed\" category=\"documentation\">",
      "  Summary:",
      "  - *one*",
      "",
      "    continues the *item*.",
      "</rule>",
      "",
    ].join("\n"));
  });

  test("lays out the file when embeddedLanguageFormatting is off", async () => {
    const sample = firstReadmeSample();
    const misordered = flushLeft(sample).replace(
      "<rule id=\"price-from-quote\" category=\"functional_correctness\" severity=\"blocking\">",
      "<rule severity=\"blocking\" category=\"functional_correctness\" id=\"price-from-quote\">",
    );
    expect(misordered).not.toBe(flushLeft(sample));
    expect(await format(misordered, { embeddedLanguageFormatting: "off" })).toBe(sample);

    const written = [
      "<scope>",
      "files:   [ \"src/**\" ]",
      "</scope>",
      "<rule category=\"security\" id=\"no-eval\">",
      "<meta>",
      "owner: {team: 'web'}",
      "list:",
      "  - a",
      "</meta>",
      "Code never calls `eval`.",
      "",
      "Use *Function* instead.",
      "</rule>",
    ].join("\n");
    expect(await format(written, { embeddedLanguageFormatting: "off" })).toBe([
      "<scope>",
      "  files:   [ \"src/**\" ]",
      "</scope>",
      "",
      "<rule id=\"no-eval\" category=\"security\">",
      "  <meta>",
      "    owner: {team: 'web'}",
      "    list:",
      "      - a",
      "  </meta>",
      "  Code never calls `eval`.",
      "",
      "  Use *Function* instead.",
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
