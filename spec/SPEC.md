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
Their `$id`s start with `https://lore.dev/schemas/v1/`, a placeholder
identifier that will change when the format's final name is chosen.
The error and warning names are in [`errors.json`](errors.json).

The specification text is licensed under
[CC-BY-4.0](../LICENSE-CC-BY-4.0). The conformance examples, the JSON
Schemas and `errors.json` are licensed under the
[MIT License](../LICENSE), so an implementation can copy them freely.
[`AGENT.md`](AGENT.md) is dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), so a team
can paste it into its own instructions without a notice.

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
- **Lore file**: a file whose name ends in `.lore` and that sits inside a
  Lore folder (see [Files and folders](#files-and-folders)).
- **Base**: the directory that contains a Lore file's Lore folder. When a
  path holds more than one Lore folder, the first one decides, counted
  from the repository root, or for a file in an external folder from its
  marked directory (see
  [Files and folders](#files-and-folders) and
  [External folders](#external-folders)). Globs and plain `src` paths in
  the file resolve relative to the base.
- **External folder**: Lore kept outside the governed repo, in a
  directory tree that a `.loreconfig` `repo` key maps onto the governed
  repo. A tool finds external folders in the **given folders** its user
  hands it (see [External folders](#external-folders)).
- **Lore root**: the directory where the upward lookup of `.loreconfig`
  files stops (see [.loreconfig](#loreconfig)).
- **Element**: a tagged section of a `.lore` file: an opening tag line,
  the lines of its contents, and a closing tag line.
- **File block**: a `<defaults>` or `<scope>` element at the top level of
  a file. It applies to every entry in that file.
- **Entry**: a `<rule>` or `<context>` element.
- **Change**: a set of changed files and, for each added, modified or
  renamed file, its added lines. A diff describes a change.
- **Eligible**: an entry is eligible for a change when it has no error,
  is not disabled, its scope matches at least one changed file that no
  `.loreconfig` `disable` list switches it off for, and its conditions
  hold (see [Eligibility](#eligibility)).
- **Error** and **warning**: problems a tool reports by name. An error
  excludes the file, entry or `.loreconfig` it is found in; a warning
  excludes nothing.
- **Blank line**: a line that is empty or holds only spaces and tabs.
- **Column 0**: a line starts at column 0 when its first character is
  not a space or a tab.

## Conformance examples

Each conformance example gives inputs and the output a conforming tool
produces from them. There are two kinds:

- a **parse** example gives Lore files, and any `.loreconfig` files that
  apply to them, and expects the document model a tool builds from them;
- an **eligibility** example also gives a change, and expects the
  eligible entries, the hits, the excluded files and entries, and
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
opening line. Three capabilities are defined, `regex`, `ast-grep` and
`loose-given-folder`: an example that requires `regex` or `ast-grep` is
run only by a tool that supports checks in that language (see
[Checks](#checks)), one that requires `loose-given-folder` only by a tool
that collects a given folder in no working copy (see
[External folders](#external-folders)), and other tools skip it.

The rest of the example is a series of sections. Each starts with a line
`=== ` followed by a name, and runs to the next such line or to the end
of the example:

| Section | Contents |
|---|---|
| `=== <path>` | An input file at `<path>` in the governed repo: the section's lines, joined with line feeds. |
| `=== external:<path>` | An input file at `<path>` in the external repository described below. |
| `=== loose:<path>` | A file of one given folder that is in no working copy, `<path>` relative to that folder. |
| `=== rules:<path>` | Eligibility only. A file of the governed repo as it is at the rules revision (see [Collecting files](#collecting-files)). With at least one such section, the tool is given a rules revision. |
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
`+<n> <text>` lines equals line `<n>` of that input. With `=== rules:<path>`
sections, the Lore files, `.loreconfig` files and `src` targets of the
governed repo are read from them only, and the plain input files are
still the governed repo as the change leaves it.
This document is UTF-8 text with line feeds, so an input file can hold
neither a carriage return nor a byte that is not valid UTF-8. The rules
for those bytes have no conformance examples.

**External inputs.** The `=== external:<path>` input files are the
tracked files of one other repository, and the tool was given that
repository's root as a given folder. Each `<path>` is relative to
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

- **Paths.** Every `file` field is a path exactly as written in the
  example: after `=== ` for an input file, keeping the `external:`,
  `loose:` or `rules:` prefix, or in the diff for a changed file. The one
  exception is a diagnostic about a loose folder as a whole, which has
  `file` `loose:.` and `line` 1 (see [External folders](#external-folders)).
- **Scopes.** Globs in an entry's `scopes` are resolved to paths from the
  governed repo's root: a glob `g` in a file whose base is `b` appears as
  `b/g`, and a glob in a file whose base is the repo root appears as `g`.
  The `b/` part is a literal path prefix, not glob syntax, since a base
  may hold `[`, `{`, `*` or `?`. Globs in external files resolve through
  their `repo` mapping.
- **Diagnostic lines.** A diagnostic's `line` counts from 1 within its
  file. For a YAML problem (`invalid-yaml`, `duplicate-key`,
  `yaml-feature-not-allowed`) it is the offending line, counted in the
  file, not the block (see [Structured blocks](#structured-blocks)). For
  `top-level-text` it is the first stray line, or the line holding text
  after a comment's `-->`. For a closing tag that closes nothing, or a
  malformed closing tag, at the top level or inside an entry, it is the
  offending line. For an invalid UTF-8 byte it is that byte's line, and
  for an unclosed comment the line where the comment opens. For a
  problem in a `.loreconfig`, it is the line that
  [.loreconfig](#loreconfig) and [External folders](#external-folders)
  define. For any other problem in an
  element it is the opening tag line of the element at fault. A problem
  with no line has line 1.
- **Diagnostic entry.** A diagnostic's `entry` is the id of the entry the
  problem is in, when that entry has a readable id (see
  [Attributes](#attributes)). It is null otherwise,
  and always null for a file-level error.
- **Prose and summary** are computed as [Entries](#entries) defines.
- **Hits.** A hit's `line` is the `+<n>` line number from the diff, and
  its `text` is that line's text.
- **Order.** Entries are ordered by `file`, then by position in the file.
  Diagnostics are ordered by `file`, then `line`, then `name`, then
  `entry`, null first. `eligible`
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
{
  "eligible": ["currency-from-settings"],
  "hits": [
    { "rule": "currency-from-settings", "file": "apps/web/src/checkout/Price.tsx", "line": 12, "text": "const label = 'USD'" }
  ],
  "excluded": [],
  "warnings": []
}
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

This file starts with a byte order mark (U+FEFF). A tool ignores it, so
the opening tag after it is still at column 0:

``````example parse
=== .lore/checkout.lore
﻿<rule id="price-from-quote" category="functional_correctness">
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
  "errors": [],
  "warnings": []
}
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
  A tool meets this problem at the first character where the list stops
  being valid, so a problem with an attribute before that character
  (see [Attributes](#attributes)) is met first. On an entry or one of
  its children this is an entry-level error; on a file block it is
  file-level. On a file block, the position errors of
  [Top level](#top-level) (`file-block-after-entry`, then
  `duplicate-file-block`) are checked before the attributes.
- When the entry's own opening tag is malformed, the error's `entry` is
  the entry's readable id (see [Attributes](#attributes)) if, reading
  that tag's attribute list from left to right, its first `id` attribute
  comes before the first character at which the list stops being valid;
  otherwise it is null. When a child's opening
  tag is malformed, the entry's own opening tag has already been read,
  and the error's `entry` is the entry's id.

Element contents and attribute values are raw text. A tool MUST NOT
decode entities or process escapes in either: `&amp;` stays `&amp;`.

An unquoted attribute value is malformed. The element's extent is still
known, so only that entry is excluded. The unquoted id of
`currency-from-settings` is itself the malformed value, so its error
names no entry. In `dates-from-locale` the id is read before the
malformed value, so the error names it. In `no-hard-coded-currency`, the
malformed tag is a child's, and the error names the entry:

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

<rule id="no-hard-coded-currency" category="functional_correctness">
<check lang=regex>
'USD'
</check>
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
      "prose": "A displayed price must come from the quote that produced it.",
      "src": null
    }
  ],
  "errors": [
    { "name": "invalid-attribute-value", "file": ".lore/checkout.lore", "entry": null, "line": 5 },
    { "name": "invalid-attribute-value", "file": ".lore/checkout.lore", "entry": "dates-from-locale", "line": 9 },
    { "name": "invalid-attribute-value", "file": ".lore/checkout.lore", "entry": "no-hard-coded-currency", "line": 14 }
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

A comment may span lines. Text after its `-->` is `top-level-text`, and
a comment that never closes makes the structure unreadable:

``````example parse
=== .lore/checkout.lore
<!--
Owned by the pricing team.
-->
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== .lore/display.lore
<!-- Display rules. --> Owned by the web team.

<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code.
</rule>
=== .lore/dates.lore
<rule id="dates-from-locale" category="functional_correctness">
Displayed dates are formatted with the shop's locale.
</rule>

<!-- Rules below are drafts.

<rule id="times-from-locale" category="functional_correctness">
Displayed times are formatted with the shop's locale.
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
    { "name": "unreadable-structure", "file": ".lore/dates.lore", "entry": null, "line": 5 },
    { "name": "top-level-text", "file": ".lore/display.lore", "entry": null, "line": 1 }
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

The entry's common indentation here is two spaces. The prose keeps the
continuation line's extra indentation, the summary trims it, the line of
four spaces becomes empty, and the trailing blank lines are dropped:

``````example parse
=== .lore/checkout.lore
<rule id="quote-totals-match" category="functional_correctness">
  The order page shows the total
    from the quote that produced it.
    
  A total rebuilt from line items drops quote-level discounts.


</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "quote-totals-match", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "The order page shows the total from the quote that produced it.",
      "prose": "The order page shows the total\n  from the quote that produced it.\n\nA total rebuilt from line items drops quote-level discounts.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

A tilde fence protects a closing tag too. The `~~~` line inside does not
close the `~~~~` fence, since it is shorter:

``````example parse
=== .lore/docs.lore
<rule id="lore-samples-tilde-fenced" category="documentation">
A tilde fence works as well as a backtick fence.

~~~~
~~~
</rule>
~~~~
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "lore-samples-tilde-fenced", "file": ".lore/docs.lore",
      "category": "documentation", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A tilde fence works as well as a backtick fence.",
      "prose": "A tilde fence works as well as a backtick fence.\n\n~~~~\n~~~\n</rule>\n~~~~",
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
blocks**, and so is a `.loreconfig` file. Their contents are YAML 1.2
read with the core schema: for a block in a Lore file, after
[Indentation](#indentation); for a `.loreconfig`, as written.
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
- Mappings and sequences, block or flow, MAY nest up to 100 deep,
  counting the block's own value as depth 1, and a tool MUST read them.
  A block that nests deeper is `invalid-yaml`, at the line where the
  first mapping or sequence past the limit starts.

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

The mapping is depth 1 and each `[` one more, so the first rule nests
100 deep and the second 101:

``````example parse
=== .lore/teams.lore
<rule id="team-tree-at-limit" category="documentation">
<meta>
teams: [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]
</meta>
Metadata nested 100 deep is read.
</rule>

<rule id="team-tree-past-limit" category="documentation">
<meta>
teams: [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]
</meta>
Metadata nested 101 deep is not.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "team-tree-at-limit", "file": ".lore/teams.lore",
      "category": "documentation", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [],
      "meta": { "teams": [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]] },
      "summary": "Metadata nested 100 deep is read.",
      "prose": "Metadata nested 100 deep is read.",
      "src": null
    }
  ],
  "errors": [
    { "name": "invalid-yaml", "file": ".lore/teams.lore", "entry": "team-tree-past-limit", "line": 10 }
  ],
  "warnings": []
}
``````

## Defaults

`<defaults>` is a file block that gives every rule in its file a
`category` and a `severity` to fall back on. It is a structured block
(see [Structured blocks](#structured-blocks)), and a file has at most one,
before its first entry (see [Top level](#top-level)).

- Its value MUST be a mapping with no keys other than `category` and
  `severity`. `category` is a string that matches the category pattern
  `^[a-z][a-z0-9_]*$`, and `severity` is `blocking` or `advisory`. Any
  other shape, such as an unknown key, `severity: critical` or a list, is
  `invalid-defaults`. The shape is also given as
  [`defaults.schema.json`](schemas/defaults.schema.json).
- A `category` that is not a known category for the file (see
  [Categories and severity](#categories-and-severity)) is
  `unknown-category`.
- `<defaults>` takes no attributes. An attribute on it is
  `unknown-attribute`.
- A tool checks the block in this order, and reports the first problem it
  finds: the checks of [Structured blocks](#structured-blocks), then
  `invalid-defaults`, then `unknown-category`.
- Every error in `<defaults>` is file-level, `unknown-category`
  included. The whole file is excluded, even its rules that set their own
  category, because the file as written is wrong. Apart from a YAML
  problem, the error's line is the `<defaults>` opening tag line.

A rule's own `category` and `severity` attributes take precedence over
the defaults. Defaults never apply to a context. Here the first rule takes
both defaults, the second sets both itself, and the context has neither:

``````example parse
=== apps/web/src/checkout/.lore/pricing.lore
<defaults>
category: functional_correctness
severity: blocking
</defaults>

<rule id="price-from-quote">
A displayed price must come from the quote that produced it.
</rule>

<rule id="price-test-per-currency" category="test_coverage" severity="advisory">
A change to price formatting adds a test for each supported currency.
</rule>

<context id="checkout-architecture" src="ARCHITECTURE.md">
Read before judging any change to how a price is computed.
</context>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": "apps/web/src/checkout/.lore/pricing.lore",
      "category": "functional_correctness", "severity": "blocking", "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote that produced it.",
      "src": null
    },
    {
      "kind": "rule", "id": "price-test-per-currency", "file": "apps/web/src/checkout/.lore/pricing.lore",
      "category": "test_coverage", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A change to price formatting adds a test for each supported currency.",
      "prose": "A change to price formatting adds a test for each supported currency.",
      "src": null
    },
    {
      "kind": "context", "id": "checkout-architecture", "file": "apps/web/src/checkout/.lore/pricing.lore",
      "category": null, "severity": null, "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Read before judging any change to how a price is computed.",
      "prose": "Read before judging any change to how a price is computed.",
      "src": "apps/web/src/checkout/ARCHITECTURE.md"
    }
  ],
  "errors": [],
  "warnings": []
}
``````

A severity the format does not define, or a key it does not define,
excludes the file:

``````example parse
=== .lore/checkout.lore
<defaults>
category: functional_correctness
severity: critical
</defaults>

<rule id="price-from-quote">
A displayed price must come from the quote that produced it.
</rule>
=== .lore/display.lore
<defaults>
category: functional_correctness
owner: web
</defaults>

<rule id="currency-from-settings">
Display text never hard-codes a currency code.
</rule>
=== expect
{
  "entries": [],
  "errors": [
    { "name": "invalid-defaults", "file": ".lore/checkout.lore", "entry": null, "line": 1 },
    { "name": "invalid-defaults", "file": ".lore/display.lore", "entry": null, "line": 1 }
  ],
  "warnings": []
}
``````

## Rules

A **rule** is a `<rule>` entry: one thing a team expects every change to
follow. Its opening tag carries its attributes. Its contents are its
children and then its prose, read as [Entries](#entries) describes.

### Attributes

| Attribute | Required | Value |
|---|---|---|
| `id` | yes | The entry's id, in kebab-case: it matches `^[a-z][a-z0-9-]*$`. |
| `category` | no | A category that matches `^[a-z][a-z0-9_]*$` and is known for the file (see [Categories and severity](#categories-and-severity)). |
| `severity` | no | `blocking` or `advisory` (see [Categories and severity](#categories-and-severity)). |
| `disabled` | no | Bare, with no value. |

A tool reads the attributes of an entry's opening tag from left to right,
and the first problem it meets is the entry's error:

1. An attribute whose name already appeared on the tag is
   `duplicate-attribute`.
2. An attribute the element does not define is `unknown-attribute`. A
   rule defines only the four above, so `src` on a rule is
   `unknown-attribute` too.
3. A value the attribute does not allow is `invalid-attribute-value`,
   except where a more specific name applies:
   - an `id` value that does not match the id pattern is `invalid-id`;
   - a `category` value that matches the category pattern but is not a
     known category is `unknown-category`;
   - `disabled` with any value, even `disabled="false"` or
     `disabled=""`, is `disabled-has-value`.

   So `id`, `category` and `severity` written bare are
   `invalid-attribute-value`, and so are a `category` that does not
   match the category pattern and a `severity` other than `blocking` or
   `advisory`.
4. A tag that ends with no `id` attribute is `missing-id`.

A malformed attribute list (see [Lines and tags](#lines-and-tags)) is
met at the first character where it stops being valid, in the same
left-to-right reading. So on `<rule id="x" owner="y" category=z>`,
`owner` is met first, and the error is `unknown-attribute`.

Every error in this section is entry-level, and its line is the entry's
opening tag line. An entry's **readable id** is the value of the first
`id` attribute on its opening tag, when that value matches the id
pattern; it is the `entry` of the entry's diagnostics. ([Lines and
tags](#lines-and-tags) narrows this for a malformed opening tag.) An
entry with `invalid-id` or `missing-id` has no readable id.

The first rule has no id, the second's id is not kebab-case, and the
third repeats an attribute. The fourth has no id either, but its unknown
attribute is met first. Only the last rule is read:

``````example parse
=== .lore/checkout.lore
<rule category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<rule id="currencyFromSettings" category="functional_correctness">
Display text never hard-codes a currency code.
</rule>

<rule id="dates-from-locale" category="functional_correctness" category="accessibility">
Displayed dates are formatted with the shop's locale.
</rule>

<rule owner="pricing">
Quoted prices are rounded once, when the quote is made.
</rule>

<rule id="quote-expiry-shown" category="functional_correctness">
A checkout page that shows a quoted price also shows when the quote expires.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "quote-expiry-shown", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A checkout page that shows a quoted price also shows when the quote expires.",
      "prose": "A checkout page that shows a quoted price also shows when the quote expires.",
      "src": null
    }
  ],
  "errors": [
    { "name": "missing-id", "file": ".lore/checkout.lore", "entry": null, "line": 1 },
    { "name": "invalid-id", "file": ".lore/checkout.lore", "entry": null, "line": 5 },
    { "name": "duplicate-attribute", "file": ".lore/checkout.lore", "entry": "dates-from-locale", "line": 9 },
    { "name": "unknown-attribute", "file": ".lore/checkout.lore", "entry": null, "line": 13 }
  ],
  "warnings": []
}
``````

An attribute the element does not define is an error, on a rule and on a
context alike: a context has no category. A severity the format does not
define is an invalid value. In `refunds-logged`, the unknown attribute
comes before the malformed one, so it is met first:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness" owner="pricing">
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness" severity="high">
Display text never hard-codes a currency code.
</rule>

<context id="checkout-architecture" src="ARCHITECTURE.md" category="documentation">
Read before judging any change to how a price is computed.
</context>

<rule id="refunds-logged" owner="payments" category=observability>
Every refund is logged with the order it refunds.
</rule>

<rule id="dates-from-locale" category="functional_correctness">
Displayed dates are formatted with the shop's locale.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "dates-from-locale", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Displayed dates are formatted with the shop's locale.",
      "prose": "Displayed dates are formatted with the shop's locale.",
      "src": null
    }
  ],
  "errors": [
    { "name": "unknown-attribute", "file": ".lore/checkout.lore", "entry": "price-from-quote", "line": 1 },
    { "name": "invalid-attribute-value", "file": ".lore/checkout.lore", "entry": "currency-from-settings", "line": 5 },
    { "name": "unknown-attribute", "file": ".lore/checkout.lore", "entry": "checkout-architecture", "line": 9 },
    { "name": "unknown-attribute", "file": ".lore/checkout.lore", "entry": "refunds-logged", "line": 13 }
  ],
  "warnings": []
}
``````

**Disabled entries.** `disabled` is the author's switch for turning an
entry off without deleting it; [.loreconfig](#loreconfig) gives the
consumer's switch. A disabled entry is never eligible. It is still read
and checked like any other entry, and the document model lists it with
`disabled: true`. `disabled` takes no value:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness" disabled>
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness" disabled="false">
Display text never hard-codes a currency code.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": true,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote that produced it.",
      "src": null
    }
  ],
  "errors": [
    { "name": "disabled-has-value", "file": ".lore/checkout.lore", "entry": "currency-from-settings", "line": 5 }
  ],
  "warnings": []
}
``````

The disabled rule's scope covers the change, but it is not eligible:

``````example eligibility
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness" disabled>
A displayed price must come from the quote that produced it.
</rule>

<rule id="quote-expiry-shown" category="functional_correctness">
A checkout page that shows a quoted price also shows when the quote expires.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
+12 const total = quote.total
=== expect
{ "eligible": ["quote-expiry-shown"], "hits": [], "excluded": [], "warnings": [] }
``````

**Ids.** Rules and contexts share one namespace of ids. Ids MUST be
unique across every Lore file collected for the governed repo, including
the files of external folders (see [External folders](#external-folders)).
An id used by more than one entry is `duplicate-id`, an entry-level error
that excludes every entry using it. No entry overrides another.

- A tool checks ids after it has read every file. Every entry with a
  readable id counts, including a disabled entry and one excluded by
  another error. Entries in a file excluded by a file-level error do not
  count.
- Each entry that shares an id and has no other error gets `duplicate-id`,
  at its opening tag line. An entry that already has an error keeps that
  error, as [Parsing](#parsing) requires, and is not listed twice.

Each id below is used in both of the first two files, by two rules or
by a rule and a context. The first `quote-expiry-shown` already has an
error, and the second is still excluded. The disabled
`totals-from-quote` counts too. The third file is excluded by a
file-level error, so its `dates-from-locale` does not count, and the
other one is read:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code.
</rule>

<rule id="quote-expiry-shown" category="functional_correctness" severity="high">
A checkout page that shows a quoted price also shows when the quote expires.
</rule>

<rule id="totals-from-quote" category="functional_correctness" disabled>
Cart totals come from the quote, never from summing line items.
</rule>
=== apps/web/src/checkout/.lore/rules.lore
<rule id="price-from-quote" category="functional_correctness" severity="blocking">
The checkout page shows the price from the quote, never a recomputed one.
</rule>

<context id="currency-from-settings" src="docs/currency.md">
Read before changing how a price is formatted.
</context>

<rule id="quote-expiry-shown" category="functional_correctness">
The quote's expiry time is shown next to the quoted price.
</rule>

<rule id="totals-from-quote" category="functional_correctness">
The order total comes from the quote.
</rule>

<rule id="dates-from-locale" category="functional_correctness">
Displayed dates are formatted with the shop's locale.
</rule>
=== .lore/drafts.lore
Draft rules, not reviewed yet.

<rule id="dates-from-locale" category="functional_correctness">
Displayed dates use the shop's locale.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "dates-from-locale", "file": "apps/web/src/checkout/.lore/rules.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Displayed dates are formatted with the shop's locale.",
      "prose": "Displayed dates are formatted with the shop's locale.",
      "src": null
    }
  ],
  "errors": [
    { "name": "duplicate-id", "file": ".lore/checkout.lore", "entry": "price-from-quote", "line": 1 },
    { "name": "duplicate-id", "file": ".lore/checkout.lore", "entry": "currency-from-settings", "line": 5 },
    { "name": "invalid-attribute-value", "file": ".lore/checkout.lore", "entry": "quote-expiry-shown", "line": 9 },
    { "name": "duplicate-id", "file": ".lore/checkout.lore", "entry": "totals-from-quote", "line": 13 },
    { "name": "top-level-text", "file": ".lore/drafts.lore", "entry": null, "line": 1 },
    { "name": "duplicate-id", "file": "apps/web/src/checkout/.lore/rules.lore", "entry": "price-from-quote", "line": 1 },
    { "name": "duplicate-id", "file": "apps/web/src/checkout/.lore/rules.lore", "entry": "currency-from-settings", "line": 5 },
    { "name": "duplicate-id", "file": "apps/web/src/checkout/.lore/rules.lore", "entry": "quote-expiry-shown", "line": 9 },
    { "name": "duplicate-id", "file": "apps/web/src/checkout/.lore/rules.lore", "entry": "totals-from-quote", "line": 13 }
  ],
  "warnings": []
}
``````

### Children

A rule's children come before its prose, in any order:

| Child | Count | Contents |
|---|---|---|
| `<meta>` | 0 or 1 | A free-form YAML mapping, described below. |
| `<scope>` | 0 or 1 | The rule's own scope, which narrows the file's (see [Scope and globs](#scope-and-globs)). |
| `<when>` | 0 or 1 | Conditions on the change (see [Conditions](#conditions)). |
| `<check>` | any number | A search whose hits go to the reviewer (see [Checks](#checks)). |

- The order of the children carries no meaning, except among `<check>`
  elements: the document model keeps checks in the order they appear.
- A child whose name its entry does not allow is `unknown-child`.
- A second `<meta>`, `<scope>` or `<when>` in one entry is
  `duplicate-child`.
- `<meta>`, `<scope>` and `<when>` take no attributes: an attribute on
  one is `unknown-attribute`. `<check>` takes the attributes
  [Checks](#checks) defines. A child's attributes are read from left to
  right, as an entry's are.
- A tool reads each child in this order, and reports the first problem it
  finds: its name (`unknown-child`), then whether it repeats an earlier
  child (`duplicate-child`), then its attributes, then its
  [indentation](#indentation), then its contents.
- Every error this section defines is entry-level. Apart from a YAML
  problem, its line is the child's opening tag line.

**`<meta>`** holds what a team wants to record about an entry: where the
rule came from, an owner, links. It is a structured block, and its value
MUST be a mapping; anything else, such as a scalar, a list or `null`, is
`invalid-meta`. This specification gives no key a meaning, and tools MAY
define their own keys. A tool MUST NOT let the keys and values of a
valid `<meta>` change whether an entry is eligible. The document model
keeps the mapping as parsed, in `meta`; an entry without `<meta>` has
`meta: null`.

`<meta>` is kept as parsed, whatever its keys. Under the core schema,
`2026-03-01` is a string, not a date:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
<meta>
source: docs/pricing-review.md#prices
owner: checkout
reviewed: 2026-03-01
reviewers: [pricing, web]
links:
  decision: docs/decisions/0042-quote-prices.md
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
      "when": null, "checks": [],
      "meta": {
        "source": "docs/pricing-review.md#prices",
        "owner": "checkout",
        "reviewed": "2026-03-01",
        "reviewers": ["pricing", "web"],
        "links": { "decision": "docs/decisions/0042-quote-prices.md" }
      },
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote that produced it.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

`<meta>` holding a scalar or a list is an error:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
<meta>
checkout team
</meta>
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness">
<meta>
- checkout
- pricing
</meta>
Display text never hard-codes a currency code.
</rule>
=== expect
{
  "entries": [],
  "errors": [
    { "name": "invalid-meta", "file": ".lore/checkout.lore", "entry": "price-from-quote", "line": 2 },
    { "name": "invalid-meta", "file": ".lore/checkout.lore", "entry": "currency-from-settings", "line": 9 }
  ],
  "warnings": []
}
``````

The same children in the opposite order give the same model, apart from
the id:

``````example parse
=== .lore/checkout.lore
<rule id="currency-children-first" category="functional_correctness">
<meta>
owner: checkout
</meta>
<scope>
files: ["apps/web/**/*.tsx"]
</scope>
<when>
addedContains: ["'USD'"]
</when>
<check>
'USD'
</check>
Display text never hard-codes a currency code.
</rule>

<rule id="currency-children-reversed" category="functional_correctness">
<check>
'USD'
</check>
<when>
addedContains: ["'USD'"]
</when>
<scope>
files: ["apps/web/**/*.tsx"]
</scope>
<meta>
owner: checkout
</meta>
Display text never hard-codes a currency code.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "currency-children-first", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }, { "files": ["apps/web/**/*.tsx"], "ignores": [] }],
      "when": { "addedContains": ["'USD'"] },
      "checks": [{ "lang": "regex", "body": "'USD'" }],
      "meta": { "owner": "checkout" },
      "summary": "Display text never hard-codes a currency code.",
      "prose": "Display text never hard-codes a currency code.",
      "src": null
    },
    {
      "kind": "rule", "id": "currency-children-reversed", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }, { "files": ["apps/web/**/*.tsx"], "ignores": [] }],
      "when": { "addedContains": ["'USD'"] },
      "checks": [{ "lang": "regex", "body": "'USD'" }],
      "meta": { "owner": "checkout" },
      "summary": "Display text never hard-codes a currency code.",
      "prose": "Display text never hard-codes a currency code.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

A rule may have several checks, and they keep their order:

``````example parse
=== .lore/checkout.lore
<rule id="currency-codes-from-settings" category="functional_correctness">
<check>
'USD'
</check>
<check lang="regex">
'EUR'
</check>
Display text never hard-codes a currency code.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "currency-codes-from-settings", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null,
      "checks": [{ "lang": "regex", "body": "'USD'" }, { "lang": "regex", "body": "'EUR'" }],
      "meta": null,
      "summary": "Display text never hard-codes a currency code.",
      "prose": "Display text never hard-codes a currency code.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

A second `<when>` is an error, and so is a child the entry does not
allow: `<check>` in a context, or an element the format does not define
in a rule:

``````example parse
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
<when>
addedContains: ["'USD'"]
</when>
<when>
changed: ["apps/web/src/checkout/**"]
</when>
Display text never hard-codes a currency code.
</rule>

<context id="checkout-architecture" src="ARCHITECTURE.md">
<check>
quote
</check>
Read before judging any change to how a price is computed.
</context>

<rule id="price-from-quote" category="functional_correctness">
<example>
const price = quote.total
</example>
A displayed price must come from the quote that produced it.
</rule>

<rule id="dates-from-locale" category="functional_correctness">
Displayed dates are formatted with the shop's locale.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "dates-from-locale", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Displayed dates are formatted with the shop's locale.",
      "prose": "Displayed dates are formatted with the shop's locale.",
      "src": null
    }
  ],
  "errors": [
    { "name": "duplicate-child", "file": ".lore/checkout.lore", "entry": "currency-from-settings", "line": 5 },
    { "name": "unknown-child", "file": ".lore/checkout.lore", "entry": "checkout-architecture", "line": 12 },
    { "name": "unknown-child", "file": ".lore/checkout.lore", "entry": "price-from-quote", "line": 19 }
  ],
  "warnings": []
}
``````

### Prose and summary

Everything after a rule's children, up to `</rule>`, is the rule's
prose, in CommonMark Markdown. [Entries](#entries) defines exactly which
lines it holds and how its summary is found.

- The prose MUST state the rule completely on its own. A reader who
  skips `<when>` and `<check>` still knows exactly what the rule asks.
  Conditions and checks select a rule and point at lines; they never add
  to its meaning.
- The prose's first paragraph is the rule's **summary**, which tools use
  in listings and short reports. Authors SHOULD keep it to one or two
  sentences.

The summary is found by lines, not by Markdown structure, so a list
directly under the first sentence is part of the summary. A blank line
before the list would keep it out:

``````example parse
=== .lore/checkout.lore
<rule id="checkout-prices-from-quote" category="functional_correctness">
Every price the checkout page shows comes from the quote:
- each line item's price;
- the order total.

A helper that recomputes a price from its inputs drops quote-level
discounts.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "checkout-prices-from-quote", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Every price the checkout page shows comes from the quote: - each line item's price; - the order total.",
      "prose": "Every price the checkout page shows comes from the quote:\n- each line item's price;\n- the order total.\n\nA helper that recomputes a price from its inputs drops quote-level\ndiscounts.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

## Context

A **context** is a `<context>` entry. It points a reviewer at a prose
document to read when the context is eligible, such as an architecture
note. A context gets no verdict, and has no category and no severity.
Context documents stay where they already live; Lore only points at
them.

- A context's attributes are `id` (required), `src` and `disabled`, read
  as [Attributes](#attributes) describes for a rule. Any other attribute,
  `category` and `severity` included, is `unknown-attribute`.
- Its children are `<meta>`, `<scope>` and `<when>`, as for a rule (see
  [Children](#children)). `<check>`, or any other child, is
  `unknown-child`.
- Its prose is its **body**, found as [Entries](#entries) defines. With
  `src`, the body is an optional note on when or why to read the
  document. Without `src`, the body is the context itself.
- In the document model, a context has `category: null`, `severity: null`
  and `checks: []`. `missing-category` never applies to a context.

`src` names one file, not a glob. Its value MUST be a relative path:
one or more segments separated by `/`, none of them empty (so no
leading, trailing or doubled `/`), with `.` and `..` segments only at its
start, and a last segment that is neither `.` nor `..`. Any other value,
bare `src` included, is `invalid-attribute-value`.

- A `src` whose first segment is `.` or `..` is relative to the Lore
  file. It resolves from the directory that holds the Lore file: `.`
  stays in the directory, `..` moves up one. Such a path lets a context
  point at a document kept beside its rules, and MUST NOT leave the Lore
  root (see [.loreconfig](#loreconfig)). A `..` that would move up from
  the Lore root is `src-escapes-root`.
- Any other `src` resolves against the governed repo: from the base, or
  for a file in an external folder through its `repo` mapping (see
  [External folders](#external-folders)).
- Both `src` errors are entry-level, at the context's opening tag line.
  Among the attribute checks of [Attributes](#attributes), a tool checks
  `src` for `invalid-attribute-value` first, then for
  `src-escapes-root`.

In the document model, `src` is the resolved path, from the governed
repo's root, or null when the context has no `src`. A file-relative
`src` in a file of an external folder names a file in that folder's
repository, not in the governed repo. Its `src` in the document model is
`external:<path>`, where `<path>` is from that repository's root, as in
a `file` field. In a loose folder (see
[External folders](#external-folders)) it is `loose:<path>`, where
`<path>` is from the loose folder.

A context with a plain `src`, one with a `src` beside the Lore file and
no body, and one with no `src`, whose body is the context:

``````example parse
=== apps/web/src/checkout/.lore/context.lore
<context id="checkout-architecture" src="ARCHITECTURE.md">
Read before judging any change to how a price is computed.
</context>

<context id="pricing-glossary" src="./glossary.md">
</context>

<context id="quote-lifecycle">
<scope>
files: ["quotes/**"]
</scope>
A quote is created when the cart is priced and expires after 30 minutes.
Any price shown after that comes from a new quote.
</context>
=== expect
{
  "entries": [
    {
      "kind": "context", "id": "checkout-architecture", "file": "apps/web/src/checkout/.lore/context.lore",
      "category": null, "severity": null, "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Read before judging any change to how a price is computed.",
      "prose": "Read before judging any change to how a price is computed.",
      "src": "apps/web/src/checkout/ARCHITECTURE.md"
    },
    {
      "kind": "context", "id": "pricing-glossary", "file": "apps/web/src/checkout/.lore/context.lore",
      "category": null, "severity": null, "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "",
      "prose": "",
      "src": "apps/web/src/checkout/.lore/glossary.md"
    },
    {
      "kind": "context", "id": "quote-lifecycle", "file": "apps/web/src/checkout/.lore/context.lore",
      "category": null, "severity": null, "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**"], "ignores": [] }, { "files": ["apps/web/src/checkout/quotes/**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A quote is created when the cart is priced and expires after 30 minutes. Any price shown after that comes from a new quote.",
      "prose": "A quote is created when the cart is priced and expires after 30 minutes.\nAny price shown after that comes from a new quote.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": []
}
``````

With no `.loreconfig`, the Lore root is the repository root. From
`.lore/`, `./../README.md` reaches the root's `README.md`, while one more
`..` leaves the Lore root. A `..` after the first named segment is not
allowed at all, and a path that ends in `..` names a directory, not a
file:

``````example parse
=== .lore/context.lore
<context id="shop-readme" src="./../README.md">
Read for how the shop is built and deployed.
</context>

<context id="org-handbook" src="./../../handbook/review.md">
Read for the organization's review conventions.
</context>

<context id="shop-readme-roundabout" src="docs/../README.md">
Read for how the shop is built and deployed.
</context>

<context id="shop-root" src="./..">
Read the repository's top-level files.
</context>
=== expect
{
  "entries": [
    {
      "kind": "context", "id": "shop-readme", "file": ".lore/context.lore",
      "category": null, "severity": null, "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Read for how the shop is built and deployed.",
      "prose": "Read for how the shop is built and deployed.",
      "src": "README.md"
    }
  ],
  "errors": [
    { "name": "src-escapes-root", "file": ".lore/context.lore", "entry": "org-handbook", "line": 5 },
    { "name": "invalid-attribute-value", "file": ".lore/context.lore", "entry": "shop-readme-roundabout", "line": 9 },
    { "name": "invalid-attribute-value", "file": ".lore/context.lore", "entry": "shop-root", "line": 13 }
  ],
  "warnings": []
}
``````

**A missing target.** When the resolved `src` names no tracked file, the context
gets the warning `missing-src-target`, at its opening tag line, and stays
eligible as usual. Parsing reads Lore files and `.loreconfig` files,
never the governed repo's other files, so the document model does not
report this warning. A tool reports it when it computes eligibility,
where the governed repo's files are known, for every context in the
document model whose target is missing, eligible or not. A target named
`external:<path>` is looked for among the tracked files of that external
folder's repository, and one named `loose:<path>` among the files of
that loose folder.

`docs/payments-architecture.md` and `docs/refunds-architecture.md` are
not in the governed repo. The first two contexts are eligible, and the
second carries a warning. The third is not eligible, since its scope
misses the change, and still carries one:

``````example eligibility
=== .lore/context.lore
<context id="checkout-architecture" src="docs/checkout-architecture.md">
Read before judging any change to how a price is computed.
</context>

<context id="payments-architecture" src="docs/payments-architecture.md">
Read before judging any change to how a payment is taken.
</context>

<context id="refunds-architecture" src="docs/refunds-architecture.md">
<scope>
files: ["apps/web/src/refunds/**"]
</scope>
Read before judging any change to how a refund is issued.
</context>
=== docs/checkout-architecture.md
# Checkout architecture

Prices come from quotes.
=== diff
M apps/web/src/checkout/Price.tsx
+12 const total = quote.total
=== expect
{
  "eligible": ["checkout-architecture", "payments-architecture"],
  "hits": [],
  "excluded": [],
  "warnings": [
    { "name": "missing-src-target", "file": ".lore/context.lore", "entry": "payments-architecture", "line": 5 },
    { "name": "missing-src-target", "file": ".lore/context.lore", "entry": "refunds-architecture", "line": 9 }
  ]
}
``````

## Categories and severity

A rule's **category** says what kind of problem a violation of it is.
Nine categories are fixed:

| Category | Rules about |
|---|---|
| `functional_correctness` | whether the code does what it is meant to do |
| `test_coverage` | the tests a change adds or updates |
| `security` | protecting data, access and secrets |
| `performance` | speed and use of resources |
| `accessibility` | use by people with disabilities |
| `observability` | logs, metrics and traces |
| `backwards_compatibility` | not breaking existing callers, data or clients |
| `documentation` | documentation and comments that ship with the code |
| `code_style` | conventions of naming, structure and form |

A team MAY declare its own categories in the `categories` list of a
`.loreconfig`. A custom category MUST match the category pattern
`^[a-z][a-z0-9_]*$`, as the fixed ones do. A category is **known** for a
Lore file when it is fixed, or declared by a `.loreconfig` that applies
to the file: one in the directory that holds the file or above it, up to
the Lore root (see [.loreconfig](#loreconfig)).

A rule's category is, in order:

1. its `category` attribute;
2. otherwise, the `category` of its file's `<defaults>`;
3. otherwise, none: the rule's `category` is null and it gets the
   warning `missing-category`, at its opening tag line. A rule without a
   category is still eligible, so a team can wrap and scope existing
   rules first and classify them later.

A category that matches the category pattern but is not known is
`unknown-category`: an entry-level error
when a rule's attribute names it, and a file-level error when
`<defaults>` names it (see [Defaults](#defaults)).

A rule's **severity** says what a violation costs:

- `blocking`: a violation is to be fixed, or explicitly waived, before
  the change is merged.
- `advisory`: a reviewer raises the violation, and the change's author
  decides what to do.

A rule's severity is its `severity` attribute, otherwise the `severity`
of its file's `<defaults>`, otherwise `advisory`, so a missing value never
blocks anyone. A tool MAY map the two levels onto its own scale.

A context has neither: its `category` and `severity` are always null.

A declared category is known, an undeclared one excludes its rule, and
an undeclared one in `<defaults>` excludes the whole file, including its
rule that names a declared category. A category that does not match the
category pattern is an invalid value:

``````example parse
=== .loreconfig
categories: [data_provenance]
=== .lore/provenance.lore
<rule id="price-source-recorded" category="data_provenance">
Every stored price records the quote it came from.
</rule>

<rule id="currency-source-recorded" category="data_lineage">
Every stored amount records the currency setting it was formatted with.
</rule>

<rule id="tax-source-recorded" category="Data_Provenance">
Every stored tax amount records the tax table it came from.
</rule>
=== .lore/lineage.lore
<defaults>
category: data_lineage
</defaults>

<rule id="quote-source-recorded" category="data_provenance">
Every stored quote records the cart it priced.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-source-recorded", "file": ".lore/provenance.lore",
      "category": "data_provenance", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Every stored price records the quote it came from.",
      "prose": "Every stored price records the quote it came from.",
      "src": null
    }
  ],
  "errors": [
    { "name": "unknown-category", "file": ".lore/lineage.lore", "entry": null, "line": 1 },
    { "name": "unknown-category", "file": ".lore/provenance.lore", "entry": "currency-source-recorded", "line": 5 },
    { "name": "invalid-attribute-value", "file": ".lore/provenance.lore", "entry": "tax-source-recorded", "line": 9 }
  ],
  "warnings": []
}
``````

A rule with no category anywhere is read, with a null category and a
warning. A context never gets that warning:

``````example parse
=== .lore/checkout.lore
<rule id="price-from-quote" severity="blocking">
A displayed price must come from the quote that produced it.
</rule>

<context id="checkout-architecture" src="ARCHITECTURE.md">
Read before judging any change to how a price is computed.
</context>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "price-from-quote", "file": ".lore/checkout.lore",
      "category": null, "severity": "blocking", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A displayed price must come from the quote that produced it.",
      "prose": "A displayed price must come from the quote that produced it.",
      "src": null
    },
    {
      "kind": "context", "id": "checkout-architecture", "file": ".lore/checkout.lore",
      "category": null, "severity": null, "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Read before judging any change to how a price is computed.",
      "prose": "Read before judging any change to how a price is computed.",
      "src": "ARCHITECTURE.md"
    }
  ],
  "errors": [],
  "warnings": [
    { "name": "missing-category", "file": ".lore/checkout.lore", "entry": "price-from-quote", "line": 1 }
  ]
}
``````

With a severity in neither the rule nor `<defaults>`, the rule is
advisory:

``````example parse
=== .lore/checkout.lore
<defaults>
category: functional_correctness
</defaults>

<rule id="price-from-quote">
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
  "errors": [],
  "warnings": []
}
``````

## Scope and globs

A **scope** says which files an entry can be broken in. A file's
`<scope>` file block is the scope of every entry in the file, and an
entry's own `<scope>` child narrows it (see [Children](#children)).

`<scope>` is a structured block (see
[Structured blocks](#structured-blocks)). Its value is a mapping with two
keys, both optional:

| Key | Value | Default |
|---|---|---|
| `files` | A non-empty list of globs. | `["**"]` |
| `ignores` | A list of globs. | `[]` |

- A path is **in** a scope when it matches at least one of the scope's
  `files` globs and none of its `ignores` globs.
- A glob is resolved against the base of the Lore file it is in: a path
  matches a glob `g` from base `b` when the path is below `b` and the
  rest of the path, after `b/`, matches `g`. At the repository root, the
  whole path is matched. The base is compared character by character,
  never read as a glob. For a file in an external folder, the base is
  the matching directory of the governed repo (see
  [External folders](#external-folders)).
- A file with no `<scope>` has the default scope, which holds every path
  under its base.
- An entry's scope is its file's scope **intersected** with its own
  `<scope>`: a path is in the entry's scope when it is in both. An
  entry's `<scope>` can only narrow its file's scope, never reach a path
  that the file's scope leaves out.
- A changed file is in an entry's scope when one of its paths is.
  [Eligibility](#eligibility) says which paths a deleted or renamed file
  has.

In the document model, an entry's `scopes` holds its file's scope (the
default one when the file has no `<scope>`), then its own `<scope>` when
it has one. Each has its defaults filled in and its globs resolved as
[Conformance examples](#conformance-examples) describes.

A tool checks a `<scope>` in this order, and reports the first problem it
finds:

1. the checks of [Structured blocks](#structured-blocks);
2. `invalid-scope`, when the value is not a mapping, has a key other
   than `files` and `ignores`, or has a `files` or `ignores` that is not a
   list of strings;
3. `empty-files`, when `files` is an empty list;
4. each glob, those in `files` first and then those in `ignores`, each
   list in order: `leading-slash` when the glob starts with `/`, then
   `invalid-glob` (see [Glob syntax](#glob-syntax)), then
   `glob-escapes-base` when one of its `/`-separated segments is `..`.

The shape is also given as
[`scope.schema.json`](schemas/scope.schema.json); where a name above
covers a value the schema rejects, that name applies instead of
`invalid-scope`.

- Paths in a scope are relative to the base, so a scope glob MUST NOT
  start with `/`. Only the `changed` and `unchanged` conditions allow a
  leading `/` (see [Conditions](#conditions)).
- A glob MUST NOT reach above its base. A `..` segment is
  `glob-escapes-base` even when the glob would come back down, as in
  `src/../lib/**`. This holds for every glob, including those in
  `changed` and `unchanged`.
- `<scope>` takes no attributes. An attribute on a file's `<scope>` is
  `unknown-attribute`; on an entry's, see [Children](#children).
- Every error in a file's `<scope>` is file-level, and every error in an
  entry's `<scope>` is entry-level. Apart from a YAML problem, the
  error's line is the `<scope>` opening tag line.

The file's scope takes in `.tsx` files below the checkout folder. The
second rule's own scope narrows that to `cart/`. `cart/totals.ts` is in
the rule's scope but not in the file's, and `apps/web/src/cart/` is
outside the base, so only the first rule is eligible:

``````example eligibility
=== apps/web/src/checkout/.lore/pricing.lore
<scope>
files: ["**/*.tsx"]
</scope>

<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<rule id="cart-total-from-quote" category="functional_correctness">
<scope>
files: ["cart/**"]
</scope>
Cart totals come from the quote, never from summing line items.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
M apps/web/src/checkout/cart/totals.ts
M apps/web/src/cart/CartTotal.tsx
=== expect
{ "eligible": ["price-from-quote"], "hits": [], "excluded": [], "warnings": [] }
``````

The same glob means different paths under different bases. At the root,
`*.json` matches only top-level files. Under `apps/web/src/checkout/`,
it matches the files directly in that folder:

``````example eligibility
=== .lore/manifests.lore
<scope>
files: ["*.json"]
</scope>

<rule id="manifest-versions-pinned" category="functional_correctness">
Dependencies in a top-level manifest are pinned to exact versions.
</rule>
=== apps/web/src/checkout/.lore/messages.lore
<scope>
files: ["*.json"]
</scope>

<rule id="checkout-messages-sorted" category="code_style">
Checkout message files keep their keys in alphabetical order.
</rule>
=== diff
M apps/web/src/checkout/messages.json
+14   "checkout.total": "Total",
=== expect
{ "eligible": ["checkout-messages-sorted"], "hits": [], "excluded": [], "warnings": [] }
``````

`ignores` takes paths out of a scope. `Cart.test.tsx` matches the first
file's `files`, but also its `ignores`:

``````example eligibility
=== apps/web/src/checkout/.lore/cart.lore
<scope>
files: ["**/*.{ts,tsx}"]
ignores: ["**/*.test.{ts,tsx}"]
</scope>

<rule id="cart-total-from-quote" category="functional_correctness">
Cart totals come from the quote, never from summing line items.
</rule>
=== apps/web/src/checkout/.lore/tests.lore
<scope>
files: ["**/*.test.{ts,tsx}"]
</scope>

<rule id="cart-tests-use-fixtures" category="test_coverage">
Cart tests build their carts from the shared quote fixtures.
</rule>
=== diff
M apps/web/src/checkout/Cart.test.tsx
+8   expect(total).toBe(42)
=== expect
{ "eligible": ["cart-tests-use-fixtures"], "hits": [], "excluded": [], "warnings": [] }
``````

**An empty scope.** An entry with its own `<scope>` gets the warning
`empty-scope`, at its `<scope>` opening tag line, when each of its
`files` globs is disjoint from each of its file scope's `files` globs.
Both are compared as written, since they resolve against the same base.
Two globs are **disjoint** when their heads conflict or their tails
conflict:

- A glob's **head** is its segments before the first segment that holds
  `*`, `?`, `[` or `{`. Two heads conflict when, at some position both
  of them have, their segments differ.
- A glob whose last segment is not `**` has a **tail**: the characters of
  its last segment after the last `*`, `?`, `]` or `}` in it, or the
  whole segment when it holds none of them. Two tails conflict when
  neither ends with the other. A glob with no tail conflicts with none.

The entry stays in the document model, and is never eligible when its
globs are disjoint. This is a deliberately simple test: it can miss an
entry whose scope holds nothing for another reason, which then gets no
warning.

The first rule asks for Markdown files in a file whose scope holds only
TypeScript files, so their tails conflict. The second rule's scope can
still hold a `price*.ts` file. In the second file, the heads `checkout`
and `cart` conflict:

``````example parse
=== .lore/checkout.lore
<scope>
files: ["**/*.ts"]
</scope>

<rule id="docs-link-changelog" category="documentation">
<scope>
files: ["**/*.md"]
</scope>
A documentation change links the changelog entry it describes.
</rule>

<rule id="money-type-for-prices" category="functional_correctness">
<scope>
files: ["**/*.md", "**/price*.ts"]
</scope>
Prices are typed as `Money`, never as `number`.
</rule>
=== apps/web/src/.lore/checkout.lore
<scope>
files: ["checkout/**"]
</scope>

<rule id="cart-total-from-quote" category="functional_correctness">
<scope>
files: ["cart/**"]
</scope>
Cart totals come from the quote, never from summing line items.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "docs-link-changelog", "file": ".lore/checkout.lore",
      "category": "documentation", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**/*.ts"], "ignores": [] }, { "files": ["**/*.md"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A documentation change links the changelog entry it describes.",
      "prose": "A documentation change links the changelog entry it describes.",
      "src": null
    },
    {
      "kind": "rule", "id": "money-type-for-prices", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**/*.ts"], "ignores": [] }, { "files": ["**/*.md", "**/price*.ts"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Prices are typed as `Money`, never as `number`.",
      "prose": "Prices are typed as `Money`, never as `number`.",
      "src": null
    },
    {
      "kind": "rule", "id": "cart-total-from-quote", "file": "apps/web/src/.lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/src/checkout/**"], "ignores": [] }, { "files": ["apps/web/src/cart/**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Cart totals come from the quote, never from summing line items.",
      "prose": "Cart totals come from the quote, never from summing line items.",
      "src": null
    }
  ],
  "errors": [],
  "warnings": [
    { "name": "empty-scope", "file": ".lore/checkout.lore", "entry": "docs-link-changelog", "line": 6 },
    { "name": "empty-scope", "file": "apps/web/src/.lore/checkout.lore", "entry": "cart-total-from-quote", "line": 6 }
  ]
}
``````

In the first file, `files` is a string rather than a list, then an empty
list, then a glob with a leading `/`, and an `ignores` glob climbs out
of `src/` and back. Each excludes only its rule. The same problems in a
file's `<scope>` exclude the whole file, and so does an attribute on it:

``````example parse
=== apps/web/.lore/web.lore
<rule id="price-from-quote" category="functional_correctness">
<scope>
files: "src/**"
</scope>
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness">
<scope>
files: []
</scope>
Display text never hard-codes a currency code.
</rule>

<rule id="dates-from-locale" category="functional_correctness">
<scope>
files: ["/apps/web/src/**"]
</scope>
Displayed dates are formatted with the shop's locale.
</rule>

<rule id="quote-expiry-shown" category="functional_correctness">
<scope>
files: ["src/**"]
ignores: ["src/../tests/**"]
</scope>
A page that shows a quoted price also shows when the quote expires.
</rule>

<rule id="totals-from-quote" category="functional_correctness">
<scope>
files: ["src/**"]
</scope>
Cart totals come from the quote, never from summing line items.
</rule>
=== apps/web/src/cart/.lore/cart.lore
<scope>
files: ["/apps/web/src/cart/**"]
</scope>

<rule id="cart-total-from-quote" category="functional_correctness">
Cart totals come from the quote, never from summing line items.
</rule>
=== apps/web/src/checkout/.lore/checkout.lore
<scope owner="checkout">
files: ["**/*.tsx"]
</scope>

<rule id="checkout-prices-from-quote" category="functional_correctness">
Every price the checkout page shows comes from the quote.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "totals-from-quote", "file": "apps/web/.lore/web.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/**"], "ignores": [] }, { "files": ["apps/web/src/**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "Cart totals come from the quote, never from summing line items.",
      "prose": "Cart totals come from the quote, never from summing line items.",
      "src": null
    }
  ],
  "errors": [
    { "name": "invalid-scope", "file": "apps/web/.lore/web.lore", "entry": "price-from-quote", "line": 2 },
    { "name": "empty-files", "file": "apps/web/.lore/web.lore", "entry": "currency-from-settings", "line": 9 },
    { "name": "leading-slash", "file": "apps/web/.lore/web.lore", "entry": "dates-from-locale", "line": 16 },
    { "name": "glob-escapes-base", "file": "apps/web/.lore/web.lore", "entry": "quote-expiry-shown", "line": 23 },
    { "name": "leading-slash", "file": "apps/web/src/cart/.lore/cart.lore", "entry": null, "line": 1 },
    { "name": "unknown-attribute", "file": "apps/web/src/checkout/.lore/checkout.lore", "entry": null, "line": 1 }
  ],
  "warnings": []
}
``````

### Glob syntax

A glob is matched against a path one segment at a time. Its segments
are the parts between its `/` characters, and each one matches one
segment of the path, except `**`:

| Syntax | Matches |
|---|---|
| `**`, as a whole segment | zero or more whole segments |
| `*` | any run of characters within a segment, including none |
| `?` | any one character |
| `[abc]`, `[a-z]` | one character in the set |
| `[!abc]`, `[!a-z]` | one character not in the set |
| `{a,b}` | any one of the alternatives |
| any other character | itself |

- Matching is by Unicode code point and case-sensitive, with no
  normalization. Apart from `**`, nothing in a glob matches `/`, so `*`,
  `?` and sets stay within one segment.
- `*` and `?` match a `.` at the start of a name like any other
  character, so `*` matches dotfiles and `**` matches dot-directories.
- A tool reads each segment from left to right. A `[` starts a set,
  which runs to its closing `]`: the first `]` after it, except that a
  `]` directly after `[` or `[!` is a member. Every character inside a
  set is a member or part of a range, so `*`, `?`, `[`, `{`, `}` and `,`
  in a set stand for themselves.
- A set's members are read from left to right. A character followed by
  `-` and then a character other than the closing `]` forms a range
  `x-y` with them: the characters from `x` to `y` by code point. Any
  other `-` is a member only when it is the set's first or last. So
  `[--a]` is the range from `-` to `a`, and `[a-]` holds `a` and `-`.
- Outside sets, a `{` starts alternatives, which close at the next `}`
  outside a set and are separated by each `,` outside a set between
  them. An alternative MAY be empty, and MAY hold `*`, `?` and sets.
- There is no escape character and no negation. A special character is
  matched by putting it in a set, so `[[]id].tsx` matches `[id].tsx` and
  `[{]slug}.tsx` matches `{slug}.tsx`. Outside sets, `]` is an ordinary
  character, and so are `}` and `,` outside alternatives. To leave paths
  out, use `ignores`.

A glob is `invalid-glob` when:

- it is empty, or one of its segments is empty (as in `src//a.ts` or
  `src/`) or is `.`;
- it starts with `!`;
- outside sets, it holds `**` in a segment that is not exactly `**`, as
  in `**.ts`;
- a set has no closing `]` in its segment, a `^` directly follows its
  `[`, one of its ranges ends before it starts, or a `-` in it is
  neither part of a range nor its first or last member;
- outside sets, a `{` has no closing `}` in its segment, or another `{`
  comes before that `}`;
- it holds a `\` anywhere, in a set or not.

`**` matches zero segments, so `apps/web/src/**/checkout/*.tsx` matches
`apps/web/src/checkout/Price.tsx`. `Price.tsx` starts with an uppercase
letter, so `[!A-Z]*.tsx` does not match it. `*` matches the leading
`.` of `.env.production`:

``````example eligibility
=== .lore/web.lore
<rule id="checkout-props-typed" category="code_style">
<scope>
files: ["apps/web/src/**/checkout/*.tsx"]
</scope>
Every checkout component declares its props type.
</rule>

<rule id="checkout-helpers-pure" category="code_style">
<scope>
files: ["apps/web/src/checkout/[!A-Z]*.tsx"]
</scope>
Checkout files named in lowercase hold helpers, never components.
</rule>

<rule id="cart-components-named" category="code_style">
<scope>
files: ["apps/web/src/{cart,checkout}/*.tsx"]
</scope>
A cart or checkout component is named after its file.
</rule>

<rule id="production-env-no-secrets" category="security">
<scope>
files: ["apps/web/*.production"]
</scope>
A production environment file holds no secrets; they come from the
secret store.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
M apps/web/.env.production
+3 PRICE_API_URL=https://prices.acme.example
=== expect
{
  "eligible": ["cart-components-named", "checkout-props-typed", "production-env-no-secrets"],
  "hits": [],
  "excluded": [],
  "warnings": []
}
``````

An unclosed set, an unclosed brace, `**` inside a longer segment and a
leading `!` are each `invalid-glob`. A `[` or `{` inside a set is an
ordinary member, so the last rule's globs match the files
`pages/[id].tsx` and `pages/{slug}.tsx`:

``````example parse
=== apps/web/.lore/pages.lore
<rule id="price-from-quote" category="functional_correctness">
<scope>
files: ["src/[a"]
</scope>
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness">
<scope>
files: ["src/**/*.{ts,tsx"]
</scope>
Display text never hard-codes a currency code.
</rule>

<rule id="dates-from-locale" category="functional_correctness">
<scope>
files: ["src/**.tsx"]
</scope>
Displayed dates are formatted with the shop's locale.
</rule>

<rule id="tests-use-fixtures" category="test_coverage">
<scope>
files: ["src/**"]
ignores: ["!**/*.test.tsx"]
</scope>
Tests build their data from the shared fixtures.
</rule>

<rule id="product-page-prices" category="functional_correctness">
<scope>
files: ["pages/[[]id].tsx", "pages/[{]slug}.tsx"]
</scope>
The product page shows the price from the product's current quote.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "product-page-prices", "file": "apps/web/.lore/pages.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/**"], "ignores": [] }, { "files": ["apps/web/pages/[[]id].tsx", "apps/web/pages/[{]slug}.tsx"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "The product page shows the price from the product's current quote.",
      "prose": "The product page shows the price from the product's current quote.",
      "src": null
    }
  ],
  "errors": [
    { "name": "invalid-glob", "file": "apps/web/.lore/pages.lore", "entry": "price-from-quote", "line": 2 },
    { "name": "invalid-glob", "file": "apps/web/.lore/pages.lore", "entry": "currency-from-settings", "line": 9 },
    { "name": "invalid-glob", "file": "apps/web/.lore/pages.lore", "entry": "dates-from-locale", "line": 16 },
    { "name": "invalid-glob", "file": "apps/web/.lore/pages.lore", "entry": "tests-use-fixtures", "line": 23 }
  ],
  "warnings": []
}
``````

## Conditions

`<when>` is a child of a rule or a context that holds conditions on the
change. It is a structured block (see
[Structured blocks](#structured-blocks)), and its value is a mapping in
which each key is a condition. An entry with a `<when>` is eligible only
when every one of its conditions holds.

| Key | Value | Holds when |
|---|---|---|
| `addedContains` | A list of strings. | An added line of a counted file contains one of the strings. |
| `addedMatches` | A list of patterns (see [Regex dialect](#regex-dialect)). | An added line of a counted file matches one of the patterns. |
| `changed` | A list of globs. | A changed file anywhere in the change matches one of the globs. |
| `unchanged` | A list of globs. | No changed file anywhere in the change matches any of the globs. |

- An entry's **counted files** are the changed files in its scope,
  apart from those that a `.loreconfig` `disable` list switches the entry
  off for (see [.loreconfig](#loreconfig)).
- An **added line's text** is the line as it is in the file's new
  version, without its line break: the line feed, and a carriage return
  directly before it. A line that is not valid UTF-8 is decoded for
  matching by replacing each maximal subpart of an ill-formed sequence
  with one U+FFFD, the practice the Unicode Standard recommends (U+FFFD
  substitution of maximal subparts) and the WHATWG Encoding Standard's
  UTF-8 decoder follows. A maximal subpart is the longest run of bytes,
  starting at the first byte that cannot be decoded, that is the start of
  some well-formed UTF-8 sequence, or that one byte when it starts none.
  In a conformance example it is the `<text>` of a
  `+<n> <text>` line. Only added lines count. The unchanged lines around
  them and removed lines never do.
- `addedContains` compares code point by code point and is
  case-sensitive: a string is contained in a line when it occurs anywhere
  in the line's text.
- `addedMatches` searches each line's text for each pattern, as
  [Regex dialect](#regex-dialect) defines.
- `changed` and `unchanged` look at every path of every changed file in
  the change, in the entry's scope or not and whatever `disable` says.
  They are the only conditions that look past the entry's scope, because
  files that change together are a property of the whole change. A rule
  like `regen-types-after-graphql` below is eligible only when the
  generated files were left out of the change.
- A `changed` or `unchanged` glob MAY start with `/`. It then resolves
  from the governed repo's root (for an external folder, from the
  directory its `repo` key marks), and the rest of the glob, after the
  `/`, is read as [Glob syntax](#glob-syntax) defines. A glob without a
  leading `/` resolves against the base, as in a scope.
- With an empty list, `unchanged` always holds and the other three
  conditions never do.
- When a rule is eligible, each added line of a counted file that one of
  its `addedContains` or `addedMatches` conditions finds is a hit, as a
  check's would be (see [Running checks](#running-checks)). All of the
  conditions together decide eligibility; each added-line condition then
  points at the lines it finds on its own. A context has no hits.

A tool checks a `<when>` in this order, and reports the first problem it
finds:

1. the checks of [Structured blocks](#structured-blocks);
2. `invalid-when`, when the value is not a mapping;
3. `empty-when`, when the mapping has no keys, as with an empty block;
4. `unknown-condition`, when a key is not one of the four above;
5. each condition, in the order of the table above: `invalid-when` when
   its value is not a list of strings, or when an `addedContains` string
   is empty or holds a line feed or a carriage return; then each item of
   the list in order. A pattern is checked
   for `regex-not-one-line` and then `regex-outside-dialect` (see
   [Regex dialect](#regex-dialect)), and a glob for `invalid-glob` and
   then `glob-escapes-base` (see [Scope and globs](#scope-and-globs)).

The shape is also given as
[`when.schema.json`](schemas/when.schema.json); where a name above covers
a value the schema rejects, that name applies instead of `invalid-when`.
Every error in a `<when>` is entry-level. Apart from a YAML problem, its
line is the `<when>` opening tag line. A tool MUST NOT ignore a key it
does not know, so a file never means less than its author wrote. A
condition on removed lines is reserved for a later version. In the
document model, `when` is the mapping as parsed, with its globs as
written, or null when the entry has no `<when>`.

Only added lines count. `'USD'` is on an unchanged line of `Price.tsx`,
so the first rule is not eligible. The third rule's scope holds
`format.ts` but not `Price.tsx`, so the `parseFloat(` on the added line of
`Price.tsx` does not count for it. The line the second rule's condition
finds is a hit:

``````example eligibility
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
<when>
addedContains: ["'USD'", "'EUR'"]
</when>
Display text never hard-codes a currency code.
</rule>

<rule id="prices-not-parsed" category="functional_correctness">
<when>
addedContains: ["parseFloat("]
</when>
A price is never parsed from text with `parseFloat`.
</rule>

<rule id="helpers-not-parsing-prices" category="functional_correctness">
<scope>
files: ["**/*.ts"]
</scope>
<when>
addedContains: ["parseFloat("]
</when>
Checkout helpers never parse a price from text.
</rule>
=== apps/web/src/checkout/Price.tsx
const fallbackCurrency = 'USD'

export function Price({ quote }) {
  const amount = parseFloat(quote.total)
  return <span>{amount}</span>
}
=== diff
M apps/web/src/checkout/Price.tsx
+4   const amount = parseFloat(quote.total)
M apps/web/src/checkout/format.ts
+1 export const ZERO = '0.00'
=== expect
{
  "eligible": ["prices-not-parsed"],
  "hits": [
    { "rule": "prices-not-parsed", "file": "apps/web/src/checkout/Price.tsx", "line": 4, "text": "  const amount = parseFloat(quote.total)" }
  ],
  "excluded": [],
  "warnings": []
}
``````

A pattern in `addedMatches` is searched for in each added line. `^`
matches only at the start of the line's text, which here starts with
spaces:

``````example eligibility
=== apps/web/src/checkout/.lore/prices.lore
<rule id="no-price-literals" category="functional_correctness">
<when>
addedMatches: ['\d+\.\d{2}']
</when>
A price is never written as a number literal in checkout code.
</rule>

<rule id="shipping-from-quote" category="functional_correctness">
<when>
addedMatches: ['^const shipping']
</when>
Shipping costs come from the quote.
</rule>
=== diff
M apps/web/src/checkout/Shipping.tsx
+7   const shipping = 4.99
=== expect
{
  "eligible": ["no-price-literals"],
  "hits": [
    { "rule": "no-price-literals", "file": "apps/web/src/checkout/Shipping.tsx", "line": 7, "text": "  const shipping = 4.99" }
  ],
  "excluded": [],
  "warnings": []
}
``````

Each added line that the rule's condition finds is a hit. Its check also
finds line 5, which is still one hit. The context is eligible, and has
no hits:

``````example eligibility
requires: regex
=== .lore/money.lore
<rule id="money-in-minor-units" category="functional_correctness">
<when>
addedContains: ["parseFloat(", "toFixed("]
</when>
<check>
toFixed\(
</check>
Amounts are integers in minor units (cents).
</rule>

<context id="rounding-guide" src="docs/rounding.md">
<when>
addedContains: ["toFixed("]
</when>
Read before changing how amounts are rounded.
</context>
=== docs/rounding.md
# Rounding
=== diff
M apps/web/src/checkout/Price.tsx
+4   const amount = parseFloat(quote.total)
+5   return amount.toFixed(2)
+6   return amount
=== expect
{
  "eligible": ["money-in-minor-units", "rounding-guide"],
  "hits": [
    { "rule": "money-in-minor-units", "file": "apps/web/src/checkout/Price.tsx", "line": 4, "text": "  const amount = parseFloat(quote.total)" },
    { "rule": "money-in-minor-units", "file": "apps/web/src/checkout/Price.tsx", "line": 5, "text": "  return amount.toFixed(2)" }
  ],
  "excluded": [],
  "warnings": []
}
``````

`changed` looks at the whole change. The API schema is outside the
rule's scope and its base, and the condition still holds:

``````example eligibility
=== apps/web/src/checkout/.lore/api.lore
<rule id="checkout-follows-api-schema" category="backwards_compatibility">
<scope>
files: ["**/*.tsx"]
</scope>
<when>
changed: ["/apps/api/schema.graphql"]
</when>
A checkout change made alongside an API schema change still works with
the schema that is deployed now.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
M apps/api/schema.graphql
=== expect
{ "eligible": ["checkout-follows-api-schema"], "hits": [], "excluded": [], "warnings": [] }
``````

The generated types changed, so `regen-types-after-graphql` is not
eligible: there is nothing to remind the author of. Its glob starts with
`/`, so it resolves from the repository root. The second rule's glob has
no `/`, so it resolves against the base, to
`apps/web/src/checkout/__generated__/**`. Nothing there changed, and that
rule is eligible:

``````example eligibility
=== apps/web/src/checkout/.lore/graphql.lore
<scope>
files: ["**/*.graphql"]
</scope>

<rule id="regen-types-after-graphql" category="functional_correctness">
<when>
unchanged: ["/apps/web/src/__generated__/**"]
</when>
A `.graphql` change ships with regenerated types in
`apps/web/src/__generated__/`.
</rule>

<rule id="regen-checkout-types-after-graphql" category="functional_correctness">
<when>
unchanged: ["__generated__/**"]
</when>
A `.graphql` change ships with regenerated types in the checkout's own
`__generated__/` folder.
</rule>
=== diff
M apps/web/src/checkout/quote.graphql
+3   total: Money!
M apps/web/src/__generated__/graphql.ts
+120   total: Money;
=== expect
{ "eligible": ["regen-checkout-types-after-graphql"], "hits": [], "excluded": [], "warnings": [] }
``````

With an empty list, `addedContains` never holds and `unchanged` always
does. A rename changes two paths, and `changed` and `unchanged` see
both: the old path `Price.tsx` makes `price-imports-updated` eligible
and `price-shown-with-component` not:

``````example eligibility
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
<when>
addedContains: []
</when>
Display text never hard-codes a currency code.
</rule>

<rule id="price-from-quote" category="functional_correctness">
<when>
unchanged: []
</when>
A displayed price must come from the quote that produced it.
</rule>

<rule id="price-imports-updated" category="functional_correctness">
<when>
changed: ["/apps/web/src/checkout/Price.tsx"]
</when>
When `Price.tsx` moves or changes, every import of it is updated.
</rule>

<rule id="price-shown-with-component" category="code_style">
<when>
unchanged: ["/apps/web/src/checkout/Price.tsx"]
</when>
A price is shown with the `Price` component, never formatted by hand.
</rule>
=== diff
R apps/web/src/checkout/Price.tsx -> apps/web/src/checkout/QuotedPrice.tsx
+3 export function QuotedPrice({ quote }) {
=== expect
{ "eligible": ["price-from-quote", "price-imports-updated"], "hits": [], "excluded": [], "warnings": [] }
``````

An unknown key is an error, even next to another problem: it is checked
before the shape of each condition. A `<when>` with no conditions is an
error, and so is a condition whose value is not a list. A `..` segment
is not allowed in `changed`, while a leading `/` is:

``````example parse
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
<when>
addedContains: "'USD'"
removedContains: ["'USD'"]
</when>
Display text never hard-codes a currency code.
</rule>

<rule id="price-from-quote" category="functional_correctness">
<when>
</when>
A displayed price must come from the quote that produced it.
</rule>

<rule id="regen-types-after-graphql" category="functional_correctness">
<when>
unchanged: "/apps/web/src/__generated__/**"
</when>
A `.graphql` change ships with regenerated types.
</rule>

<rule id="checkout-follows-api-schema" category="backwards_compatibility">
<when>
changed: ["apps/web/../api/schema.graphql"]
</when>
A checkout change made alongside an API schema change still works with
the schema that is deployed now.
</rule>

<rule id="checkout-follows-api" category="backwards_compatibility">
<when>
changed: ["/apps/api/**"]
addedContains: ["fetch("]
</when>
New checkout requests work with the API that is deployed now.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "checkout-follows-api", "file": ".lore/checkout.lore",
      "category": "backwards_compatibility", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": { "changed": ["/apps/api/**"], "addedContains": ["fetch("] }, "checks": [], "meta": null,
      "summary": "New checkout requests work with the API that is deployed now.",
      "prose": "New checkout requests work with the API that is deployed now.",
      "src": null
    }
  ],
  "errors": [
    { "name": "unknown-condition", "file": ".lore/checkout.lore", "entry": "currency-from-settings", "line": 2 },
    { "name": "empty-when", "file": ".lore/checkout.lore", "entry": "price-from-quote", "line": 10 },
    { "name": "invalid-when", "file": ".lore/checkout.lore", "entry": "regen-types-after-graphql", "line": 16 },
    { "name": "glob-escapes-base", "file": ".lore/checkout.lore", "entry": "checkout-follows-api-schema", "line": 23 }
  ],
  "warnings": []
}
``````

## Regex dialect

`addedMatches` patterns and `regex` checks share one dialect of regular
expressions, so that every tool finds the same matches, whatever engine
it uses. Its syntax is a subset of ECMAScript's, limited to what
RE2-style engines support, and this section fixes its meaning as well
as its syntax.

A pattern is matched against the text of one added line at a time (see
[Conditions](#conditions)), which holds no line break. The match is an
unanchored search: the line matches when the pattern matches starting at
some position in its text. Characters are Unicode code points, and
matching is case-sensitive. Only whether a line matches counts, never
which part of it.

| Syntax | Matches |
|---|---|
| A character other than `\`, `^`, `$`, `.`, `\|`, `?`, `*`, `+`, `(`, `)`, `[`, `]`, `{`, `}` | itself |
| `.` | any one character |
| `\` and an ASCII punctuation character (a printable ASCII character that is not a letter, a digit or a space) | that character: `\.` matches `.`, `\{` matches `{` |
| `\t`, `\n`, `\v`, `\f`, `\r` | a tab, line feed, vertical tab, form feed, carriage return |
| `\x` and two hex digits (`0`-`9`, `a`-`f`, `A`-`F`) | the character with that code, from U+0000 to U+00FF |
| `\d`, `\D` | an ASCII digit `0` to `9`; any other character |
| `\w`, `\W` | an ASCII letter, an ASCII digit or `_`; any other character |
| `\s`, `\S` | a space, tab, line feed, vertical tab, form feed or carriage return; any other character |
| `[...]`, `[^...]` | one character in the set; one character not in it |
| `^`, `$` | the start of the text; the end of the text |
| `\b`, `\B` | a word boundary; a position that is not one |
| `(x)`, `(?:x)` | `x`, as a group |
| `x\|y` | `x` or `y` |
| `x*`, `x+`, `x?` | `x` zero or more times, one or more times, zero times or once |
| `x{n}`, `x{n,}`, `x{n,m}` | `x` exactly `n` times, at least `n` times, from `n` to `m` times |

- A **word boundary** is a position with a `\w` character on one side,
  and on the other a character that is not `\w` or the start or end of
  the text. `\w` is ASCII, so `é` and `٣` are not word characters.
- In `{n}`, `{n,}` and `{n,m}`, `n` and `m` are decimal numbers with no
  leading zero (`0` itself is allowed), at most 1000, and `n` is not
  more than `m`. A `{}` quantifier's bound is its `m`, or its `n` when it
  has no `m`, and is counted as 1 when that number is 0. The product of
  the bounds of a `{}` quantifier and of every `{}` quantifier on a group
  that holds it is at most 1000, so `(a{10}){100}` is allowed and
  `(a{10}){101}` is not.
- `{` always starts a quantifier, so a literal `{` is written `\{`. A
  literal `}` or `]` is written `\}` or `\]`.
- An alternative or a group MAY be empty: `a|`, `(|s)`, `()` and `(?:)`
  are all in the dialect. An empty alternative matches the empty
  string.
- A quantifier MAY be followed by `?`, which makes it lazy. Laziness
  changes which part of a line matches, so it changes no result.
- A set holds one or more members up to its closing `]`, the first
  unescaped `]` after it. A member is a character other than `\`, `[`
  and `]`; an escape from the table that stands for one character, such
  as `\]`, `\-`, `\t` or `\x41`; or one of the class escapes `\d`, `\D`,
  `\w`, `\W`, `\s` and `\S`. A `^` directly after `[` makes the set
  negated; a `^` anywhere else is a member.
- A set's members are read from left to right. A member that stands for
  one character, followed by an unescaped `-` and then another such
  member, forms a range `x-y` with them: the characters from `x` to `y`
  by code point, where `x` is not after `y`. Any other unescaped `-` is
  a member only when it is the set's first or last. So `[a\-z]` holds
  three members, `[--a]` is the range from `-` to `a`, and `[a-]` holds
  `a` and `-`.
- There are no flags, inline or otherwise. Matching is always as above.
  To match without regard to case, write the cases out:
  `[Uu][Ss][Dd]`.

Anything else is `regex-outside-dialect`. That includes:

- any group that starts with `(?` other than `(?:`: lookahead and
  lookbehind (`(?=`, `(?!`, `(?<=`, `(?<!`), named groups (`(?<code>` or
  `(?P<code>`) and inline flags (`(?i)`, `(?i:`);
- backreferences (`\1` to `\9`, `\k<code>`), and every other escape not
  in the table, such as `\0`, `\A`, `\z`, `\p{L}`, `\u0041`, `\cJ` and
  `\é`, and `\b` or `\B` inside a set (`[\b]`);
- a `{` that does not start a quantifier as described, as in `a{`,
  `a{,2}`, `a{01}`, `a{1001}` or `(a{10}){101}`, and an unescaped `}` or
  `]` outside a set;
- a quantifier with nothing to repeat: at the start of the pattern, a
  group or an alternative, after `^`, `$`, `\b` or `\B`, or after another
  quantifier other than as its lazy `?`;
- a group or set that is not closed, a `)` that closes no group, an
  empty set (`[]`, `[^]`), an unescaped `[` in a set, a range whose end
  comes before its start or that uses a class escape, and an unescaped
  `-` in a set that is neither part of a range nor its first or last
  member;
- the empty pattern. (An empty alternative or group is allowed, as
  above; a pattern with no characters at all is not.)

A pattern MUST be one line. In `addedMatches`, a pattern holding a line
feed or a carriage return is `regex-not-one-line`, and
[Checks](#checks) says when a `regex` check is `regex-not-one-line`. A
pattern is checked for `regex-not-one-line` first, then for
`regex-outside-dialect`. Both are entry-level errors, at the opening tag
line of the `<when>` or `<check>` that holds the pattern.

A tool can run the dialect on an existing engine by translating it. For
example, an ECMAScript engine needs its `u` flag, so that it reads code
points, and its `s` flag, so that `.` matches every character. It also
needs `\s` and `\S` written out as sets, since its own are not ASCII, and
needs punctuation escapes that its `u` flag rejects, such as `\'`,
written as the character. An RE2-style engine, such as Go's, needs `\s`
and `\S` written out too, since its `\s` leaves out the vertical tab.
Rust's and Python's standard engines make `\d`, `\w`, `\s` and `\b`
match Unicode by default and need their ASCII modes, and some engines,
such as Rust's, read `\<` and `\>` as word boundaries and `&&`, `--` and
`~~` in a set as set operations, so a translation writes those
characters so that the engine reads them literally.

Each of the first five patterns is outside the dialect: a lookahead, a
backreference, a named group, an inline flag, and a `{` that starts no
quantifier. Escaped, the brace is accepted, in `addedMatches` and in a
check alike:

``````example parse
=== .lore/checkout.lore
<rule id="currency-before-amount" category="functional_correctness">
<when>
addedMatches: ['USD(?=\d)']
</when>
A currency code is never written in front of an amount.
</rule>

<rule id="no-repeated-digits" category="functional_correctness">
<check>
(\d)\1
</check>
A price is never written with a placeholder of repeated digits.
</rule>

<rule id="currency-codes-from-settings" category="functional_correctness">
<when>
addedMatches: ['(?<code>USD|EUR)']
</when>
Display text never hard-codes a currency code.
</rule>

<rule id="currency-codes-any-case" category="functional_correctness">
<when>
addedMatches: ['(?i)usd']
</when>
Display text never hard-codes a currency code, in any case.
</rule>

<rule id="no-inline-styles" category="code_style">
<when>
addedMatches: ['style={']
</when>
Components never set inline styles.
</rule>

<rule id="no-inline-style-objects" category="code_style">
<when>
addedMatches: ['style=\{']
</when>
<check>
style=\{\{
</check>
Components never set inline styles; they use the design system's
classes.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "no-inline-style-objects", "file": ".lore/checkout.lore",
      "category": "code_style", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": { "addedMatches": ["style=\\{"] },
      "checks": [{ "lang": "regex", "body": "style=\\{\\{" }],
      "meta": null,
      "summary": "Components never set inline styles; they use the design system's classes.",
      "prose": "Components never set inline styles; they use the design system's\nclasses.",
      "src": null
    }
  ],
  "errors": [
    { "name": "regex-outside-dialect", "file": ".lore/checkout.lore", "entry": "currency-before-amount", "line": 2 },
    { "name": "regex-outside-dialect", "file": ".lore/checkout.lore", "entry": "no-repeated-digits", "line": 9 },
    { "name": "regex-outside-dialect", "file": ".lore/checkout.lore", "entry": "currency-codes-from-settings", "line": 16 },
    { "name": "regex-outside-dialect", "file": ".lore/checkout.lore", "entry": "currency-codes-any-case", "line": 23 },
    { "name": "regex-outside-dialect", "file": ".lore/checkout.lore", "entry": "no-inline-styles", "line": 30 }
  ],
  "warnings": []
}
``````

`٣` is ARABIC-INDIC DIGIT THREE (U+0663). It is neither an ASCII digit
nor an ASCII word character, so `\d` does not match it, and there is a
word boundary between it and `U`:

``````example eligibility
=== .lore/labels.lore
<rule id="price-digits-from-formatter" category="functional_correctness">
<when>
addedMatches: ['\d']
</when>
Prices in labels are formatted by the shop's number formatter, never
written as digits.
</rule>

<rule id="currency-code-from-settings" category="functional_correctness">
<when>
addedMatches: ['\bUSD\b']
</when>
Display text never spells out a currency code.
</rule>
=== diff
M apps/web/src/checkout/labels.ts
+4 export const price = '٣USD'
=== expect
{
  "eligible": ["currency-code-from-settings"],
  "hits": [
    { "rule": "currency-code-from-settings", "file": "apps/web/src/checkout/labels.ts", "line": 4, "text": "export const price = '٣USD'" }
  ],
  "excluded": [],
  "warnings": []
}
``````

Line 4 holds a no-break space (U+00A0) between `Total` and `USD`. `\s`
is ASCII, so it does not match that space. An added line's text holds
no line break, so `$` matches right after the `'` that ends line 5:

``````example eligibility
=== .lore/labels.lore
<rule id="total-label-translated" category="functional_correctness">
<when>
addedMatches: ['Total\sUSD']
</when>
The total's label comes from the shop's translated strings.
</rule>

<rule id="fallback-currency-from-settings" category="functional_correctness">
<when>
addedMatches: ["USD'$"]
</when>
A fallback currency comes from the shop's settings, never from a literal.
</rule>
=== diff
M apps/web/src/checkout/labels.ts
+4 export const heading = 'Total USD:'
+5 const fallback = 'USD'
=== expect
{
  "eligible": ["fallback-currency-from-settings"],
  "hits": [
    { "rule": "fallback-currency-from-settings", "file": "apps/web/src/checkout/labels.ts", "line": 5, "text": "const fallback = 'USD'" }
  ],
  "excluded": [],
  "warnings": []
}
``````

An empty alternative matches the empty string, so `(|export )` matches
whether or not the line starts with `export `. The empty groups `()`
and `(?:)` match the empty string too:

``````example eligibility
=== .lore/tax.lore
<rule id="tax-rate-from-settings" category="functional_correctness">
<when>
addedMatches: ['^(|export )const(?:) TAX_RATE()']
</when>
The tax rate comes from the shop's settings, never from a constant.
</rule>
=== diff
M apps/web/src/checkout/tax.ts
+1 const TAX_RATE = 0.2
=== expect
{
  "eligible": ["tax-rate-from-settings"],
  "hits": [
    { "rule": "tax-rate-from-settings", "file": "apps/web/src/checkout/tax.ts", "line": 1, "text": "const TAX_RATE = 0.2" }
  ],
  "excluded": [],
  "warnings": []
}
``````

## Checks

A `<check>` is a child of a rule that holds a search. When the rule is
eligible, a tool runs the search over the rule's counted files (see
[Conditions](#conditions)), and its **hits** go to the reviewer with
the rule. A hit is a pointer to a line, never a verdict: a hit does not
mean the rule is broken, and no hits does not mean it passed.

A rule's `addedContains` and `addedMatches` conditions already point at
the lines they find (see [Conditions](#conditions)). A check is for a
search that should not decide whether the rule is eligible, or one that
a condition cannot express, such as an `ast-grep` pattern.

A rule MAY have any number of checks. A context has none (see
[Context](#context)).

- `<check>` takes one attribute, `lang`, the check's language. Without
  it, the language is `regex`. `lang` with no value, or with the empty
  value `lang=""`, is `invalid-attribute-value`. Any other attribute is
  `unknown-attribute`.
- This specification defines two languages, `regex` and `ast-grep`. Any
  other `lang` value is kept as written: it is a language no conforming
  tool supports (see below), not an error.
- A check's **body** is the lines strictly between its tags, after the
  entry's common indentation and then the check's own are removed (see
  [Indentation](#indentation)), joined with line feeds. Nothing else is
  trimmed: a blank line is kept as an empty line, and spaces at the end
  of a line are part of the body.
- A `regex` body is one pattern in the
  [Regex dialect](#regex-dialect). A body of two or more lines is
  `regex-not-one-line`. Otherwise, a body outside the dialect, the empty
  body included, is `regex-outside-dialect`.
- A tool checks a `<check>` as [Children](#children) describes, and its
  contents last: for a `regex` check, `regex-not-one-line` and then
  `regex-outside-dialect`. A body in any other language is not checked
  when parsing. These two checks are part of parsing, so they bind every
  tool that parses Lore files, whether or not it runs `regex` checks.
- Every error in a `<check>` is entry-level, at its opening tag line.
- In the document model, `checks` lists each check's `lang` and `body`,
  in the order the checks appear, with `lang` `"regex"` for a check that
  has no `lang`.

A two-line `regex` check is an error, and so is `lang` with no value or
an empty one. A language this specification does not define is kept,
and an `ast-grep` body may span lines:

``````example parse
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
<check>
'USD'
|'EUR'
</check>
Display text never hard-codes a currency code.
</rule>

<rule id="price-from-quote" category="functional_correctness">
<check lang>
quote\.total
</check>
A displayed price must come from the quote that produced it.
</rule>

<rule id="dates-from-locale" category="functional_correctness">
<check lang="">
toLocaleDateString\(\)
</check>
Displayed dates are formatted with the shop's locale.
</rule>

<rule id="totals-from-quote" category="functional_correctness">
<check lang="structural">
items.reduce(...)
</check>
<check lang="ast-grep">
$ITEMS.reduce(
  $$$
)
</check>
Cart totals come from the quote, never from summing line items.
</rule>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "totals-from-quote", "file": ".lore/checkout.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["**"], "ignores": [] }],
      "when": null,
      "checks": [
        { "lang": "structural", "body": "items.reduce(...)" },
        { "lang": "ast-grep", "body": "$ITEMS.reduce(\n  $$$\n)" }
      ],
      "meta": null,
      "summary": "Cart totals come from the quote, never from summing line items.",
      "prose": "Cart totals come from the quote, never from summing line items.",
      "src": null
    }
  ],
  "errors": [
    { "name": "regex-not-one-line", "file": ".lore/checkout.lore", "entry": "currency-from-settings", "line": 2 },
    { "name": "invalid-attribute-value", "file": ".lore/checkout.lore", "entry": "price-from-quote", "line": 10 },
    { "name": "invalid-attribute-value", "file": ".lore/checkout.lore", "entry": "dates-from-locale", "line": 17 }
  ],
  "warnings": []
}
``````

### Running checks

A tool runs the checks of every eligible rule, and of no other rule.
Each check searches the rule's counted files that have added lines; a
deleted file has none. A **hit** names the rule, the changed file (by
its new path), the number of an added line, and that line's text (see
[Conditions](#conditions)). An eligible rule's hits are those of its
checks and those of its added-line conditions. A rule has at most one
hit per file and line, however many of its checks or conditions find
that line.

A `regex` check has a hit for each added line whose text its pattern
matches, as [Regex dialect](#regex-dialect) defines.

Supporting a check language is OPTIONAL for a conforming tool, language
by language. A tool that does not support a check's language, which
includes every language this specification does not define, MUST skip
that check and report the warning `unsupported-check-language` for it,
at the check's opening tag line. The rule stays eligible, and its other
checks still run. Only the checks of eligible rules are reported this
way, and the document model never carries this warning. A plain agent
with no tooling MAY read any check as a hint about what to look for.

The first check has no `lang`, so it is a `regex` check. Both checks
find line 4 of `Summary.tsx`, which gives one hit. `currency.ts` is
outside the scope. The second rule is not eligible, so its check is not
run:

``````example eligibility
requires: regex
=== apps/web/src/checkout/.lore/display.lore
<scope>
files: ["**/*.tsx"]
</scope>

<rule id="currency-from-settings" category="functional_correctness">
<check>
'(USD|EUR)'
</check>
<check lang="regex">
'EUR'
</check>
Display text never hard-codes a currency code.
</rule>

<rule id="currency-symbols-from-settings" category="functional_correctness">
<when>
addedContains: ["$"]
</when>
<check>
'USD'
</check>
Display text never hard-codes a currency symbol.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
+12   const label = 'USD'
+13   const note = "EUR"
M apps/web/src/checkout/Summary.tsx
+4   return <span>{'EUR'} {total}</span>
M apps/web/src/checkout/currency.ts
+2 export const DEFAULT_CURRENCY = 'USD'
=== expect
{
  "eligible": ["currency-from-settings"],
  "hits": [
    { "rule": "currency-from-settings", "file": "apps/web/src/checkout/Price.tsx", "line": 12, "text": "  const label = 'USD'" },
    { "rule": "currency-from-settings", "file": "apps/web/src/checkout/Summary.tsx", "line": 4, "text": "  return <span>{'EUR'} {total}</span>" }
  ],
  "excluded": [],
  "warnings": []
}
``````

The first check's language is not one this specification defines, so
the tool skips it and warns. The `regex` check still runs. The second
rule is not eligible, so its unsupported check is not reported:

``````example eligibility
requires: regex
=== .lore/checkout.lore
<rule id="totals-from-quote" category="functional_correctness">
<check lang="structural">
items.reduce(...)
</check>
<check>
\.reduce\(
</check>
Cart totals come from the quote, never from summing line items.
</rule>

<rule id="refund-totals-from-quote" category="functional_correctness">
<scope>
files: ["apps/web/src/refunds/**"]
</scope>
<check lang="structural">
refund.items.reduce(...)
</check>
Refund totals come from the quote, never from summing refunded items.
</rule>
=== diff
M apps/web/src/checkout/CartTotal.tsx
+3   const total = items.reduce(
=== expect
{
  "eligible": ["totals-from-quote"],
  "hits": [
    { "rule": "totals-from-quote", "file": "apps/web/src/checkout/CartTotal.tsx", "line": 3, "text": "  const total = items.reduce(" }
  ],
  "excluded": [],
  "warnings": [
    { "name": "unsupported-check-language", "file": ".lore/checkout.lore", "entry": "totals-from-quote", "line": 2 }
  ]
}
``````

### ast-grep checks

An `ast-grep` check holds one pattern for the structural search tool
ast-grep, and may span several lines. This specification follows
**ast-grep 0.51.0**: a pattern is read with that release's pattern
syntax, and a tool that supports `ast-grep` checks finds the same
matches that release finds.

- A pattern SHOULD use no metavariables other than `$NAME`, which matches
  one node, and `$$$` or `$$$NAME`, which match zero or more nodes, and
  no other ast-grep feature, so that it keeps its meaning in later
  releases.
- A file's language comes from its extension: the part of its name
  after the last `.`, when that `.` is not the name's first character.
  Extensions are compared case-sensitively, with the table below, which
  is the built-in list of ast-grep 0.51.0. A renamed file's extension
  comes from its new path.
- A file the check searches whose name has no extension in the table is
  skipped,
  and the tool reports the warning `ast-grep-no-language` for it, once
  for each rule and skipped file. The warning's `file` is the skipped
  file's new path, its `entry` is the rule's id, and its line is 1.
- Otherwise the pattern is matched against the whole new version of the
  file, in its language, as ast-grep 0.51.0 matches it with its default
  options (no project configuration, default strictness). A match covers
  the lines from the line of its first character to the line of its
  last. Each added line that a match covers is a hit. When ast-grep
  0.51.0 cannot read the pattern in a file's language, the check finds
  nothing in that file.

| Language | Extensions |
|---|---|
| Bash | `bash`, `bats`, `cgi`, `command`, `env`, `fcgi`, `ksh`, `sh`, `tmux`, `tool`, `zsh` |
| C | `c`, `h` |
| Cpp | `cc`, `hpp`, `cpp`, `c++`, `hh`, `cxx`, `cu`, `ino` |
| CSharp | `cs` |
| Css | `css`, `scss` |
| Dart | `dart` |
| Elixir | `ex`, `exs` |
| Go | `go` |
| Haskell | `hs` |
| Hcl | `hcl`, `nomad`, `tf`, `tfvars`, `workflow` |
| Html | `html`, `htm`, `xhtml` |
| Java | `java` |
| JavaScript | `cjs`, `js`, `mjs`, `jsx` |
| Json | `json` |
| Kotlin | `kt`, `ktm`, `kts` |
| Lua | `lua` |
| Markdown | `markdown`, `md` |
| Nix | `nix` |
| Php | `php` |
| Python | `py`, `py3`, `pyi`, `bzl`, `bazel` |
| Ruby | `rb`, `rbw`, `gemspec` |
| Rust | `rs` |
| Scala | `scala`, `sc`, `sbt` |
| Solidity | `sol` |
| Swift | `swift` |
| Tsx | `tsx` |
| TypeScript | `ts`, `cts`, `mts` |
| Yaml | `yaml`, `yml` |
| Zig | `zig` |

The pattern matches two calls in `CartTotal.tsx`. The first covers only
line 2, which is unchanged. The second covers lines 3 to 6, and of
those only line 4 was added. Line 7 was added, but no match covers it.
`.graphql` has no ast-grep language, so `quote.graphql` is skipped:

``````example eligibility
requires: ast-grep
=== apps/web/src/checkout/.lore/totals.lore
<scope>
files: ["**/*.{tsx,graphql}"]
</scope>

<rule id="totals-from-quote" category="functional_correctness">
<check lang="ast-grep">
$LIST.reduce($$$)
</check>
Cart totals come from the quote, never from summing line items.
</rule>
=== apps/web/src/checkout/CartTotal.tsx
export function CartTotal({ items, fees }) {
  const feeTotal = fees.reduce((sum, fee) => sum + fee, 0)
  const total = items.reduce(
    (sum, item) => sum + item.price,
    0,
  )
  return <span>{total + feeTotal}</span>
}
=== diff
M apps/web/src/checkout/CartTotal.tsx
+4     (sum, item) => sum + item.price,
+7   return <span>{total + feeTotal}</span>
M apps/web/src/checkout/quote.graphql
+2   total: Money!
=== expect
{
  "eligible": ["totals-from-quote"],
  "hits": [
    { "rule": "totals-from-quote", "file": "apps/web/src/checkout/CartTotal.tsx", "line": 4, "text": "    (sum, item) => sum + item.price," }
  ],
  "excluded": [],
  "warnings": [
    { "name": "ast-grep-no-language", "file": "apps/web/src/checkout/quote.graphql", "entry": "totals-from-quote", "line": 1 }
  ]
}
``````

## Eligibility

A tool finds the entries that apply to a change by computing their
eligibility from the collected files (see
[Collecting files](#collecting-files)) and the change. An entry is
**eligible** when all of these hold:

1. it is in the document model: its file is collected, and neither the
   file nor the entry has an error (see [Error reach](#error-reach));
2. it is not disabled (see [Attributes](#attributes));
3. it has at least one counted file (see [Conditions](#conditions)):
   a changed file in its scope that no `disable` list switches it off
   for (see [Disable](#disable));
4. its `<when>`, if it has one, holds.

Every changed file has one or two **paths**:

- An added or a modified file has one path: its path.
- A deleted file has one path: its old path. It has no added lines.
- A renamed file has two paths: its old path and its new path. It is in
  a scope when either path is, and `changed` and `unchanged` see both.
  Its added lines are lines of its new version, and a hit names it by
  its new path (see [Running checks](#running-checks)), whichever path
  made it a counted file.

A Lore file or a `.loreconfig` in the change is a changed file like any
other, and counts for every entry whose scope holds it. The entries
themselves are read from the files as the change leaves them, so an
entry the change adds can be eligible for that same change, unless the
tool was given a rules revision (see
[Collecting files](#collecting-files)).

An entry with no `<scope>` and no `<when>`, in a file with no
`<scope>`, has the whole of its base as its scope. Unless it is
disabled or switched off, it is eligible for every change to a file
under its base, and an entry in a Lore folder at the repository root is
eligible for every change.

An **eligibility result** holds four lists:

- `eligible`: the id of every eligible entry, rules and contexts alike.
- `hits`: the hits of the checks of every eligible rule (see
  [Running checks](#running-checks)).
- `excluded`: every error in the document model, each naming the file,
  entry or `.loreconfig` it excludes (see [Error reach](#error-reach)).
- `warnings`: every warning in the document model (`missing-category`,
  `empty-scope` and `unknown-disabled-id`), whether or not its entry is
  eligible; `missing-src-target` for every context in the document
  model whose target is missing, eligible or not (see
  [Context](#context)); and `unsupported-check-language` and
  `ast-grep-no-language`, for eligible rules only (see
  [Running checks](#running-checks)).

The rule at the repository root has no scope and no condition, so it is
eligible for this change. The rule under `apps/api/` is eligible because
the changed file is under its base. The one under the checkout folder
is not:

``````example eligibility
=== .lore/shop.lore
<rule id="changelog-updated" category="documentation">
A change that alters what users see adds a line to the changelog.
</rule>
=== apps/web/src/checkout/.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== apps/api/.lore/api.lore
<rule id="api-errors-typed" category="functional_correctness">
Every error the API returns carries a typed error code.
</rule>
=== diff
M apps/api/src/orders.ts
+18   throw new HttpError(500)
=== expect
{ "eligible": ["api-errors-typed", "changelog-updated"], "hits": [], "excluded": [], "warnings": [] }
``````

A deleted file counts by its old path, and a renamed file by both of its
paths. `OldPrice.tsx` was deleted under `legacy/`. `Price.tsx` moved
from the checkout folder to the pricing folder, so it is in the scope of
the rules of both. Its added line counts for both conditions, though
the checkout rule counts the file by its old path only. Each rule's hit
names the new path:

``````example eligibility
=== apps/web/src/checkout/.lore/checkout.lore
<rule id="checkout-currency-from-settings" category="functional_correctness">
<when>
addedContains: ["'USD'"]
</when>
Checkout display text never hard-codes a currency code.
</rule>
=== apps/web/src/pricing/.lore/pricing.lore
<rule id="pricing-currency-from-settings" category="functional_correctness">
<when>
addedContains: ["'USD'"]
</when>
Pricing code never hard-codes a currency code.
</rule>
=== apps/web/src/legacy/.lore/legacy.lore
<rule id="legacy-removals-logged" category="documentation">
Removing a legacy page adds a line to the migration log.
</rule>
=== diff
D apps/web/src/legacy/OldPrice.tsx
R apps/web/src/checkout/Price.tsx -> apps/web/src/pricing/Price.tsx
+3   const label = 'USD'
=== expect
{
  "eligible": ["checkout-currency-from-settings", "legacy-removals-logged", "pricing-currency-from-settings"],
  "hits": [
    { "rule": "checkout-currency-from-settings", "file": "apps/web/src/pricing/Price.tsx", "line": 3, "text": "  const label = 'USD'" },
    { "rule": "pricing-currency-from-settings", "file": "apps/web/src/pricing/Price.tsx", "line": 3, "text": "  const label = 'USD'" }
  ],
  "excluded": [],
  "warnings": []
}
``````

A hit in a renamed file names its new path, even for a rule that counts
the file by its old path:

``````example eligibility
requires: regex
=== apps/web/src/checkout/.lore/checkout.lore
<rule id="checkout-currency-from-settings" category="functional_correctness">
<check>
'USD'
</check>
Checkout display text never hard-codes a currency code.
</rule>
=== diff
R apps/web/src/checkout/Price.tsx -> apps/web/src/pricing/Price.tsx
+3   const label = 'USD'
=== expect
{
  "eligible": ["checkout-currency-from-settings"],
  "hits": [
    { "rule": "checkout-currency-from-settings", "file": "apps/web/src/pricing/Price.tsx", "line": 3, "text": "  const label = 'USD'" }
  ],
  "excluded": [],
  "warnings": []
}
``````

A change to a Lore file is a change to a file under its base. Here the
change adds `quote-expiry-shown` to the checkout's Lore file, so every
rule in that file is eligible, the new one included, and so is the rule
whose scope holds Lore files:

``````example eligibility
=== .lore/lore.lore
<rule id="lore-rules-owned" category="documentation">
<scope>
files: ["**/.lore/**/*.lore"]
</scope>
Every new rule records its owner in its `<meta>`.
</rule>
=== apps/web/src/checkout/.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<rule id="quote-expiry-shown" category="functional_correctness">
A checkout page that shows a quoted price also shows when the quote expires.
</rule>
=== diff
M apps/web/src/checkout/.lore/checkout.lore
+5 <rule id="quote-expiry-shown" category="functional_correctness">
+6 A checkout page that shows a quoted price also shows when the quote expires.
+7 </rule>
=== expect
{ "eligible": ["lore-rules-owned", "price-from-quote", "quote-expiry-shown"], "hits": [], "excluded": [], "warnings": [] }
``````

Given a rules revision, the same change is judged by the rules of that
revision, which do not yet hold `quote-expiry-shown`, so it is not eligible:

``````example eligibility
=== .lore/lore.lore
<rule id="lore-rules-owned" category="documentation">
<scope>
files: ["**/.lore/**/*.lore"]
</scope>
Every new rule records its owner in its `<meta>`.
</rule>
=== apps/web/src/checkout/.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<rule id="quote-expiry-shown" category="functional_correctness">
A checkout page that shows a quoted price also shows when the quote expires.
</rule>
=== rules:.lore/lore.lore
<rule id="lore-rules-owned" category="documentation">
<scope>
files: ["**/.lore/**/*.lore"]
</scope>
Every new rule records its owner in its `<meta>`.
</rule>
=== rules:apps/web/src/checkout/.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== diff
M apps/web/src/checkout/.lore/checkout.lore
+5 <rule id="quote-expiry-shown" category="functional_correctness">
+6 A checkout page that shows a quoted price also shows when the quote expires.
+7 </rule>
=== expect
{ "eligible": ["lore-rules-owned", "price-from-quote"], "hits": [], "excluded": [], "warnings": [] }
``````

## Error reach

An error reaches as far as it must and no further, and is never silent.

- A **file-level error** excludes its Lore file. None of the file's
  entries is in the document model, and none counts towards
  [Ids](#attributes).
- An **entry-level error** excludes only its entry. The other entries in
  the file are read as usual.
- An error in a `.loreconfig` excludes that `.loreconfig`, and
  `repo-inside-repo` and `nested-repo` also exclude everything at or
  below it (see [.loreconfig](#loreconfig) and
  [External folders](#external-folders)).
- A warning excludes nothing.

Wherever a tool reports eligibility, it MUST also report every error in
the document model, by name, so that no excluded file, entry or
`.loreconfig` goes unmentioned: for example, "38 rules applied, 2
skipped: unknown-category".

These errors are always file-level:

- `unreadable-structure`, `top-level-text`, `unknown-element`,
  `duplicate-file-block` and `file-block-after-entry`, which concern
  the file's structure (see [Parsing](#parsing));
- `invalid-defaults` (see [Defaults](#defaults)).

These are always entry-level:

- `missing-id`, `invalid-id`, `disabled-has-value` and
  `src-escapes-root`, on an entry's opening tag (see
  [Attributes](#attributes) and [Context](#context));
- `duplicate-attribute`, on an entry's opening tag or a child's (a
  file block takes no attributes, so its first one is
  `unknown-attribute`);
- `unknown-child`, `duplicate-child`, `invalid-meta`, `invalid-when`,
  `empty-when`, `unknown-condition`, `regex-not-one-line` and
  `regex-outside-dialect`, in an entry's children;
- `duplicate-id`, across files.

These are file-level in a file block (`<defaults>` or the file's
`<scope>`), and entry-level in an entry or one of its children:
`invalid-attribute-value`, `unknown-attribute`,
`inconsistent-indentation`, `invalid-yaml`, `duplicate-key`,
`yaml-feature-not-allowed`, `invalid-scope`, `empty-files`,
`leading-slash`, `invalid-glob` and `glob-escapes-base`. Likewise,
`unknown-category` is file-level in `<defaults>` and entry-level on a
rule's `category` attribute.

`invalid-loreconfig`, `repo-inside-repo` and `nested-repo` are errors
in a `.loreconfig`.

The middle rule's condition has an unknown key. Only that rule is
excluded, and the rules around it are eligible:

``````example eligibility
=== apps/web/src/checkout/.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<rule id="currency-from-settings" category="functional_correctness">
<when>
addedContain: ["'USD'"]
</when>
Display text never hard-codes a currency code.
</rule>

<rule id="quote-expiry-shown" category="functional_correctness">
A checkout page that shows a quoted price also shows when the quote expires.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
+12   const label = 'USD'
=== expect
{
  "eligible": ["price-from-quote", "quote-expiry-shown"],
  "hits": [],
  "excluded": [
    { "name": "unknown-condition", "file": "apps/web/src/checkout/.lore/checkout.lore", "entry": "currency-from-settings", "line": 6 }
  ],
  "warnings": []
}
``````

The file scope of `display.lore` has an unclosed brace, so no entry in
that file is eligible, and the second one's missing category is not
reported either. The rule in the other file is eligible:

``````example eligibility
=== apps/web/src/checkout/.lore/display.lore
<scope>
files: ["**/*.{ts,tsx"]
</scope>

<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code.
</rule>

<rule id="dates-from-locale">
Displayed dates are formatted with the shop's locale.
</rule>
=== apps/web/src/checkout/.lore/pricing.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
+12   const label = 'USD'
=== expect
{
  "eligible": ["price-from-quote"],
  "hits": [],
  "excluded": [
    { "name": "invalid-glob", "file": "apps/web/src/checkout/.lore/display.lore", "entry": null, "line": 1 }
  ],
  "warnings": []
}
``````

## .loreconfig

A **`.loreconfig`** file holds settings for the directory it is in and
every directory below it, except those below a Lore root that cuts off
the lookup (see [Lore root](#lore-root)). It MAY sit in any directory
of the governed repo or of a given folder's repository, except inside a
Lore folder: a file
there is not a Lore file, and a tool ignores it (see
[Files and folders](#files-and-folders)).

A `.loreconfig` is UTF-8 text, read as a Lore file is (see
[Files and folders](#files-and-folders)). Its whole content is one
structured block (see [Structured blocks](#structured-blocks)). It is
not an element, so no indentation is removed from it. Its value MUST be
a mapping whose keys are all optional:

| Key | Value | Meaning |
|---|---|---|
| `lore` | `1` | The version of this specification that the files follow. Without it, the version is 1. |
| `root` | `true` or `false` | `true` makes this directory a Lore root (see [Lore root](#lore-root)). Without it, `false`. |
| `repo` | `<host>/<path>` | Marks this directory as standing for the root of the repository it names (see [External folders](#external-folders)). |
| `loose` | `true` or `false` | `true` in the `.loreconfig` at the root of a loose folder says the folder is meant to be loose (see [External folders](#external-folders)). Without it, `false`. |
| `categories` | A list of categories | Categories declared for this directory and below (see [Categories](#categories)). |
| `disable` | A list of ids | Entries switched off for changed files in this directory and below (see [Disable](#disable)). |

An empty `.loreconfig`, or one that holds only comments, is an empty
mapping and sets nothing. The shape is also given as
[`loreconfig.schema.json`](schemas/loreconfig.schema.json).

Every problem with the content of a `.loreconfig` is
`invalid-loreconfig`: each problem that
[Structured blocks](#structured-blocks) names, a byte that is not
valid UTF-8, and any value the table does not allow, such as a key it
does not name, `lore: 2`, or `root: yes` (which the core schema reads
as a string). A tool ignores a `.loreconfig` with a problem as a whole,
as if it did not exist, and reports the error once, with a null
`entry`. Entries that relied on it then fail on their own: an entry
whose category it declared is `unknown-category`.

A tool checks a `.loreconfig` in this order, and reports the first
problem it finds, at this line:

1. a byte that is not valid UTF-8: that byte's line;
2. the problems of [Structured blocks](#structured-blocks), in the order
   that section gives: the line it gives, counted in the file. A
   document that ends before it is complete is reported at the file's
   last line, the line that holds the file's last character (for a file
   that ends with a line feed, the line that the line feed ends);
3. a value that is not a mapping: line 1;
4. each key, in the order of the file: the line of the first key that
   the table does not name, or whose value it does not allow.

The first `.loreconfig` has a `disable` that is not a list, the second
repeats a key, and the third has a `root` that is not a boolean. All
three are ignored: the categories they declare are unknown, and
`currency-from-settings` is not switched off:

``````example eligibility
=== .loreconfig
categories: [data_provenance]
disable: currency-from-settings
=== apps/api/.loreconfig
lore: 1
categories: [api_contracts]
categories: [api_latency]
=== apps/web/.loreconfig
root: yes
categories: [web_vitals]
=== apps/api/.lore/api.lore
<rule id="order-schema-versioned" category="api_contracts">
Every change to the order schema bumps its version.
</rule>
=== .lore/provenance.lore
<rule id="price-source-recorded" category="data_provenance">
Every stored price records the quote it came from.
</rule>

<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code.
</rule>
=== apps/web/.lore/web.lore
<rule id="checkout-render-budget" category="web_vitals">
The checkout page shows its first price within the page's time budget.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
+12   const label = 'USD'
=== expect
{
  "eligible": ["currency-from-settings"],
  "hits": [],
  "excluded": [
    { "name": "unknown-category", "file": ".lore/provenance.lore", "entry": "price-source-recorded", "line": 1 },
    { "name": "invalid-loreconfig", "file": ".loreconfig", "entry": null, "line": 2 },
    { "name": "unknown-category", "file": "apps/api/.lore/api.lore", "entry": "order-schema-versioned", "line": 1 },
    { "name": "invalid-loreconfig", "file": "apps/api/.loreconfig", "entry": null, "line": 3 },
    { "name": "unknown-category", "file": "apps/web/.lore/web.lore", "entry": "checkout-render-budget", "line": 1 },
    { "name": "invalid-loreconfig", "file": "apps/web/.loreconfig", "entry": null, "line": 1 }
  ],
  "warnings": []
}
``````

### Lore root

`.loreconfig` files cascade: the settings that hold for a directory come
from the `.loreconfig` in it and those above it. The **Lore root** of a
directory is where that lookup stops, so that the result never depends
on where a tool was pointed. A `.loreconfig` **applies** to a directory
when it is in that directory or in one above it, up to and including the
directory's Lore root, and is not ignored.

- In the governed repo, the Lore root of a directory is the nearest
  directory, at or above it, whose `.loreconfig` has `root: true`. When
  there is none, it is the repository's root. Lookup never goes above
  the repository's root.
- In an external folder, the Lore root is defined in
  [External folders](#external-folders).
- A Lore file's Lore root is the Lore root of the directory that holds
  it. A file-relative `src` MUST NOT leave it (see [Context](#context)).

`apps/web/.loreconfig` has `root: true`, so lookup from `apps/web/`
stops there: `data_provenance`, declared at the repository root, is not
known in `apps/web/.lore/`, and `./../../README.md` leaves the Lore root.
At the repository root, with no `root: true` anywhere above, the Lore
root is the repository's root, and `./../../handbook/review.md` leaves
it:

``````example eligibility
=== .loreconfig
categories: [data_provenance]
=== apps/web/.loreconfig
root: true
categories: [web_vitals]
=== .lore/shop.lore
<rule id="price-source-recorded" category="data_provenance">
Every stored price records the quote it came from.
</rule>

<context id="org-handbook" src="./../../handbook/review.md">
Read for the organization's review conventions.
</context>
=== apps/web/.lore/web.lore
<rule id="checkout-render-budget" category="web_vitals">
The checkout page shows its first price within the page's time budget.
</rule>

<rule id="web-prices-recorded" category="data_provenance">
Every price the web app stores records the quote it came from.
</rule>

<context id="web-readme" src="./../README.md">
Read for how the web app is built.
</context>

<context id="shop-readme" src="./../../README.md">
Read for how the shop is built and deployed.
</context>
=== apps/web/README.md
# Web app
=== diff
M apps/web/src/checkout/Price.tsx
=== expect
{
  "eligible": ["checkout-render-budget", "price-source-recorded", "web-readme"],
  "hits": [],
  "excluded": [
    { "name": "src-escapes-root", "file": ".lore/shop.lore", "entry": "org-handbook", "line": 5 },
    { "name": "unknown-category", "file": "apps/web/.lore/web.lore", "entry": "web-prices-recorded", "line": 5 },
    { "name": "src-escapes-root", "file": "apps/web/.lore/web.lore", "entry": "shop-readme", "line": 13 }
  ],
  "warnings": []
}
``````

### Categories

The categories known for a Lore file are the fixed ones and those that
the `categories` lists of the `.loreconfig` files that apply to its
directory declare (see [Categories and severity](#categories-and-severity)).

- Lists add down the tree. A `.loreconfig` cannot take away a category
  that one above it declares, and an empty list declares nothing.
- A category declared in a directory below a Lore file's directory, or
  beside it, is not known for that file.
- Declaring a fixed category, or one already declared above, changes
  nothing.

`apps/web/` adds `web_vitals` to `data_provenance` from the root, and
`apps/api/`'s empty list takes nothing away. At the root, `web_vitals`
is unknown:

``````example eligibility
=== .loreconfig
categories: [data_provenance]
=== apps/web/.loreconfig
categories: [web_vitals]
=== apps/api/.loreconfig
categories: []
=== .lore/shop.lore
<rule id="price-source-recorded" category="data_provenance">
Every stored price records the quote it came from.
</rule>

<rule id="render-budgets-kept" category="web_vitals">
Every page shows its first content within its time budget.
</rule>
=== apps/web/.lore/web.lore
<rule id="checkout-render-budget" category="web_vitals">
The checkout page shows its first price within the page's time budget.
</rule>

<rule id="web-prices-recorded" category="data_provenance">
Every price the web app stores records the quote it came from.
</rule>
=== apps/api/.lore/api.lore
<rule id="api-prices-recorded" category="data_provenance">
Every price the API stores records the quote it came from.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
M apps/api/src/orders.ts
=== expect
{
  "eligible": ["api-prices-recorded", "checkout-render-budget", "price-source-recorded", "web-prices-recorded"],
  "hits": [],
  "excluded": [
    { "name": "unknown-category", "file": ".lore/shop.lore", "entry": "render-budgets-kept", "line": 5 }
  ],
  "warnings": []
}
``````

### Disable

`disable` lists the ids of entries that a `.loreconfig` switches off for
changed files in its directory and below. It is the consumer's switch,
where `disabled` is the author's (see [Attributes](#attributes)): a team
switches an entry off for part of a repository without editing the file
that holds it.

- An entry is **switched off** for a path when its id is in the
  `disable` list of a `.loreconfig` that applies to the directory that
  holds the path. Lists add down the tree, as `categories` lists do, so
  a `.loreconfig` below cannot switch the entry back on. An id MAY name
  a context as well as a rule.
- An entry is switched off for a changed file when it is switched off
  for each of the file's paths that is in its scope. Such a file is not
  one of the entry's counted files: it does not make the entry eligible,
  its added lines do not count for `addedContains` and `addedMatches`,
  and checks do not search it. `changed` and `unchanged` still see it
  (see [Conditions](#conditions)).
- An entry switched off for every changed file in its scope is not
  eligible. A counted file elsewhere keeps it eligible.
- A `disable` list in the governed repo also switches off entries from
  external folders. [External folders](#external-folders) says which
  lists apply to those entries.

An id in a `disable` list that names no entry the list can switch off
is the warning `unknown-disabled-id`, once for each such item, with a
null `entry`. Its line is the line where the item starts: in a block
sequence, the line of the item's `-`; in a flow sequence, the line of
the item's first character. The entries a list can
switch off are those whose ids count in [Ids](#attributes): for a list
in the governed repo, every such entry collected from anywhere; for a
list in a given folder's repository, see
[External folders](#external-folders).
The warning is part of the document model.

`legacy/` switches off three rules. `currency-from-settings` stays
eligible through `Total.tsx`. `currency-codes-from-settings` counts only
`Total.tsx`, where no `'USD'` was added. `legacy-prices-from-quote` has
no counted file:

``````example eligibility
=== apps/web/src/legacy/.loreconfig
disable: [currency-from-settings, currency-codes-from-settings, legacy-prices-from-quote]
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code; it uses the shop's
`currency` setting.
</rule>

<rule id="currency-codes-from-settings" category="functional_correctness">
<when>
addedContains: ["'USD'"]
</when>
Display text never spells out a currency code.
</rule>
=== apps/web/src/legacy/.lore/legacy.lore
<rule id="legacy-prices-from-quote" category="functional_correctness">
Legacy pages take their prices from the quote too.
</rule>
=== diff
M apps/web/src/legacy/Price.tsx
+4   const label = 'USD'
M apps/web/src/checkout/Total.tsx
+9   return <span>{total}</span>
=== expect
{ "eligible": ["currency-from-settings"], "hits": [], "excluded": [], "warnings": [] }
``````

A `disable` list may switch off a context. `curency-from-settings` names
no entry, while `dates-from-locale` names an entry that is excluded by
an error and still counts:

``````example eligibility
=== .loreconfig
disable:
  - checkout-architecture
  - curency-from-settings
  - dates-from-locale
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code.
</rule>

<rule id="dates-from-locale" category="functional_correctness" severity="high">
Displayed dates are formatted with the shop's locale.
</rule>

<context id="checkout-architecture" src="ARCHITECTURE.md">
Read before judging any change to how a price is computed.
</context>
=== ARCHITECTURE.md
# Checkout architecture
=== diff
M apps/web/src/checkout/Price.tsx
=== expect
{
  "eligible": ["currency-from-settings"],
  "hits": [],
  "excluded": [
    { "name": "invalid-attribute-value", "file": ".lore/checkout.lore", "entry": "dates-from-locale", "line": 5 }
  ],
  "warnings": [
    { "name": "unknown-disabled-id", "file": ".loreconfig", "entry": null, "line": 3 }
  ]
}
``````

## External folders

A team MAY keep Lore outside the repository it governs, for example in
its own repository, so that one set of rules serves several
repositories:

```
team-repo/lore/
  .loreconfig          root: true
                       categories: [data_provenance]
  shop/
    .loreconfig        repo: github.com/acme/shop
    .lore/
      checkout.lore    base: the shop repo's root
    apps/web/.lore/
      web.lore         base: apps/web/ in the shop repo
```

- A **given folder** is a directory in a working copy of another
  repository that the tool's user hands to the tool, for example with a
  command-line option or a setting. A loose folder, below, is the one
  kind of given folder that is in no working copy. A tool MAY be given
  any number of folders, and treats each one the same way. In a
  conformance example, the tool is given one folder: the root of the
  repository that holds the `external:` input files.
- A `.loreconfig` with a `repo` key **marks** its directory: the
  directory stands for the root of the repository that `repo` names. A
  tool looks for marked directories in each given folder and below it.
- A marked directory whose `repo` names the governed repo (see
  [Matching the governed repo](#matching-the-governed-repo)), with
  everything below it, is an **external folder**. The tool collects the
  Lore files at or below it (see [Collecting files](#collecting-files)).
  No other Lore file of a given folder's repository is collected,
  including one below a directory marked for another repository.
- A `.loreconfig` with a `repo` key that is above a given folder, and
  in no given folder, still marks its directory for `nested-repo` (see
  [Where repo may appear](#where-repo-may-appear)). That directory is
  never an external folder, even when its `repo` names the governed
  repo. To use the Lore below a marked directory, give a folder that
  holds the marked directory, not one inside it.
- A file that more than one given folder reaches, such as when one given
  folder holds another, is collected and read once.
- A tool MAY collect a given folder that is in no working copy (a
  **loose folder**), such as a downloaded copy of a team repository,
  counting every file under it except those inside a directory whose
  name starts with `.` other than `.lore`. A loose folder is a
  repository of its own whose root is the folder, so a Lore root found
  in it is at or below the folder, and a file-relative `src` that would
  climb above that Lore root is `src-escapes-root`. Its files carry
  `loose:` and their path from the folder. When a tool collects a loose
  folder, it MUST report `untracked-given-folder` once for that folder,
  with `file` `loose:.`, `entry` `null` and `line` 1, unless the
  `.loreconfig` at the top of the folder (`loose:.loreconfig`) sets
  `loose: true`. The `loose` key has no effect in any other
  `.loreconfig`, and a `.loreconfig` with a problem is ignored as a
  whole, so the tool then reports the folder. A tool MAY instead refuse
  such a folder and collect nothing from it. The team, not version
  control, decides what is in such a folder, so a
  stray copy of a Lore folder in it can add rules.
- Below a marked directory, directories mirror the governed repo: the
  directory `<marked>/<path>` stands for `<path>` in the governed repo.
  The base of a Lore file below a marked directory is found as
  [Files and folders](#files-and-folders) says, counting from the marked
  directory instead of the repository root, and is the directory it
  stands for. Its globs, its plain `src` paths and its `changed` and
  `unchanged` globs resolve from there, as in the governed repo, and a
  leading `/` means the governed repo's root.
- A file-relative `src` (one that starts with `./` or `../`) resolves
  in the external folder's own repository, as [Context](#context)
  describes.

**The Lore root** of a directory at or below a marked directory is the
nearest directory, at or above it, whose `.loreconfig` has `root:
true`, looking as far up as the root of the marked directory's
repository. When there is none, it is the marked directory. So a
`.loreconfig` above the marked directory applies only when a
`root: true` at or above it makes the Lore root higher than the marked
directory. An organization that wants shared categories puts them, with
`root: true`, in a `.loreconfig` above all its marked directories.

The shop's Lore is kept in a team repository. `checkout.lore` has the
shop repo's root as its base, and `web.lore` has `apps/web/`. The
organization's `.loreconfig` makes `data_provenance` known in both, and
its directory is the Lore root, so the context can point at the
organization's handbook beside it:

``````example eligibility
=== external:lore/.loreconfig
root: true
categories: [data_provenance]
=== external:lore/handbook.md
# Review handbook
=== external:lore/shop/.loreconfig
repo: github.com/acme/shop
=== external:lore/shop/.lore/checkout.lore
<scope>
files: ["apps/web/src/checkout/**"]
</scope>

<rule id="price-source-recorded" category="data_provenance">
Every price the checkout stores records the quote it came from.
</rule>

<context id="review-handbook" src="./../../handbook.md">
Read for the organization's review conventions.
</context>
=== external:lore/shop/apps/web/.lore/web.lore
<rule id="web-prices-from-quote" category="functional_correctness">
<scope>
files: ["src/**/*.tsx"]
</scope>
A price the web app displays comes from the quote that produced it.
</rule>
=== external:lore/shop/apps/api/.lore/api.lore
<rule id="api-prices-recorded" category="data_provenance">
Every price the API stores records the quote it came from.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
+12   const total = quote.total
=== expect
{
  "eligible": ["price-source-recorded", "review-handbook", "web-prices-from-quote"],
  "hits": [],
  "excluded": [],
  "warnings": []
}
``````

A given folder in no working copy, such as a plain download, is
collected whole. The stray copy under `.cache/` is not read, and the
tool reports the folder:

``````example eligibility
requires: loose-given-folder
=== loose:.loreconfig
repo: github.com/acme/shop
=== loose:.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== loose:.cache/.lore/stale.lore
<rule id="stale-copy" category="documentation">
A copy a tool left behind.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
+12 const total = quote.total
=== expect
{
  "eligible": ["price-from-quote"],
  "hits": [],
  "excluded": [],
  "warnings": [{ "name": "untracked-given-folder", "file": "loose:.", "entry": null, "line": 1 }]
}
``````

A folder that is meant to be loose, such as rules installed with a
tool, says so in its root `.loreconfig`, and the tool does not report
it:

``````example eligibility
requires: loose-given-folder
=== loose:.loreconfig
repo: github.com/acme/shop
loose: true
=== loose:.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
+12 const total = quote.total
=== expect
{
  "eligible": ["price-from-quote"],
  "hits": [],
  "excluded": [],
  "warnings": []
}
``````

Here `loose: true` is in the marked directory's `.loreconfig`, which is
not at the folder's root, so it has no effect and the tool reports the
folder:

``````example eligibility
requires: loose-given-folder
=== loose:sub/.loreconfig
repo: github.com/acme/shop
loose: true
=== loose:sub/.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
+12 const total = quote.total
=== expect
{
  "eligible": ["price-from-quote"],
  "hits": [],
  "excluded": [],
  "warnings": [{ "name": "untracked-given-folder", "file": "loose:.", "entry": null, "line": 1 }]
}
``````

The root `.loreconfig` has a `loose` that is not a boolean, so it is
ignored, and the tool reports the folder:

``````example eligibility
requires: loose-given-folder
=== loose:.loreconfig
loose: yes
=== loose:sub/.loreconfig
repo: github.com/acme/shop
=== loose:sub/.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
+12 const total = quote.total
=== expect
{
  "eligible": ["price-from-quote"],
  "hits": [],
  "excluded": [
    { "name": "invalid-loreconfig", "file": "loose:.loreconfig", "entry": null, "line": 1 }
  ],
  "warnings": [{ "name": "untracked-given-folder", "file": "loose:.", "entry": null, "line": 1 }]
}
``````

In the document model, an external file's `file` keeps its `external:`
path. Its globs and its plain `src` resolve to paths in the governed
repo, from `apps/web/`. The file-relative `src` stays in the team
repository: its four `..` segments lead from `lore/shop/apps/web/.lore/`
up to the Lore root, `lore/`:

``````example parse
=== external:lore/.loreconfig
root: true
=== external:lore/shop/.loreconfig
repo: github.com/acme/shop
=== external:lore/shop/apps/web/.lore/web.lore
<scope>
files: ["src/**/*.tsx"]
</scope>

<rule id="checkout-prices-from-quote" category="functional_correctness">
<scope>
files: ["src/checkout/**"]
</scope>
A price the checkout displays comes from the quote that produced it.
</rule>

<context id="web-architecture" src="docs/architecture.md">
</context>

<context id="review-handbook" src="../../../../handbook.md">
</context>
=== expect
{
  "entries": [
    {
      "kind": "rule", "id": "checkout-prices-from-quote", "file": "external:lore/shop/apps/web/.lore/web.lore",
      "category": "functional_correctness", "severity": "advisory", "disabled": false,
      "scopes": [{ "files": ["apps/web/src/**/*.tsx"], "ignores": [] }, { "files": ["apps/web/src/checkout/**"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "A price the checkout displays comes from the quote that produced it.",
      "prose": "A price the checkout displays comes from the quote that produced it.",
      "src": null
    },
    {
      "kind": "context", "id": "web-architecture", "file": "external:lore/shop/apps/web/.lore/web.lore",
      "category": null, "severity": null, "disabled": false,
      "scopes": [{ "files": ["apps/web/src/**/*.tsx"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "",
      "prose": "",
      "src": "apps/web/docs/architecture.md"
    },
    {
      "kind": "context", "id": "review-handbook", "file": "external:lore/shop/apps/web/.lore/web.lore",
      "category": null, "severity": null, "disabled": false,
      "scopes": [{ "files": ["apps/web/src/**/*.tsx"], "ignores": [] }],
      "when": null, "checks": [], "meta": null,
      "summary": "",
      "prose": "",
      "src": "external:lore/handbook.md"
    }
  ],
  "errors": [],
  "warnings": []
}
``````

### Matching the governed repo

A `repo` value names a repository as `<host>/<path>`: a host of
lowercase ASCII letters, digits, `.` and `-`, optionally followed by
`:` and a port, then `/` and a path with no whitespace,
ending in neither `/` nor `.git`. Any other value is
`invalid-loreconfig`.

The governed repo is named by its **remotes**: the URLs of the
repositories it is fetched from or pushed to. In a conformance example,
it has one, the `=== remote` line. A tool **normalizes** a remote in
these steps:

1. If it holds `://`, remove everything up to and including the first
   `://`, then any user information: everything up to and including the
   last `@` before the next `/`.
2. Otherwise, if it holds a `:` before any `/`, it has the form
   `[user@]host:path`: remove everything up to and including the last
   `@` before that `:`, and replace that `:` with `/`.
3. Remove every `/` at the end, then a `.git` at the end, if there is
   one.

A marked directory's `repo` **names** the governed repo when it equals
any of the governed repo's normalized remotes, with ASCII letters
compared regardless of case.
So `https://github.com/acme/shop.git`, `git@github.com:Acme/shop.git`
and `ssh://git@github.com/acme/shop` all match `github.com/acme/shop`,
while `ssh://git@github.com:22/acme/shop` keeps its port and does not.
A governed repo without a remote matches no `repo`. A tool MAY also let
its user map a `repo` value to the governed repo explicitly.

The remote is written in the scp-like form, with a different case and
`.git` at the end, and still names `github.com/acme/shop`. The
directory marked for another repository is not collected:

``````example eligibility
=== remote
git@github.com:Acme/shop.git
=== external:shop/.loreconfig
repo: github.com/acme/shop
=== external:shop/.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== external:payments/.loreconfig
repo: github.com/acme/payments
=== external:payments/.lore/payments.lore
<rule id="refunds-logged" category="observability">
Every refund is logged with the order it refunds.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
=== expect
{ "eligible": ["price-from-quote"], "hits": [], "excluded": [], "warnings": [] }
``````

With a remote for another repository, the folder marked for
`github.com/acme/shop` is not collected, and only the governed repo's
own Lore applies:

``````example eligibility
=== remote
https://github.com/acme/other
=== .lore/orders.lore
<rule id="orders-logged" category="observability">
Every order is logged with its quote.
</rule>
=== external:shop/.loreconfig
repo: github.com/acme/shop
=== external:shop/.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
=== expect
{ "eligible": ["orders-logged"], "hits": [], "excluded": [], "warnings": [] }
``````

### Trees

The governed repo's files form one **tree**. Each marked directory that
names the governed repo forms another: the files at or below it, and
the `.loreconfig` files above it that apply to it. Trees resolve their
`.loreconfig` files separately:

- **Categories.** A Lore file knows the categories of its own tree only.
  Categories declared in the governed repo are unknown in an external
  folder's files, and the other way round.
- **Disable.** An entry of an external folder is switched off for a path
  when a `.loreconfig` of the governed repo switches it off, as
  [Disable](#disable) says, or when a `.loreconfig` of its own tree
  applies to the directory that stands for the path's directory and
  lists its id. A `disable` list in a given folder's repository, whether
  inside an external folder or in a `.loreconfig` above one, never
  switches off the governed repo's entries, nor those of a tree it does
  not belong to. For `unknown-disabled-id`, the entries it can switch
  off are those of the trees it belongs to. A list in a given folder's
  repository that belongs to no tree switches nothing off and is not
  checked for `unknown-disabled-id`.
- **Ids.** Ids MUST be unique across every tree, as [Ids](#attributes)
  says. An id used in two trees is `duplicate-id` in both: neither entry
  overrides the other.

Each tree knows only its own category, so one rule in each is
excluded:

``````example eligibility
=== .loreconfig
categories: [web_vitals]
=== .lore/web.lore
<rule id="checkout-render-budget" category="web_vitals">
The checkout page shows its first price within the page's time budget.
</rule>

<rule id="web-prices-recorded" category="data_provenance">
Every price the web app stores records the quote it came from.
</rule>
=== external:lore/.loreconfig
root: true
categories: [data_provenance]
=== external:lore/shop/.loreconfig
repo: github.com/acme/shop
=== external:lore/shop/.lore/shop.lore
<rule id="price-source-recorded" category="data_provenance">
Every stored price records the quote it came from.
</rule>

<rule id="render-budgets-kept" category="web_vitals">
Every page shows its first content within its time budget.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
=== expect
{
  "eligible": ["checkout-render-budget", "price-source-recorded"],
  "hits": [],
  "excluded": [
    { "name": "unknown-category", "file": ".lore/web.lore", "entry": "web-prices-recorded", "line": 5 },
    { "name": "unknown-category", "file": "external:lore/shop/.lore/shop.lore", "entry": "render-budgets-kept", "line": 5 }
  ],
  "warnings": []
}
``````

The shop switches off a shared rule for `apps/web/` without editing the
team's file. The team's own `disable` list cannot switch off the shop's
rule, so the id it names is unknown to it:

``````example eligibility
=== apps/web/.loreconfig
disable: [shared-currency-from-settings]
=== .lore/checkout.lore
<rule id="currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code.
</rule>
=== external:shop/.loreconfig
repo: github.com/acme/shop
disable: [currency-from-settings]
=== external:shop/.lore/shared.lore
<rule id="shared-currency-from-settings" category="functional_correctness">
Display text never hard-codes a currency code; it uses the shop's
`currency` setting.
</rule>

<rule id="shared-dates-from-locale" category="functional_correctness">
Displayed dates are formatted with the shop's locale.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
=== expect
{
  "eligible": ["currency-from-settings", "shared-dates-from-locale"],
  "hits": [],
  "excluded": [],
  "warnings": [
    { "name": "unknown-disabled-id", "file": "external:shop/.loreconfig", "entry": null, "line": 2 }
  ]
}
``````

The same id in the governed repo and in an external folder is an error
in both files, not an override:

``````example eligibility
=== .lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness" severity="blocking">
The checkout page shows the price from the quote, never a recomputed one.
</rule>
=== external:shop/.loreconfig
repo: github.com/acme/shop
=== external:shop/.lore/shared.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>

<rule id="dates-from-locale" category="functional_correctness">
Displayed dates are formatted with the shop's locale.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
=== expect
{
  "eligible": ["dates-from-locale"],
  "hits": [],
  "excluded": [
    { "name": "duplicate-id", "file": ".lore/checkout.lore", "entry": "price-from-quote", "line": 1 },
    { "name": "duplicate-id", "file": "external:shop/.lore/shared.lore", "entry": "price-from-quote", "line": 1 }
  ],
  "warnings": []
}
``````

### Where repo may appear

- A `.loreconfig` in the governed repo MUST NOT have a `repo` key. One
  that does is `repo-inside-repo`: Lore in the governed repo already
  governs it.
- A marked directory MUST NOT be below another marked directory of the
  same repository, whichever repositories they name. The lower one is
  `nested-repo`.

A tool checks for these errors only in a `.loreconfig` that has no
other problem; an `invalid-loreconfig` marks nothing. The offending
`.loreconfig` is read, and either error is reported at the line of its
`repo` key, with a null `entry`. The error excludes that `.loreconfig`
and every Lore file and `.loreconfig` in its directory or below it:
none of those below is collected or read, and nothing in them is
reported. An excluded `.loreconfig` is as if it did not exist, so its
`root: true`, if it has one, does not cut off any lookup. A tool reads
`.loreconfig` files from the top of the tree down, so when such errors
nest, only the highest is reported.

`apps/web/.loreconfig` has a `repo` key, so nothing under `apps/web/` is
read: not `web.lore`, and not the broken `.loreconfig` below it. In the
team repository, `apps/web/` is marked below the shop's marked
directory, so its rules are excluded too:

``````example eligibility
=== apps/web/.loreconfig
repo: github.com/acme/shop
categories: [web_vitals]
=== apps/web/.lore/web.lore
<rule id="checkout-render-budget" category="web_vitals">
The checkout page shows its first price within the page's time budget.
</rule>
=== apps/web/src/checkout/.loreconfig
categories: [checkout_flow
=== .lore/shop.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== external:lore/shop/.loreconfig
repo: github.com/acme/shop
=== external:lore/shop/.lore/shared.lore
<rule id="dates-from-locale" category="functional_correctness">
Displayed dates are formatted with the shop's locale.
</rule>
=== external:lore/shop/apps/web/.loreconfig
lore: 1
repo: github.com/acme/web
=== external:lore/shop/apps/web/.lore/web.lore
<rule id="web-dates-from-locale" category="functional_correctness">
Dates the web app displays are formatted with the shop's locale.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
=== expect
{
  "eligible": ["dates-from-locale", "price-from-quote"],
  "hits": [],
  "excluded": [
    { "name": "repo-inside-repo", "file": "apps/web/.loreconfig", "entry": null, "line": 1 },
    { "name": "nested-repo", "file": "external:lore/shop/apps/web/.loreconfig", "entry": null, "line": 2 }
  ],
  "warnings": []
}
``````

## Collecting files

A tool collects the files it reads from the governed repo and from the
folders it was given. It MUST collect only files tracked by
version control, and MUST NOT find them by walking a file system (except
in a given folder that is in no working copy, see
[External folders](#external-folders)), so a
Lore folder in an installed dependency, a build output or an ignored
scratch folder cannot add rules to a review.

- **The governed repo.** A tool reads the governed repo as the change
  leaves it: the files tracked in the change's new version. It collects
  every Lore file (see [Files and folders](#files-and-folders)) and
  reads every `.loreconfig`. A Lore file the change deletes is not
  collected, and one it adds is. (So a change can delete a rule, or
  switch it off with `disable`, for its own review: the rule's absence
  is part of the change a reviewer sees.)

  **Rules revision.** A tool MAY let its caller name a revision of the
  governed repo to read Lore files, `.loreconfig` files and `src` targets
  from, instead of the revision the change leaves. The change itself, its
  files and added lines, is unaffected. Without one, a tool reads as
  above. This exists because a change judged by its own rules can
  delete or loosen the rule in its way.
- **A given folder.** A tool reads the files tracked in the working
  copy that holds it, or, for a loose folder, the files under it that
  [External folders](#external-folders) counts. It reads every
  `.loreconfig` of that repository in the given folder, below it or
  above it, and collects the Lore files of each external folder found
  in it: those at or below each marked directory that names the governed
  repo (see [External folders](#external-folders)).
- A `.loreconfig` is a file named exactly `.loreconfig`, outside any
  Lore folder. A file of that name inside a Lore folder is ignored.
- Files that `repo-inside-repo` or `nested-repo` excludes are neither
  collected nor read (see [Where repo may appear](#where-repo-may-appear)).
- Every `.loreconfig` that is read is checked, and its errors are
  reported, whether or not it applies to a collected Lore file. A
  `.loreconfig` with a problem marks no directory, so a tool cannot
  tell which repository it was meant for.

The `.loreconfig` inside the root Lore folder is ignored, so
`data_provenance` is unknown. In the team repository, `team.lore` is
under no marked directory, and the broken `.loreconfig` of `payments/`
is reported although it marks nothing, which leaves `payments.lore`
uncollected:

``````example eligibility
=== .lore/.loreconfig
categories: [data_provenance]
=== .lore/provenance.lore
<rule id="price-source-recorded" category="data_provenance">
Every stored price records the quote it came from.
</rule>
=== external:.lore/team.lore
<rule id="team-rules-reviewed" category="documentation">
Every change to the team's rules is reviewed by two people.
</rule>
=== external:shop/.loreconfig
repo: github.com/acme/shop
=== external:shop/.lore/checkout.lore
<rule id="price-from-quote" category="functional_correctness">
A displayed price must come from the quote that produced it.
</rule>
=== external:payments/.loreconfig
repo: github.com/acme/payments
categories: [Payments]
=== external:payments/.lore/payments.lore
<rule id="refunds-logged" category="observability">
Every refund is logged with the order it refunds.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
=== expect
{
  "eligible": ["price-from-quote"],
  "hits": [],
  "excluded": [
    { "name": "unknown-category", "file": ".lore/provenance.lore", "entry": "price-source-recorded", "line": 1 },
    { "name": "invalid-loreconfig", "file": "external:payments/.loreconfig", "entry": null, "line": 2 }
  ],
  "warnings": []
}
``````

## Document model

A tool that parses Lore files builds a **document model**: the entries it
read from every collected Lore file, and the errors and warnings it found
in them and in every `.loreconfig` it read. A tool that computes
eligibility builds an **eligibility result**. Both are JSON values, and
the conformance examples compare against them (see
[Conformance examples](#conformance-examples)). A tool MAY emit either one
in this form. Their shapes are also given as
[`document-model.schema.json`](schemas/document-model.schema.json) and
[`eligibility.schema.json`](schemas/eligibility.schema.json).

A document model is an object with three members:

| Member | Value |
|---|---|
| `entries` | Every entry that no error excludes, rules and contexts alike, disabled entries included (see [Error reach](#error-reach)). |
| `errors` | A diagnostic for each error that [Parsing](#parsing) and [Error reach](#error-reach) say the model lists, in a Lore file or in a `.loreconfig`. |
| `warnings` | A diagnostic for each `missing-category`, `empty-scope` and `unknown-disabled-id` found outside an excluded file, entry or `.loreconfig`. The other warnings are found when computing eligibility, and only an eligibility result carries them. |

Each array is in the order that [Conformance examples](#conformance-examples)
gives under Order, and every `file` field follows Paths there.

**Paths.** A `file` is a path from the root of the repository that holds
the file. A file of the governed repo has its plain path, except that a
file read from a rules revision has `rules:` before it. A file of a
given folder's repository has `external:` before its path, so that it is
never mistaken for a file of the governed repo, and a file of a loose
folder has `loose:` before its path from that folder (see
[External folders](#external-folders)). The prefix does not say which
repository the file is in, so a tool given folders of two repositories
can list two different files with the same `file`. This version of the
format does not tell them apart. Every other path in either output
(globs in `scopes`, plain `src` values and hits) names a path in the
governed repo, apart from a file-relative `src` in an external folder
(see [Context](#context)).

### Entry fields

| Field | Value |
|---|---|
| `kind` | `"rule"` or `"context"`. |
| `id` | The entry's id (see [Attributes](#attributes)). |
| `file` | The path of the Lore file that holds the entry. |
| `category` | A rule's category, found as [Categories and severity](#categories-and-severity) says, or null when it has none. Always null for a context. |
| `severity` | A rule's severity, `"blocking"` or `"advisory"`, never null. Always null for a context. |
| `disabled` | `true` when the entry has the `disabled` attribute, otherwise `false`. A `disable` list does not change it. |
| `scopes` | The file's scope, then the entry's own `<scope>` when it has one, each as an object with `files` and `ignores`, defaults filled in and globs resolved (see [Scope and globs](#scope-and-globs)). A path is in the entry's scope when it is in every item. |
| `when` | The `<when>` mapping as parsed, with its globs as written, or null when the entry has none (see [Conditions](#conditions)). |
| `checks` | Each `<check>` as an object with `lang` and `body`, in the order they appear (see [Checks](#checks)). Always `[]` for a context. |
| `meta` | The `<meta>` mapping as parsed, or null when the entry has none (see [Children](#children)). |
| `summary` | The first paragraph of the prose (see [Entries](#entries)). |
| `prose` | The entry's prose, which for a context is its body (see [Entries](#entries)). |
| `src` | A context's resolved `src`, or null when it has none (see [Context](#context)). Always null for a rule. |

### Diagnostics

Every error and warning is reported as a **diagnostic**:

| Field | Value |
|---|---|
| `name` | The problem's name (see [Errors and warnings](#errors-and-warnings)). |
| `file` | The path of the Lore file or `.loreconfig` the problem is in. For `ast-grep-no-language`, the changed file the check skipped. |
| `entry` | The id of the entry the problem is in, or null, as Diagnostic entry in [Conformance examples](#conformance-examples) says. For `ast-grep-no-language`, the rule's id. |
| `line` | The line, counted from 1, as Diagnostic lines in [Conformance examples](#conformance-examples) says. |

### Eligibility result

An eligibility result is an object with four members (see
[Eligibility](#eligibility)):

| Member | Value |
|---|---|
| `eligible` | The id of every eligible entry, in ascending order. |
| `hits` | Each hit as an object with `rule`, `file`, `line` and `text`: the rule's id, the changed file's new path, the added line's number counted from 1, and that line's text (see [Running checks](#running-checks)). |
| `excluded` | The document model's `errors`. |
| `warnings` | The document model's `warnings`, with `missing-src-target`, `unsupported-check-language` and `ast-grep-no-language` added as [Eligibility](#eligibility) says. |

## Errors and warnings

Every problem a tool reports has one of these names. An error excludes
what it is found in, and a warning excludes nothing. The list is also
given as [`errors.json`](errors.json).

| Name | Kind | Description |
|---|---|---|
| `unreadable-structure` | error | The file structure cannot be read as Lore elements. |
| `top-level-text` | error | Text appears at the top level outside any element. |
| `unknown-element` | error | An element name is not part of the format. |
| `duplicate-file-block` | error | A file contains a second `<defaults>` or a second `<scope>`. |
| `file-block-after-entry` | error | A file block appears after the first entry. |
| `invalid-yaml` | error | A block body is not valid YAML. |
| `duplicate-key` | error | A mapping repeats the same key. |
| `yaml-feature-not-allowed` | error | A block uses a YAML feature outside the allowed subset. |
| `invalid-defaults` | error | A defaults block fails its schema. |
| `invalid-scope` | error | A scope block fails its schema. |
| `invalid-when` | error | A when block fails its schema. |
| `invalid-meta` | error | A meta block is not a mapping. |
| `missing-id` | error | An entry has no id attribute. |
| `invalid-id` | error | An id does not match the id pattern. |
| `unknown-attribute` | error | An element carries an attribute it does not define. |
| `duplicate-attribute` | error | An attribute appears more than once on one element. |
| `invalid-attribute-value` | error | An attribute value is not allowed for that attribute. |
| `disabled-has-value` | error | The disabled attribute is given a value. |
| `unknown-child` | error | An element contains a child it does not allow. |
| `duplicate-child` | error | An element contains a child that may appear only once. |
| `unknown-condition` | error | A condition names a key that is not defined. |
| `empty-when` | error | A when block has no conditions. |
| `invalid-glob` | error | A glob string is malformed. |
| `glob-escapes-base` | error | A glob contains a .. segment that escapes its base directory. |
| `leading-slash` | error | A scope glob starts with a slash. |
| `empty-files` | error | A scope files list is empty. |
| `regex-outside-dialect` | error | A regular expression uses syntax outside the allowed dialect. |
| `regex-not-one-line` | error | A regular expression spans more than one line. |
| `inconsistent-indentation` | error | An element's indented lines share no common indentation. |
| `unknown-category` | error | A category is not built in or declared in config. |
| `duplicate-id` | error | Two entries resolve to the same id. |
| `src-escapes-root` | error | A src path resolves outside the Lore root. |
| `invalid-loreconfig` | error | A .loreconfig file is not valid UTF-8 or allowed YAML, or fails its schema. |
| `repo-inside-repo` | error | A .loreconfig in the governed repo has a repo key. |
| `nested-repo` | error | A directory marked with repo is below another marked directory. |
| `missing-category` | warning | A rule has no category and no default supplies one. |
| `empty-scope` | warning | Each of an entry's files globs is disjoint from each of its file scope's files globs. |
| `missing-src-target` | warning | A src attribute points at a file that does not exist. |
| `unsupported-check-language` | warning | A check uses a language the tool does not support. |
| `ast-grep-no-language` | warning | An ast-grep check skips a changed file whose extension maps to no ast-grep language. |
| `unknown-disabled-id` | warning | A disable list names an id of no entry it can switch off. |
| `untracked-given-folder` | warning | A given folder in no working copy, not marked loose, was collected whole. |

Whether an error excludes a file, an entry or a `.loreconfig`, and for
some errors where it is found, is listed in [Error reach](#error-reach).

## For agents (non-normative)

An agent with no Lore tooling can still apply Lore, since Lore files are
plain text written to be read.
[`AGENT.md`](AGENT.md) holds short instructions that a team pastes into
the instructions its agents already read (see
[Adopting Lore](#adopting-lore-non-normative)). Its heading names the
version of this specification it follows. It reads, in full:

```markdown
# Lore v1 agent instructions

1. Find the tracked `.lore/` folders whose base (the folder holding `.lore/`)
   contains a changed file. Read their `.lore` files, and each `.loreconfig`
   from a changed file's folder up to the nearest `root: true` or the repo root.
2. Select each entry not `disabled` whose scope (file and entry `<scope>`, each
   defaulting to the whole base; globs relative to the base) holds a changed file
   that no `disable` list switches it off for, and whose `<when>` holds.
3. Read each selected `<context>` and the file its `src` names: a plain `src`
   from the base, one starting `./` or `../` from the folder of its `.lore` file.
4. Report each selected `<rule>` by id as pass, fail or not applicable, with
   evidence such as a file and line. Treat a `<check>` as a hint, not a verdict.
5. Never invent rules from prose outside `.lore` files.
```

An agent that follows these steps selects rules by reading them, so it
can select a different set than a conforming tool would: it can misread
a glob, or miss that a category is not declared. When a tool has computed
the eligibility result for the change, an agent does better to take the
eligible entries and hits from it, and still report on every eligible
rule by id.

## Adopting Lore (non-normative)

**First rules.** Add a Lore folder with a first `.lore` file, at the
repository root for rules that apply everywhere, or beside the code a set
of rules governs (see [Files and folders](#files-and-folders)). A rule
with no category is still eligible, with a warning, so existing rules can
be wrapped and scoped first and classified later.

**Highlighting.** Until editors support Lore, this line in
`.gitattributes` makes code hosts that read these attributes highlight
`.lore` files as Markdown:

```
*.lore linguist-language=Markdown gitlab-language=markdown
```

**Agents.** Paste [`AGENT.md`](AGENT.md), heading included, into the
instruction file your agents read: `AGENTS.md` at the repository root, or
the file a particular agent reads instead.
