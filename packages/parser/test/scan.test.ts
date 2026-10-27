import { describe, expect, test } from "bun:test";
import { dedent, dedentEntry } from "../src/indent";
import { looksLikeTag, parseFile, readAttributes, type EntryNode } from "../src/scan";

const PATH = ".lore/checkout.lore";

function errorsOf(content: string): { name: string; line: number }[] {
  return parseFile(PATH, content).diagnostics.map(({ name, line }) => ({ name, line }));
}

function only(content: string): { name: string; line: number } {
  const errors = errorsOf(content);
  expect(errors).toHaveLength(1);
  return errors[0]!;
}

function entries(content: string): EntryNode[] {
  return parseFile(PATH, content).nodes.filter((n): n is EntryNode => n.kind === "entry");
}

describe("decoding", () => {
  test("CRLF file parses like its LF twin", () => {
    const lf = parseFile(PATH, "<rule id=\"a\">\nx\n</rule>\n");
    const crlf = parseFile(PATH, "<rule id=\"a\">\r\nx\r\n</rule>\r\n");
    expect(crlf.nodes).toEqual(lf.nodes);
    expect(crlf.diagnostics).toEqual(lf.diagnostics);
    expect(lf.nodes).toHaveLength(1);
  });

  test("a BOM is ignored", () => {
    const plain = parseFile(PATH, "<rule id=\"a\">\nx\n</rule>\n");
    const bom = parseFile(PATH, "\uFEFF<rule id=\"a\">\nx\n</rule>\n");
    expect(bom.text.hadBom).toBe(true);
    expect(bom.nodes).toEqual(plain.nodes);
    expect(bom.diagnostics).toEqual([]);
  });

  test("an invalid UTF-8 byte is unreadable-structure at its line", () => {
    expect(only("<rule id=\"a\">\nx \uDC00\n</rule>\n")).toEqual({ name: "unreadable-structure", line: 2 });
  });
});

describe("lines and tags", () => {
  test("looks like a tag", () => {
    expect(looksLikeTag("<details>")?.name).toBe("details");
    expect(looksLikeTag("  <rule id=\"a\">  ")).toMatchObject({ closing: false, name: "rule", attributes: { text: " id=\"a\"", offset: 7 } });
    expect(looksLikeTag("</when>")).toMatchObject({ closing: true, name: "when" });
    expect(looksLikeTag("<kbd>Esc</kbd>")).toBeNull();
    expect(looksLikeTag("<https://example.com>")).toBeNull();
    expect(looksLikeTag("<!-- note -->")).toBeNull();
    expect(looksLikeTag("<rule>>")).toBeNull();
    expect(looksLikeTag("<1rule>")).toBeNull();
  });

  test("an attribute list is read left to right and stops at the first invalid character", () => {
    expect(readAttributes(" id=\"a\" disabled  category=\"\"")).toEqual({
      attributes: [
        { name: "id", value: "a", offset: 1 },
        { name: "disabled", value: null, offset: 8 },
        { name: "category", value: "", offset: 18 },
      ],
      malformedAt: null,
      unfinished: null,
    });
    expect(readAttributes(" id=a")).toEqual({ attributes: [], malformedAt: 4, unfinished: { name: "id", value: null, offset: 1 } });
    expect(readAttributes(" id=\"a\" category=b")).toMatchObject({ attributes: [{ name: "id" }], malformedAt: 17 });
    expect(readAttributes(" id=\"a\"x")).toMatchObject({ malformedAt: 7, unfinished: null });
    expect(readAttributes(" id=\"a")).toMatchObject({ attributes: [], malformedAt: 6, unfinished: { name: "id" } });
    expect(readAttributes(" 1d=\"a\"")).toMatchObject({ malformedAt: 1 });
    expect(readAttributes("")).toEqual({ attributes: [], malformedAt: null, unfinished: null });
  });

  test("a closing tag at the top level is unreadable-structure", () => {
    expect(only("<rule id=\"a\">\nx\n</rule>\n</rule>\n")).toEqual({ name: "unreadable-structure", line: 4 });
  });

  test("a malformed closing tag is unreadable-structure", () => {
    expect(only("</rule x>\n")).toEqual({ name: "unreadable-structure", line: 1 });
  });
});

