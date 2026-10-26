# Lore specification

Version 1. Status: draft.

## Introduction

Lore is a file format for the rules a team expects every change to its
code to follow. Each rule is a named entry with a scope (the files it can
be broken in), optional conditions on the change, a category and a
severity, followed by the rule itself in Markdown prose. Context entries
point a reviewer at background reading under the same kind of scope and
conditions.

This document specifies:

- where Lore files live and which ones a tool collects;
- how a `.lore` file is parsed into a document model;
- the `.loreconfig` file;
- which entries are eligible for a change, and which lines a check points
  a reviewer at.

It stops there. How a reviewer applies an eligible rule, and how a tool
reports the result, is outside this specification.

The specification is written in the style of the CommonMark
specification: normative prose, with numbered conformance examples inline
that any implementation can run. JSON Schemas for the structured blocks
and for the expected output of the examples are in [`schemas/`](schemas/).
The error and warning names are in [`errors.json`](errors.json).

## Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in BCP 14
([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119),
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)) when, and only when,
they appear in all capitals, as shown here.

A **tool** is any program that reads Lore files. A **conforming tool**
meets every requirement of this document that applies to what it does,
and passes every conformance example of each kind it implements (see
[Conformance examples](#conformance-examples)).

Terms used throughout:

- **Governed repo**: the repository whose change is being reviewed. Paths
  are relative to its root and separated by `/`.
- **Lore folder**: a directory named `.lore`.
- **Base**: the directory that contains a Lore file's Lore folder. When a
  path holds more than one Lore folder, the first one counted from the
  repository root decides (see [Files and folders](#files-and-folders)).
  Globs and plain `src` paths in the file resolve relative to the base.
- **External folder**: Lore kept outside the governed repo, in a
  directory tree that a `.loreconfig` `repo` key maps onto the governed
  repo (see [External folders](#external-folders)).
- **Lore root**: the directory where the upward lookup of `.loreconfig`
  files stops (see [.loreconfig](#loreconfig)).
- **Element**: a tagged section of a `.lore` file: an opening tag line,
  the lines of its contents, and a closing tag line.
- **File block**: a `<defaults>` or `<scope>` element at the top level of
  a file. It applies to every entry in that file.
- **Entry**: a `<rule>` or `<context>` element.
- **Change**: a set of changed files and, for each added, modified or
  renamed file, its added lines. A diff describes a change.
- **Eligible**: an entry is eligible for a change when it is not
  disabled, its scope matches at least one changed file that no
  `.loreconfig` `disable` list switches it off for, and its conditions
  hold (see [Eligibility](#eligibility)).
- **Error** and **warning**: problems a tool reports by name. An error
  excludes the file or entry it is found in; a warning excludes nothing.
- **Blank line**: a line that is empty or holds only spaces and tabs.
- **Column 0**: a line starts at column 0 when its first character is
  not a space or a tab.

## Conformance examples

Each conformance example gives inputs and the output a conforming tool
produces from them. There are two kinds:

- a **parse** example gives Lore files, and expects the document model a
  tool builds from them;
- an **eligibility** example also gives a change, and expects the
  eligible entries, the check hits, the excluded files and entries, and
  the warnings.

An example is a fenced block. Its opening line starts at column 0 and is
exactly six backticks, directly followed by `example`, one or more spaces
or tabs, and the kind: `parse` or `eligibility`. Its closing line is
exactly six backticks. An opening line inside another fenced block does
not start an example. Six backticks let an example's inputs hold
ordinary fenced code blocks. Examples are numbered in document order,
starting at 1, and belong to the section under the nearest heading
before them.

Lines of the form `requires: <capability>` may directly follow the
opening line. The only capability defined is `ast-grep`: a tool that does
not support `ast-grep` checks skips examples that require it.

The rest of the example is a series of sections. Each starts with a line
`=== ` followed by a name, and runs to the next such line or to the end
of the example:

| Section | Contents |
|---|---|
| `=== <path>` | An input file at `<path>` in the governed repo: the section's lines, joined with line feeds. |
| `=== external:<path>` | An input file at `<path>` in the external repository described below. |
| `=== remote` | Eligibility only, optional. One line: the governed repo's remote URL, used to match `repo` keys. Without it, and in every parse example, the remote is `https://github.com/acme/shop`. |
| `=== diff` | Eligibility only, required. The change, in the format below. |
| `=== expect` | The expected output, as JSON. |

The diff has one line per changed file, each optionally followed by that
file's added lines:

- `A <path>`, `M <path>` and `D <path>`: a file added, modified or
  deleted.
- `R <old> -> <new>`: a file renamed from `<old>` to `<new>`.
- `+<n> <text>`: an added line. Line `<n>` (counted from 1) of the file
  named by the nearest `A`, `M` or `R` line above it (for a rename, the
  new path) is `<text>`, which is everything after the single space that
  follows `<n>`.

A `+` line follows an `A`, `M` or `R` line directly or after other `+`
lines; a `+` line anywhere else, such as after a `D` line, is malformed.
A diff has no blank lines. Any line of a changed file that is not listed
as an added line is unchanged.

**What the governed repo contains.** The governed repo contains exactly
the `=== <path>` input files and every path the diff adds, modifies or
renames to, and all of them are tracked by version control. A changed
file that is not also an input file has unknown content apart from its
added lines. When a changed file is also an input file, each of its
`+<n> <text>` lines equals line `<n>` of that input.

**External inputs.** The `=== external:<path>` input files are the
tracked files of one other repository, and the tool was given that
repository's root as an external folder. Each `<path>` is relative to
that repository's root.

**Expected output.** A parse example's expect is a document model,
valid against
[`document-model.schema.json`](schemas/document-model.schema.json). An
eligibility example's expect is an eligibility result, valid against
[`eligibility.schema.json`](schemas/eligibility.schema.json).
[Document model](#document-model) defines every field. A tool's output
matches the expect when the two are equal as JSON values: arrays compare
item by item in order (see Order below), and objects compare regardless
of the order of their members. In both kinds:

- **Paths.** Every `file` field is the input path exactly as written after
  `=== `, keeping the `external:` prefix.
- **Scopes.** Globs in an entry's `scopes` are resolved to paths from the
  governed repo's root: a glob `g` in a file whose base is `b` appears as
  `b/g`, and a glob in a file whose base is the repo root appears as `g`.
  Globs in external files resolve through their `repo` mapping.
- **Diagnostic lines.** A diagnostic's `line` counts from 1 within its
  file. For a YAML problem (`invalid-yaml`, `duplicate-key`,
  `yaml-feature-not-allowed`) it is the offending line, counted in the
  file, not the block (see [Structured blocks](#structured-blocks)). For
  `top-level-text` it is the first stray line. For a problem outside any
  element, such as a closing tag with no opening tag, an invalid UTF-8
  byte or an unclosed comment, it is the offending line (for an unclosed
  comment, the line where the comment opens). For a `.loreconfig`
  problem it is the offending key's line. For any other problem in an
  element it is the opening tag line of the element at fault. A problem
  with no line has line 1.
- **Diagnostic entry.** A diagnostic's `entry` is the id of the entry the
  problem is in, when that entry has a readable id. It is null otherwise,
  and always null for a file-level error.
- **Prose and summary** are computed as [Entries](#entries) defines.
- **Hits.** A hit's `line` is the `+<n>` line number from the diff, and
  its `text` is that line's text.
- **Order.** Entries are ordered by `file`, then by position in the file.
  Diagnostics are ordered by `file`, then `line`, then `name`. `eligible`
  is in ascending order, and hits are ordered by `rule`, then `file`,
  then `line`. Strings compare code point by code point.

For illustration, here is an eligibility example as it is written in this
document. It is shown inside a longer fence, so it is not numbered or
run:

```````
``````example eligibility
=== .lore/rules.lore
<rule id="currency-from-settings" category="functional_correctness">
<when>
addedContains: ["'USD'"]
</when>
Display text never hard-codes a currency code.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
+12 const label = 'USD'
=== expect
{ "eligible": ["currency-from-settings"], "hits": [], "excluded": [], "warnings": [] }
``````
```````

## Files and folders

A **Lore file** is a file whose name ends in `.lore` and that sits inside
a Lore folder, directly or in a subfolder. A Lore folder MAY sit in any
directory of a repository.

- The base of a Lore file is the directory that contains the first Lore
  folder on its path, counted from the repository root. Subfolders inside
  a Lore folder group files and change nothing, including the base.
- A file whose name ends in `.lore` but that is not inside a Lore folder
  is not a Lore file, and a tool MUST NOT collect it. Files in a Lore
  folder whose names do not end in `.lore` are not Lore files either, and
  a tool MUST ignore them.
- A set of entries MAY be one file or many. A tool MUST NOT give the split
  any meaning, except that a file block applies only to the file it is
  in.
- Which Lore files a tool collects is defined in
  [Collecting files](#collecting-files).

A Lore file is UTF-8 text. A tool MUST ignore a byte order mark at the
start of a file, and MUST treat a carriage return directly before a line
feed as part of the line break. A file that is not valid UTF-8 is
`unreadable-structure`, a file-level error at the line of the first
invalid byte.

The smallest useful Lore file holds one rule. Its prose's first paragraph
is its summary, with the paragraph's lines joined by spaces:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness" severity="blocking">
A displayed price must come from the quote
that produced it.

Recomputing a price from its inputs drops quote-level discounts, so the
customer sees one total and is charged another.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "blocking", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote\nthat produced it.\n\nRecomputing a price from its inputs drops quote-level discounts, so the\ncustomer sees one total and is charged another.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

A subfolder inside a Lore folder does not move the base. These globs
resolve from `apps/web/src/checkout/`, the directory that contains the
Lore folder, not from the `pricing/` subfolder:

``````example parse
=== apps/web/src/checkout/.lore/pricing/quotes.lore
<scope>
files: ["**/*.tsx"]
ignores: ["**/*.test.tsx"]
</scope>

<rule id="quote-expiry-shown" category="functional_correctness">
A checkout page that shows a quoted price also shows when the quote
expires.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "quote-expiry-shown", "file": "apps/web/src/checkout/.lore/pricing/quotes.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**/*.tsx"], "ignores": ["apps/web/src/checkout/**/*.test.tsx"] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A checkout page that shows a quoted price also shows when the quote expires.",
      "prose": "A checkout page that shows a quoted price also shows when the quote\nexpires.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

A `.lore` file outside any Lore folder is not collected, and neither is a
file in a Lore folder without the `.lore` extension. Only the rule in
`.lore/checkout.lore` is eligible:

``````example eligibility
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== .lore/README.md
<rule id="readme-rule" category="documentation">
This file is not a Lore file.
</rule>
=== apps/web/src/checkout/rules.lore
<rule id="totals-from-quote" category="functional_correctness">
Cart totals come from the quote, never from summing line items.
</rule>
=== diff
M apps/web/src/checkout/CartTotal.tsx
+42 const total = items.reduce((sum, item) => sum + item.price, 0)
=== expect
{ "eligible": ["price-from-quote"], "hits": [], "excluded": [], "warnings": [] }
``````

## Parsing

A tool reads a Lore file from top to bottom, one top-level element at a
time, and interprets each element as it reads it. Every error found
while parsing a Lore file is either file-level or entry-level;
[Error reach](#error-reach) lists which is which, and the sections below
say so for the errors they define.

- A file-level error excludes the whole file. The document model MUST
  list that error and nothing else from the file: no entries, no other
  errors and no warnings. When a file has several file-level errors, the
  one listed is the first that a top-to-bottom reading meets.
- An entry-level error excludes only its entry. The document model MUST
  list that error and nothing else from the entry. When an entry has
  several errors, the one listed is the first met reading the entry from
  top to bottom: its opening tag, then its indentation, then its
  children in order.
- A tool MAY show a user more problems than the document model lists.

Each file here has two problems, and only the first is listed. The first
file is excluded whole; in the second, only the broken rule is excluded:

``````example parse
=== .lore/checkout.lore
Checkout rules.

<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<notes>
Ask the pricing team before adding rules here.
</notes>
=== .lore/display.lore
<rule id="currency-from-settings" category="functional_correctness">
<scope>
files: ["**/*.tsx"]
files: ["**/*.ts"]
</scope>
<when>
addedContains: &codes ["'USD'"]
</when>
Display text never hard-codes a currency code.
</rule>

<rule id="dates-from-locale" category="functional_correctness">
Displayed dates are formatted with the shop's locale.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "dates-from-locale", "file": ".lore/display.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Displayed dates are formatted with the shop's locale.",
      "prose": "Displayed dates are formatted with the shop's locale.",
      "src": null
    }
  ],
  "errors": [
    { "name": "top-level-text", "file": ".lore/checkout.lore", "entry": null, "line": 1 },
    { "name": "duplicate-key", "file": ".lore/display.lore", "entry": "currency-from-settings", "line": 4 }
  ],
  "warnings": []
}
``````

### Lines and tags

The structure of a Lore file is carried by **tag lines**. A tag line
holds one opening tag or one closing tag and nothing else, apart from
the leading spaces and tabs a position allows and any trailing spaces
and tabs.

- An **opening tag** is `<`, an element name, an attribute list, and
  `>`. The **attribute list** is zero or more attributes, each preceded
  by one or more spaces or tabs, followed by optional spaces or tabs.
- An **attribute** is `name="value"`, where the value is any characters
  other than `"` and MAY be empty, or a bare `name` (a boolean
  attribute).
- A **closing tag** is `</`, an element name, and `>`.
- Element and attribute names are ASCII letters, digits and `-`, and
  start with a letter. Names are case-sensitive.

A line **looks like a tag** when, ignoring leading and trailing spaces
and tabs, it starts with `<` or `</` and a name, followed either by `>`
as the line's last character, or by a space or a tab with the line
ending in `>`. So `<details>` and `<rule id="a">` look like tags, while
`<kbd>Esc</kbd>` and `<https://example.com>` do not.

Where a tag line can appear (at column 0 at the top level, and among an
entry's children), a line that looks like a tag is read as one:

- A line that starts with `</` MUST be exactly a closing tag. Otherwise
  it is `unreadable-structure`, a file-level error.
- A line that starts with `<` is an opening tag. Its element name is
  always readable, so the element's extent is known. The name is checked
  first: at the top level, a name the format does not define is
  `unknown-element` whatever follows it.
- If the text between the name and the final `>` is not a valid
  attribute list, the attributes are malformed: `invalid-attribute-value`.
  On an entry or one of its children this is an entry-level error; on a
  file block it is file-level.
- The `entry` of that error is the entry's id when, reading the attribute
  list from left to right, a well-formed `id` attribute whose value
  matches the id pattern (see [Rules](#rules)) comes before the first
  character at which the list stops being valid. Otherwise it is null.

Element contents and attribute values are raw text. A tool MUST NOT
decode entities or process escapes in either: `&amp;` stays `&amp;`.

An unquoted attribute value is malformed. The element's extent is still
known, so only that entry is excluded. In the second rule the id is
read before the malformed value, so the error names it:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<rule id=currency-from-settings category="functional_correctness">
Display text never hard-codes a currency code.
</rule>

<rule id="dates-from-locale" category=functional_correctness>
Displayed dates are formatted with the shop's locale.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote that produced it.",
      "src": null
    }
  ],
  "errors": [
    { "name": "invalid-attribute-value", "file": ".lore/checkout.lore", "entry": null, "line": 5 },
    { "name": "invalid-attribute-value", "file": ".lore/checkout.lore", "entry": "dates-from-locale", "line": 9 }
  ],
  "warnings": []
}
``````

Contents are raw text, so the condition looks for the five characters
`&amp;`, and the prose keeps them as written:

``````example parse
=== .lore/catalog.lore
<rule id="names-stored-unescaped" category="functional_correctness">
<when>
addedContains: ["&amp;"]
</when>
Product names are stored as written: `Fish & Chips`, never `Fish &amp; Chips`.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "names-stored-unescaped", "file": ".lore/catalog.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": { "addedContains": ["&amp;"] }, "checks": [], "meta": null,
      "summary": "Product names are stored as written: `Fish & Chips`, never `Fish &amp; Chips`.",
      "prose": "Product names are stored as written: `Fish & Chips`, never `Fish &amp; Chips`.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

### Top level

At the top level, a file holds file blocks, entries, comments and blank
lines:

| Element | Count |
|---|---|
| `<defaults>` | 0 or 1, before the first entry (see [Defaults](#defaults)) |
| `<scope>` | 0 or 1, before the first entry (see [Scope and globs](#scope-and-globs)) |
| `<rule>` | any number (see [Rules](#rules)) |
| `<context>` | any number (see [Context](#context)) |
| `<!-- -->` comment | any number |

- Top-level tag lines and comments MUST start at column 0.
- An element runs from its opening tag line to the next line at column 0
  that is its closing tag (for an entry, as [Entries](#entries) refines).
  The lines strictly between are its contents. An element with no
  closing tag before the end of the file is `unreadable-structure`.
- A **comment** starts with `<!--` at column 0 and ends at the first
  `-->` after it, on the same line or a later one. The rest of the line
  after `-->` MUST be blank. A tool MUST ignore comments. A comment with no
  `-->` is `unreadable-structure`.
- Blank lines MAY appear between elements.
- Any other non-blank line at the top level is `top-level-text`,
  including an indented line and text after a comment's `-->`.
- An opening tag whose name is not `defaults`, `scope`, `rule` or
  `context` is `unknown-element`. A closing tag at the top level, outside
  any element, is `unreadable-structure`.
- A `<defaults>` or `<scope>` after the first entry is
  `file-block-after-entry`. Otherwise, a second `<defaults>` or a second
  `<scope>` is `duplicate-file-block`. Position is checked first, so a
  second `<scope>` after an entry is `file-block-after-entry`.
- Every error in this section is file-level.

Text between two entries excludes the file. The error is reported at the
first stray line:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

Rules below this line need review.

<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code.
</rule>
=== expect
{
  "entries": [],
  "errors": [
    { "name": "top-level-text", "file": ".lore/checkout.lore", "entry": null, "line": 5 }
  ],
  "warnings": []
}
``````

An element the format does not define excludes the file:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<notes>
Ask the pricing team before adding rules here.
</notes>
=== expect
{
  "entries": [],
  "errors": [
    { "name": "unknown-element", "file": ".lore/checkout.lore", "entry": null, "line": 5 }
  ],
  "warnings": []
}
``````

A rule left open at the end of the file, and a closing tag with no
opening tag, each make the structure unreadable:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code.
=== .lore/display.lore
<rule id="dates-from-locale" category="functional_correctness">
Displayed dates are formatted with the shop's locale.
</rule>
</rule>
=== expect
{
  "entries": [],
  "errors": [
    { "name": "unreadable-structure", "file": ".lore/checkout.lore", "entry": null, "line": 5 },
    { "name": "unreadable-structure", "file": ".lore/display.lore", "entry": null, "line": 4 }
  ],
  "warnings": []
}
``````

A file has at most one `<scope>`:

``````example parse
=== .lore/checkout.lore
<scope>
files: ["**/*.tsx"]
</scope>

<scope>
ignores: ["**/*.test.tsx"]
</scope>

<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== expect
{
  "entries": [],
  "errors": [
    { "name": "duplicate-file-block", "file": ".lore/checkout.lore", "entry": null, "line": 5 }
  ],
  "warnings": []
}
``````

A file block comes before every entry. The file is excluded, so the rule
before the block is not listed, and neither is the warning its missing
category would raise:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote">
A displayed price must come from the quote that produced it.
</rule>

<defaults>
category: functional_correctness
</defaults>
=== expect
{
  "entries": [],
  "errors": [
    { "name": "file-block-after-entry", "file": ".lore/checkout.lore", "entry": null, "line": 5 }
  ],
  "warnings": []
}
``````

A second `<scope>` that also comes after an entry breaks both rules.
Position is checked first:

``````example parse
=== .lore/checkout.lore
<scope>
files: ["**/*.tsx"]
</scope>

<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<scope>
ignores: ["**/*.test.tsx"]
</scope>
=== expect
{
  "entries": [],
  "errors": [
    { "name": "file-block-after-entry", "file": ".lore/checkout.lore", "entry": null, "line": 9 }
  ],
  "warnings": []
}
``````

### Entries

An entry's contents are its **children**, then its **prose**. A tool
reads them line by line after the opening tag:

1. **Children.** Blank lines are skipped, and the entry's closing tag at
   column 0 ends the entry. Any other line that looks like a tag,
   ignoring leading spaces and tabs, is a child's opening or closing tag.
   An opening tag opens a child element, which runs to the next line
   that, ignoring leading and trailing spaces and tabs, is the child's
   closing tag. While a child is open, the entry's closing tag at column
   0 still ends the entry, even when the child has the same name as the
   entry; the child is then unclosed: `unreadable-structure`. A child
   still open at the end of the file is unclosed too. A closing tag that
   closes no child is `unreadable-structure`. Which children an entry
   allows is defined in [Rules](#rules) and [Context](#context).
2. **Prose.** The first line that is neither blank nor looks like a tag
   starts the prose. From there on, the only line with meaning is the
   entry's closing tag (`</rule>` or `</context>`) at column 0. Every
   other line, tag-shaped or not, is prose. A comment line among the
   children starts the prose, since comments are recognized only at the
   top level.
3. **Fences.** Inside a fenced code block in the prose, the closing tag
   is not recognized either, so a rule can show Lore syntax. A fence
   opens at a prose line whose first characters after any spaces and tabs
   are three or more backticks, with no further backtick on the line, or
   three or more tildes. It closes at the next line that, ignoring
   leading and trailing spaces and tabs, is a run of the same character
   at least as long. A fence that never closes runs to the end of the
   file. This rule follows CommonMark's fenced code blocks but ignores
   their indentation limit, and decides only where the entry ends.
4. To keep a closing-tag line in the prose outside a fence, indent it.

A note for authors: the first line of the prose must not look like a
tag. A prose that opens with a lone HTML tag line, such as `<details>`
or `<a href="#quotes">`, has that line read as a child, at any
indentation. Start the prose with text instead.

The entry ends at its closing tag. If the end of the file comes first,
the entry is `unreadable-structure`. An entry whose closing tag is
missing therefore takes in every following entry, as prose, up to the
next closing tag of its kind at column 0. Every error in this section is
file-level.

A child's contents are the lines strictly between its tags, after the
entry's common indentation and then the child's own are removed (see
[Indentation](#indentation)).

The entry's **prose** is its lines from the first prose line up to the
closing tag, after the entry's common indentation is removed, with
trailing blank lines dropped, joined with line feeds. Every other byte is
kept as written. An entry with no prose has prose `""`.

The entry's **summary** is the first paragraph of its prose: the prose
lines before the first blank line, each with leading and trailing spaces
and tabs removed, joined with single spaces. The paragraph is found by
lines, not by parsing Markdown. An entry with no prose has summary `""`.

Once the prose starts, tag-shaped lines are prose. This `<when>` is part
of the rule's text, not a condition:

``````example parse
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code.

<when>
addedContains: ["'USD'"]
</when>
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "currency-from-settings", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Display text never hard-codes a currency code.",
      "prose": "Display text never hard-codes a currency code.\n\n<when>\naddedContains: [\"'USD'\"]\n</when>",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

A closing tag inside a fenced code block in the prose does not end the
rule:

``````example parse
=== .lore/docs.lore
<rule id="lore-samples-fenced" category="documentation">
Lore syntax shown in a rule's prose sits in a fenced code block, so its
closing tags do not end the rule.

```
<rule id="price-from-quote">
A displayed price must come from the quote that produced it.
</rule>
```
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "lore-samples-fenced", "file": ".lore/docs.lore",
      "category": "documentation", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Lore syntax shown in a rule's prose sits in a fenced code block, so its closing tags do not end the rule.",
      "prose": "Lore syntax shown in a rule's prose sits in a fenced code block, so its\nclosing tags do not end the rule.\n\n```\n<rule id=\"price-from-quote\">\nA displayed price must come from the quote that produced it.\n</rule>\n```",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

An indented closing tag outside a fence is prose too:

``````example parse
=== .lore/docs.lore
<rule id="closing-tags-at-column-zero" category="documentation">
An entry ends at its closing tag at column 0. An indented closing tag,
like the next line, is prose:

  </rule>

The rule continues here.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "closing-tags-at-column-zero", "file": ".lore/docs.lore",
      "category": "documentation", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "An entry ends at its closing tag at column 0. An indented closing tag, like the next line, is prose:",
      "prose": "An entry ends at its closing tag at column 0. An indented closing tag,\nlike the next line, is prose:\n\n  </rule>\n\nThe rule continues here.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

A comment at the top level is ignored. Inside an entry, a comment line
starts the prose, so in the second rule the `<when>` after the comment
is prose and the rule has no condition:

``````example parse
=== .lore/checkout.lore
<!-- Checkout rules, owned by the pricing team. -->

<rule id="price-from-quote" category="functional_correctness">
<!-- Agreed in the 2026 pricing review. -->
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness">
<!-- Check new code only. -->
<when>
addedContains: ["'USD'"]
</when>
Display text never hard-codes a currency code.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "<!-- Agreed in the 2026 pricing review. --> A displayed price must come from the quote that produced it.",
      "prose": "<!-- Agreed in the 2026 pricing review. -->\nA displayed price must come from the quote that produced it.",
      "src": null
    },
    {
      "kind": "rule", "id": "currency-from-settings", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "<!-- Check new code only. --> <when> addedContains: [\"'USD'\"] </when> Display text never hard-codes a currency code.",
      "prose": "<!-- Check new code only. -->\n<when>\naddedContains: [\"'USD'\"]\n</when>\nDisplay text never hard-codes a currency code.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

An entry with no prose has empty prose and summary:

``````example parse
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
<when>
addedContains: ["'USD'"]
</when>
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "currency-from-settings", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": { "addedContains": ["'USD'"] }, "checks": [], "meta": null,
      "summary": "",
      "prose": "",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

A child left open when the entry's closing tag arrives is unclosed, and
the file is excluded. In the second file, the `<rule>` line among the
children opens a child, and the `</rule>` at column 0 ends the entry,
not that child:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness">
<when>
addedContains: ["'USD'"]
</rule>
=== .lore/display.lore
<rule id="dates-from-locale" category="functional_correctness">
<rule id="times-from-locale" category="functional_correctness">
Displayed times are formatted with the shop's locale.
</rule>
=== expect
{
  "entries": [],
  "errors": [
    { "name": "unreadable-structure", "file": ".lore/checkout.lore", "entry": null, "line": 6 },
    { "name": "unreadable-structure", "file": ".lore/display.lore", "entry": null, "line": 2 }
  ],
  "warnings": []
}
``````

A closing tag among the children that closes no child excludes the
file:

``````example parse
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
<when>
addedContains: ["'USD'"]
</when>
</when>
Display text never hard-codes a currency code.
</rule>
=== expect
{
  "entries": [],
  "errors": [
    { "name": "unreadable-structure", "file": ".lore/checkout.lore", "entry": null, "line": 5 }
  ],
  "warnings": []
}
``````

A rule whose closing tag is missing takes in the next rule as prose. No
error is reported, because the second `</rule>` closes the first rule:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.

<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote that produced it.\n\n<rule id=\"currency-from-settings\" category=\"functional_correctness\">\nDisplay text never hard-codes a currency code.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

### Indentation

Indentation inside an element carries no meaning, so an indented file
and a flush-left file mean the same thing.

- An element's **common indentation** is the longest string of spaces
  and tabs that begins every non-blank line of its contents. Before
  interpreting an element's contents, a tool MUST remove the common
  indentation from every non-blank line and make every blank line empty.
- This applies to every element: file blocks, entries and children. A
  child's contents have the entry's common indentation removed first,
  then the child's own.
- Spaces and tabs both work, but MUST NOT be mixed: when an element's
  contents have at least one non-blank line, every non-blank line begins
  with a space or a tab, and the lines have no common indentation, the
  element is
  `inconsistent-indentation`. In a file block it is a file-level error;
  in an entry or one of its children, an entry-level error.
- YAML does not allow tabs for nesting, so nested YAML uses spaces after
  the common indentation.

The same rule written flush-left, indented with spaces and indented with
tabs gives the same model in all three files, apart from the id:

``````example parse
=== .lore/flush.lore
<scope>
files: ["apps/web/src/checkout/**"]
</scope>

<rule id="currency-flush" category="functional_correctness">
<when>
addedContains:
  - "'USD'"
</when>
Display text never hard-codes a currency code.

It uses the shop's `currency` setting.
</rule>
=== .lore/indented.lore
<scope>
  files: ["apps/web/src/checkout/**"]
</scope>

<rule id="currency-indented" category="functional_correctness">
  <when>
    addedContains:
      - "'USD'"
  </when>
  Display text never hard-codes a currency code.

  It uses the shop's `currency` setting.
</rule>
=== .lore/tabs.lore
<scope>
	files: ["apps/web/src/checkout/**"]
</scope>

<rule id="currency-tabs" category="functional_correctness">
	<when>
		addedContains:
		  - "'USD'"
	</when>
	Display text never hard-codes a currency code.

	It uses the shop's `currency` setting.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "currency-flush", "file": ".lore/flush.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**"], "ignores": [] }],
      "when": { "addedContains": ["'USD'"] }, "checks": [], "meta": null,
      "summary": "Display text never hard-codes a currency code.",
      "prose": "Display text never hard-codes a currency code.\n\nIt uses the shop's `currency` setting.",
      "src": null
    },
    {
      "kind": "rule", "id": "currency-indented", "file": ".lore/indented.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**"], "ignores": [] }],
      "when": { "addedContains": ["'USD'"] }, "checks": [], "meta": null,
      "summary": "Display text never hard-codes a currency code.",
      "prose": "Display text never hard-codes a currency code.\n\nIt uses the shop's `currency` setting.",
      "src": null
    },
    {
      "kind": "rule", "id": "currency-tabs", "file": ".lore/tabs.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**"], "ignores": [] }],
      "when": { "addedContains": ["'USD'"] }, "checks": [], "meta": null,
      "summary": "Display text never hard-codes a currency code.",
      "prose": "Display text never hard-codes a currency code.\n\nIt uses the shop's `currency` setting.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

One line indented with a tab and another with spaces leave no common
indentation. Only that rule is excluded:

``````example parse
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
	Display text never hard-codes a currency code.
  It uses the shop's `currency` setting.
</rule>

<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote that produced it.",
      "src": null
    }
  ],
  "errors": [
    { "name": "inconsistent-indentation", "file": ".lore/checkout.lore", "entry": "currency-from-settings", "line": 1 }
  ],
  "warnings": []
}
``````

### Structured blocks

`<defaults>`, `<scope>`, `<when>` and `<meta>` are **structured
blocks**, and so is a `.loreconfig` file. Their contents, after
[Indentation](#indentation), are YAML 1.2 read with the core schema.
JSON is valid YAML 1.2, so a block MAY be written in JSON, and files MAY
mix the two. A tool reads a block as one YAML document, with these
rules:

- A block with no content other than blank lines and comments is an
  empty mapping.
- Anchors (`&name`), aliases (`*name`) and directives (`%YAML`) are
  `yaml-feature-not-allowed`. So is every tag, custom or standard:
  `!money` and `!!str` alike.
- Every mapping key MUST be a string, and every value MUST have a JSON
  equivalent. A key that is not a string (such as `2026:`, which the
  core schema reads as a number) is `yaml-feature-not-allowed`, and so
  are the values `.inf`, `-.inf` and `.nan`.
- A key that appears twice in one mapping is `duplicate-key`. Keys are
  compared after quoting is resolved, so `files` and `"files"` are the
  same key.
- Comments start with `#`, as in YAML. `//` does not start a comment, so
  JSONC comments are not accepted: one is ordinary text, which usually
  makes the block `invalid-yaml`. A trailing comma in a flow sequence or
  flow mapping is allowed, as YAML 1.2 allows it.
- Anything else that is not one well-formed YAML 1.2 document, such as a
  bad escape, an alias to an anchor that is never defined, or a second
  document, is `invalid-yaml`.

A tool checks a block in this order, and reports the first problem it
finds: `inconsistent-indentation`; then `invalid-yaml`; then
`duplicate-key` and `yaml-feature-not-allowed`, whichever starts first
in the block by character position (a repeated key at its second
occurrence, a feature at its first character); then the checks that the
block's own section defines. The line of a YAML problem is the line,
counted in the file, that holds:

- for `invalid-yaml`, the first character at which the block stops being
  a well-formed document (the alias, for an undefined alias). When the
  block ends before the document is complete, as with an unclosed flow
  sequence or quoted string, the line is the block's closing tag line;
- for `duplicate-key`, the key's second occurrence;
- for `yaml-feature-not-allowed`, the first feature that is not allowed.

A problem in a file block is a file-level error. A problem in a child
element is an entry-level error. In the document model, a block's value
is the parsed YAML as JSON.

These YAML rules catch authors out, so each has an example below:

- An unquoted value that starts with a YAML indicator character, such
  as `*`, `&`, `!`, `[` or `{`, is not read as plain text: `**/*.ts` is
  an alias. Inside a flow sequence, an unquoted value also ends at `,`
  and cannot hold `[`, `]`, `{` or `}`, so `[src/*.{ts,tsx}]` breaks.
  Quote globs.
- In double quotes, a backslash starts an escape, and `"\d"` is not a
  valid one. Write regular expressions in single quotes, where a
  backslash is an ordinary character.
- ` #` starts a comment, even in the middle of an unquoted value.
- Inside a flow sequence, an unquoted `[` starts a nested sequence, so a
  regular expression with a character class needs quotes.

The same scope, written in JSON in one file and in YAML in another,
gives the same model. In the YAML block sequence, `apps/web/**/*.tsx`
needs no quotes, while `**/*.test.tsx` does, since it starts with `*`:

``````example parse
=== .lore/json.lore
<scope>
{ "files": ["apps/web/**/*.tsx"], "ignores": ["**/*.test.tsx"] }
</scope>

<rule id="labels-from-messages" category="accessibility">
Visible labels come from the message catalog, never from string literals.
</rule>
=== .lore/yaml.lore
<scope>
files:
  - apps/web/**/*.tsx
ignores: ['**/*.test.tsx']
</scope>

<rule id="errors-from-messages" category="accessibility">
Error messages come from the message catalog, never from string literals.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "labels-from-messages", "file": ".lore/json.lore",
      "category": "accessibility", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/**/*.tsx"], "ignores": ["**/*.test.tsx"] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Visible labels come from the message catalog, never from string literals.",
      "prose": "Visible labels come from the message catalog, never from string literals.",
      "src": null
    },
    {
      "kind": "rule", "id": "errors-from-messages", "file": ".lore/yaml.lore",
      "category": "accessibility", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/**/*.tsx"], "ignores": ["**/*.test.tsx"] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Error messages come from the message catalog, never from string literals.",
      "prose": "Error messages come from the message catalog, never from string literals.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

An anchor is not allowed, even one that no alias uses. The error is in a
child, so only that rule is excluded:

``````example parse
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
<when>
addedContains: &codes ["'USD'", "'EUR'"]
</when>
Display text never hard-codes a currency code.
</rule>

<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote that produced it.",
      "src": null
    }
  ],
  "errors": [
    { "name": "yaml-feature-not-allowed", "file": ".lore/checkout.lore", "entry": "currency-from-settings", "line": 3 }
  ],
  "warnings": []
}
``````

A duplicate key is an error in JSON as well as YAML. This one is in a
file block, so the whole file is excluded:

``````example parse
=== .lore/checkout.lore
<scope>
{ "files": ["**/*.tsx"], "files": ["**/*.ts"] }
</scope>

<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== expect
{
  "entries": [],
  "errors": [
    { "name": "duplicate-key", "file": ".lore/checkout.lore", "entry": null, "line": 2 }
  ],
  "warnings": []
}
``````

An unquoted glob that starts with `*` is an alias to an anchor that does
not exist, which is invalid YAML. The quoted glob in the second rule is
read as written:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
<scope>
files: [**/*.tsx]
</scope>
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness">
<scope>
files: ["**/*.tsx"]
</scope>
Display text never hard-codes a currency code.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "currency-from-settings", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }, { "files": ["**/*.tsx"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Display text never hard-codes a currency code.",
      "prose": "Display text never hard-codes a currency code.",
      "src": null
    }
  ],
  "errors": [
    { "name": "invalid-yaml", "file": ".lore/checkout.lore", "entry": "price-from-quote", "line": 3 }
  ],
  "warnings": []
}
``````

`\d` is not a valid escape in double quotes. In single quotes the
backslash is kept:

``````example parse
=== .lore/checkout.lore
<rule id="price-literals-double" category="functional_correctness">
<when>
addedMatches: ["\d+\.\d{2}"]
</when>
A price is never written as a number literal in display code.
</rule>

<rule id="price-literals-single" category="functional_correctness">
<when>
addedMatches: ['\d+\.\d{2}']
</when>
A price is never written as a number literal in display code.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-literals-single", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": { "addedMatches": ["\\d+\\.\\d{2}"] }, "checks": [], "meta": null,
      "summary": "A price is never written as a number literal in display code.",
      "prose": "A price is never written as a number literal in display code.",
      "src": null
    }
  ],
  "errors": [
    { "name": "invalid-yaml", "file": ".lore/checkout.lore", "entry": "price-literals-double", "line": 3 }
  ],
  "warnings": []
}
``````

A `#` after a space starts a comment, even inside an unquoted value.
`owner` loses the rest of its line and the condition looks for `TODO`
alone. A `#` with no space before it, as in `source`, is part of the
value:

``````example parse
=== .lore/checkout.lore
<rule id="no-checkout-todos" category="code_style">
<meta>
owner: checkout #pricing team
source: docs/review.md#todos
</meta>
<when>
addedContains:
  - TODO #checkout
</when>
New checkout code carries no `TODO #checkout` markers.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "no-checkout-todos", "file": ".lore/checkout.lore",
      "category": "code_style", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": { "addedContains": ["TODO"] }, "checks": [],
      "meta": { "owner": "checkout", "source": "docs/review.md#todos" },
      "summary": "New checkout code carries no `TODO #checkout` markers.",
      "prose": "New checkout code carries no `TODO #checkout` markers.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

Unquoted brackets inside a flow sequence start a nested sequence. In the
first rule, `+_PRICE` after the nested sequence is invalid YAML. In the
second, `[$€£]` parses as a list inside the list, and `addedMatches`
takes only strings (see [Conditions](#conditions)), so the block fails
its schema. Quoted, both patterns are read as written:

``````example parse
=== .lore/checkout.lore
<rule id="price-constants-unquoted" category="functional_correctness">
<when>
addedMatches: [[A-Z]+_PRICE]
</when>
Prices come from the quote, never from a module constant.
</rule>

<rule id="currency-symbols-unquoted" category="functional_correctness">
<when>
addedMatches: [[$€£]]
</when>
Display text never hard-codes a currency symbol.
</rule>

<rule id="price-sources-quoted" category="functional_correctness">
<when>
addedMatches: ['[A-Z]+_PRICE', '[$€£]']
</when>
Prices come from the quote, never from a module constant or a literal
with a currency symbol.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-sources-quoted", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": { "addedMatches": ["[A-Z]+_PRICE", "[$€£]"] }, "checks": [], "meta": null,
      "summary": "Prices come from the quote, never from a module constant or a literal with a currency symbol.",
      "prose": "Prices come from the quote, never from a module constant or a literal\nwith a currency symbol.",
      "src": null
    }
  ],
  "errors": [
    { "name": "invalid-yaml", "file": ".lore/checkout.lore", "entry": "price-constants-unquoted", "line": 3 },
    { "name": "invalid-when", "file": ".lore/checkout.lore", "entry": "currency-symbols-unquoted", "line": 9 }
  ],
  "warnings": []
}
``````

A trailing comma is allowed, as in YAML 1.2. A `//` comment is not: here
it is read as text where the flow mapping expects `,` or `}`. A block that
ends before its document is complete is reported at its closing tag
line:

``````example parse
=== .lore/json.lore
<scope>
{ "files": ["apps/web/**/*.tsx",] }
</scope>

<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== .lore/jsonc.lore
<scope>
{
  "files": ["apps/web/**/*.tsx"] // web only
}
</scope>

<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code.
</rule>
=== .lore/unclosed.lore
<rule id="dates-from-locale" category="functional_correctness">
<scope>
files: ["**/*.tsx"
</scope>
Displayed dates are formatted with the shop's locale.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": ".lore/json.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/**/*.tsx"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote that produced it.",
      "src": null
    }
  ],
  "errors": [
    { "name": "invalid-yaml", "file": ".lore/jsonc.lore", "entry": null, "line": 3 },
    { "name": "invalid-yaml", "file": ".lore/unclosed.lore", "entry": "dates-from-locale", "line": 4 }
  ],
  "warnings": []
}
``````

An empty block, or one holding only comments, is an empty mapping. The
empty `<scope>` leaves the defaults in place:

``````example parse
=== .lore/checkout.lore
<scope>
</scope>

<rule id="price-from-quote" category="functional_correctness">
<meta>
# owner to be decided
</meta>
A displayed price must come from the quote that produced it.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": {},
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote that produced it.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

The core schema reads `yes` and `off` as strings, not booleans. A key
that is not a string is not allowed:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
<meta>
reviewed: yes
legacy: off
enforced: true
owner: ~
since: 2026
</meta>
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness">
<meta>
2026: reviewed
</meta>
Display text never hard-codes a currency code.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [],
      "meta": { "reviewed": "yes", "legacy": "off", "enforced": true, "owner": null, "since": 2026 },
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote that produced it.",
      "src": null
    }
  ],
  "errors": [
    { "name": "yaml-feature-not-allowed", "file": ".lore/checkout.lore", "entry": "currency-from-settings", "line": 14 }
  ],
  "warnings": []
}
``````