describe("top level", () => {
  test("stray text is top-level-text at the first stray line", () => {
    expect(only("<rule id=\"a\">\nx\n</rule>\n\nStray.\nMore.\n")).toEqual({ name: "top-level-text", line: 5 });
  });

  test("an indented line, even an indented tag, is top-level-text", () => {
    expect(only("  <rule id=\"a\">\nx\n</rule>\n")).toEqual({ name: "top-level-text", line: 1 });
  });

  test("text after a comment's --> is top-level-text on that line", () => {
    expect(only("<!-- one\ntwo --> three\n")).toEqual({ name: "top-level-text", line: 2 });
  });

  test("a comment with no --> is unreadable-structure where it opens", () => {
    expect(only("\n<!-- open\n<rule id=\"a\">\nx\n</rule>\n")).toEqual({ name: "unreadable-structure", line: 2 });
  });

  test("a comment's --> is searched after its <!--", () => {
    expect(only("<!-->\n")).toEqual({ name: "unreadable-structure", line: 1 });
    expect(errorsOf("<!---->\n")).toEqual([]);
  });

  test("an element the format does not define is unknown-element whatever follows its name", () => {
    expect(only("<notes>\nx\n</notes>\n")).toEqual({ name: "unknown-element", line: 1 });
    expect(only("<notes a=b>\n")).toEqual({ name: "unknown-element", line: 1 });
  });

  test("an element left open is unreadable-structure at its opening line", () => {
    expect(only("<scope>\nfiles: [\"**\"]\n  </scope>\n")).toEqual({ name: "unreadable-structure", line: 1 });
    expect(only("<rule id=\"a\">\nx\n")).toEqual({ name: "unreadable-structure", line: 1 });
  });

  test("a second file block of a kind is duplicate-file-block", () => {
    expect(only("<defaults>\n</defaults>\n<scope>\n</scope>\n<defaults>\n</defaults>\n")).toEqual({ name: "duplicate-file-block", line: 5 });
  });

  test("a file block after an entry is file-block-after-entry, checked before duplicate-file-block", () => {
    expect(only("<scope>\n</scope>\n<rule id=\"a\">\nx\n</rule>\n<scope>\n</scope>\n")).toEqual({ name: "file-block-after-entry", line: 6 });
  });

  test("a file block's position is checked before its attributes", () => {
    expect(only("<rule id=\"a\">\nx\n</rule>\n<defaults a=b>\n")).toEqual({ name: "file-block-after-entry", line: 4 });
  });

  test("a file block takes no attributes: a malformed list is invalid-attribute-value, a readable one unknown-attribute", () => {
    expect(only("<scope files=x>\n</scope>\n")).toEqual({ name: "invalid-attribute-value", line: 1 });
    expect(only("<scope files=\"x\" y=z>\n</scope>\n")).toEqual({ name: "unknown-attribute", line: 1 });
  });

  test("file blocks, entries and comments become nodes with their lines", () => {
    const file = parseFile(PATH, "<!-- a -->\n\n<defaults>\ncategory: security\n</defaults>\n<scope>\n  files: [\"**\"]\n</scope>\n<context id=\"c\">\nRead it.\n</context>\n");
    expect(file.diagnostics).toEqual([]);
    expect(file.nodes.map((n) => [n.kind, "openLine" in n ? n.openLine : null, "closeLine" in n ? n.closeLine : null])).toEqual([
      ["comment", 1, 1],
      ["block", 3, 5],
      ["block", 6, 8],
      ["entry", 9, 11],
    ]);
    expect(file.nodes[2]).toMatchObject({ name: "scope", body: ["  files: [\"**\"]"], attributes: { text: "", offset: 6 } });
    expect(file.nodes[3]!.range).toEqual({ start: { line: 8, character: 0 }, end: { line: 10, character: 10 } });
  });
});

describe("entries", () => {
  test("children carry name, raw attributes, body lines and lines; prose starts at the first other line", () => {
    const [entry] = entries("<rule id=\"a\">\n\n  <check lang=\"regex\">\n  'USD'\n  </check>\n  <when>\n  </when>\n  Prose <b>here</b>.\n  <when>\n</rule>\n");
    expect(entry!.children).toEqual([
      { name: "check", attributes: { text: " lang=\"regex\"", offset: 8 }, openLine: 3, closeLine: 5, body: ["  'USD'"], range: { start: { line: 2, character: 2 }, end: { line: 4, character: 10 } } },
      { name: "when", attributes: { text: "", offset: 7 }, openLine: 6, closeLine: 7, body: [], range: { start: { line: 5, character: 2 }, end: { line: 6, character: 9 } } },
    ]);
    expect(entry!.proseLine).toBe(8);
    expect(entry!.prose).toEqual(["  Prose <b>here</b>.", "  <when>"]);
    expect(entry!.closeLine).toBe(10);
  });

  test("an entry with no prose has proseLine null and no prose lines", () => {
    const [entry] = entries("<rule id=\"a\">\n<when>\n</when>\n\n</rule>\n");
    expect(entry!.proseLine).toBeNull();
    expect(entry!.prose).toEqual([]);
  });

  test("a comment line among the children starts the prose", () => {
    const [entry] = entries("<rule id=\"a\">\n<!-- c -->\n<when>\n</when>\n</rule>\n");
    expect(entry!.children).toEqual([]);
    expect(entry!.prose).toEqual(["<!-- c -->", "<when>", "</when>"]);
  });

  test("the entry's closing tag at column 0 ends the entry while a child is open: unreadable-structure at the child", () => {
    expect(only("<rule id=\"a\">\n<when>\nx\n</rule>\n")).toEqual({ name: "unreadable-structure", line: 2 });
  });

  test("a child still open at the end of the file is unreadable-structure at the child", () => {
    expect(only("<rule id=\"a\">\n<when>\nx\n")).toEqual({ name: "unreadable-structure", line: 2 });
  });

  test("a child named like the entry closes at an indented closing tag", () => {
    const [entry] = entries("<rule id=\"a\">\n<rule>\n  </rule>\nText.\n</rule>\n");
    expect(entry!.children.map((c) => [c.name, c.openLine, c.closeLine])).toEqual([["rule", 2, 3]]);
  });

  test("a closing tag among the children that closes no child is unreadable-structure", () => {
    expect(only("<rule id=\"a\">\n<when>\n</when>\n</when>\nx\n</rule>\n")).toEqual({ name: "unreadable-structure", line: 4 });
    expect(only("<rule id=\"a\">\n  </rule>\nx\n</rule>\n")).toEqual({ name: "unreadable-structure", line: 2 });
  });

  test("a malformed closing tag among the children is unreadable-structure", () => {
    expect(only("<rule id=\"a\">\n<when>\n</when>\n</when x>\nx\n</rule>\n")).toEqual({ name: "unreadable-structure", line: 4 });
  });

  test("inside an open child, only its exact closing tag has meaning", () => {
    const [entry] = entries("<rule id=\"a\">\n<check>\n</check x>\n</when>\n</check>\nx\n</rule>\n");
    expect(entry!.children[0]!.body).toEqual(["</check x>", "</when>"]);
  });

  test("a missing closing tag takes in the following entries as prose", () => {
    const file = parseFile(PATH, "<rule id=\"a\">\nA.\n\n<rule id=\"b\">\nB.\n</rule>\n");
    expect(file.diagnostics).toEqual([]);
    expect(file.nodes).toHaveLength(1);
    expect((file.nodes[0] as EntryNode).prose).toEqual(["A.", "", "<rule id=\"b\">", "B."]);
  });

  test("an indented closing tag in the prose is prose", () => {
    const [entry] = entries("<rule id=\"a\">\nA.\n  </rule>\nB.\n</rule>\n");
    expect(entry!.prose).toEqual(["A.", "  </rule>", "B."]);
  });

  test("a closing tag inside a backtick or tilde fence does not end the entry", () => {
    const [ticks] = entries("<rule id=\"a\">\nA.\n  ````js\n</rule>\n```\n  `````\n</rule>\n");
    expect(ticks!.prose).toEqual(["A.", "  ````js", "</rule>", "```", "  `````"]);
    const [tildes] = entries("<rule id=\"a\">\nA.\n~~~~\n~~~\n</rule>\n~~~~\n</rule>\n");
    expect(tildes!.closeLine).toBe(7);
  });

  test("a backtick line with another backtick after the run opens no fence", () => {
    const [entry] = entries("<rule id=\"a\">\nA.\n``` x ` y\n</rule>\n");
    expect(entry!.closeLine).toBe(4);
  });

  test("a fence opens when its info string holds a lone CR, U+2028 or U+2029", () => {
    for (const odd of ["\r", "\u2028", "\u2029"]) {
      const [ticks] = entries(`<rule id="a">\nA.\n\`\`\`js${odd}x\n</rule>\n\`\`\`\n</rule>\n`);
      expect(ticks!.closeLine).toBe(6);
      const [tildes] = entries(`<rule id="a">\nA.\n~~~${odd}x\n</rule>\n~~~\n</rule>\n`);
      expect(tildes!.closeLine).toBe(6);
    }
  });

  test("a fence that never closes runs to the end of the file", () => {
    expect(only("<rule id=\"a\">\nA.\n```\n</rule>\n")).toEqual({ name: "unreadable-structure", line: 1 });
  });

  test("a fence may open on the first prose line", () => {
    const [entry] = entries("<rule id=\"a\">\n```\n</rule>\n```\n</rule>\n");
    expect(entry!.prose).toEqual(["```", "</rule>", "```"]);
  });

  test("malformed attributes on an entry or child are not scan errors", () => {
    const file = parseFile(PATH, "<rule id=a>\n<check lang=regex>\nx\n</check>\n</rule>\n");
    expect(file.diagnostics).toEqual([]);
    expect(file.nodes[0]).toMatchObject({ attributes: { text: " id=a" }, children: [{ attributes: { text: " lang=regex" } }] });
  });
});

describe("indentation", () => {
  test("the common indentation is removed and blank lines become empty", () => {
    expect(dedent(["  a", "    b", "   ", "", "  c"])).toEqual({ lines: ["a", "  b", "", "", "c"], error: null });
    expect(dedent(["\t\ta", "\t\t  b"])).toEqual({ lines: ["a", "  b"], error: null });
    expect(dedent(["a", "  b"])).toEqual({ lines: ["a", "  b"], error: null });
    expect(dedent([" ", ""])).toEqual({ lines: ["", ""], error: null });
  });

  test("tabs and spaces with no common indentation are inconsistent-indentation", () => {
    expect(dedent(["\ta", "  b"]).error).toBe("inconsistent-indentation");
    expect(dedent(["\ta", "  b", "c"]).error).toBeNull();
  });

  test("a child's contents lose the entry's indentation, then the child's own", () => {
    const file = parseFile(PATH, "<rule id=\"a\">\n  <when>\n      x:\n        - y\n  </when>\n  Prose.\n\n    More.\n\n</rule>\n");
    const result = dedentEntry(file.text.lines, file.nodes[0] as EntryNode);
    expect(result).toEqual({ inconsistent: false, children: [{ lines: ["x:", "  - y"], inconsistent: false }], prose: ["Prose.", "", "  More.", ""] });
  });

  test("inconsistency is reported for the entry and for each child separately", () => {
    const entry = parseFile(PATH, "<rule id=\"a\">\n\tA.\n  B.\n</rule>\n");
    expect(dedentEntry(entry.text.lines, entry.nodes[0] as EntryNode).inconsistent).toBe(true);
    const child = parseFile(PATH, "<rule id=\"a\">\n<when>\n\tx: 1\n  y: 2\n</when>\nA.\n</rule>\n");
    const result = dedentEntry(child.text.lines, child.nodes[0] as EntryNode);
    expect(result.inconsistent).toBe(false);
    expect(result.children[0]!.inconsistent).toBe(true);
  });
});
