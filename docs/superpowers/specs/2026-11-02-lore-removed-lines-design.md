# Removed-line conditions: design

A design for the condition on removed lines that the specification
reserves for a later version.

## Intent

A rule's slip often shows only in code the change deleted: a fallback
dropped from a read, a flag check removed from a gate, an expectation
replaced to make a test pass, markup deleted without its snapshot. Lore
conditions see added lines only, so such a rule today either rides every
change in its scope, carries an added-line literal that stands in for the
real slip, or cannot be written. Converting one review skill produced ten
rules of that shape, which is the evidence this change rests on.

The change adds `removedContains` and `removedMatches`, defined like their
added twins, and makes the removed lines they find hits on the old side of
the change, so the reviewer is pointed at the deleted line itself.

## Goals

- A rule can be selected by text in the removed lines of a counted file.
- The removed lines a condition finds are hits that name the file's old
  path, the old-side line number and the removed text.
- Conformance examples can state removed lines, so the behavior is
  testable in the spec.
- The reference CLI, its text output, the schemas, the language server's
  completions and the writing-lore skill all know the new keys.

## Non-goals

- An "either side" form. Every key in a `<when>` must still hold. The
  ten rules fit this: two need both sides (a replaced expectation is a
  removed `expect(` plus an added one; deleted markup needs an unchanged
  snapshot), and the rest drop their stand-in added literals. *(Matt's
  decision.)*
- Checks over removed lines. `<check>` keeps searching added lines only.
- Conditions on unchanged lines, on context lines, or on moved code.
- A spec version bump. The spec is version 1, status draft, and the keys
  are additive.
- Converting the ten rules. That happens where they live, after the CLI
  release that carries this change.

## Anti-goals

- A hit the reviewer cannot find. An old-side hit carries a real old-side
  line number and the removed text, never a new-side number.
- A rule that means less than its author wrote. A tool on the older
  reading of the spec reports `unknown-condition` for the new keys and
  excludes the entry, which the spec already requires. A new key never
  silently narrows to "always holds".
- A second notion of the change. Removed lines come from the same diff
  the added lines come from, parsed by the same code.
- A bigger reviewer prompt by default. Old-side hits share the existing
  flagged-line cap with new-side hits.

## Constraints

- The condition names mirror the added pair exactly: `removedContains`
  takes a list of strings, `removedMatches` a list of patterns in the
  spec's regex dialect, with the same validation and error names.
- A removed line's text is the line as it was in the file's old version,
  decoded as an added line's text is.
- Old-side locations use the convention verdict evidence already uses: a
  `side` of `"new"` or `"old"`, `"new"` when absent, and the file's old
  path on the old side.
- The repo is public. Examples use the spec's own `acme/shop` repository
  and name no real project.

## Approaches

**A. Mirror the added pair (chosen).** Two new keys defined over removed
lines; the lines they find become old-side hits; the conformance diff
format gains removed lines; the change model and the selection carry
removed lines beside added ones. Trade-off: the hit shape gains an
optional field, so every reader of the JSON sees one new key.

**B. Eligibility only.** The same two keys, but removed lines only decide
whether a rule is selected and are never pointed out. Smaller, but the
reviewer is told a fallback was removed somewhere and has to find it in
the old version, which is the work these rules exist to do for them.
Rejected.

**C. One key with a side option** (`contains: {side: old, ...}`).
Rejected early: it breaks the naming the four existing keys teach.

Matt chose A because the old-side pointer is the whole value of the
change, and the hit shape has a precedent in verdict evidence.

## The specification

### The change

A change is a set of changed files and, for each one, its added lines and
its removed lines. An added file has no removed lines; a deleted file has
no added lines, and every line of its old version is a removed line. A
renamed file's removed lines are lines of its old version, named by its
old path.

### Conformance diff format

A new line form joins `+<n> <text>`:

- `-<n> <text>`: a removed line. Line `<n>` (counted from 1) of the old
  version of the file named by the nearest `M`, `D` or `R` line above it
  (for a rename, the old path) is `<text>`.

A `-` line after an `A` line is malformed, as a `+` line after a `D` line
already is. `+` and `-` lines under one file may be in any order. The
"what the governed repo contains" paragraph gains one sentence: a changed
file's old version has unknown content apart from its removed lines.

### Conditions

Two rows join the table, directly after the added pair, so the check
order in the numbered list follows:

| Key | Value | Holds when |
|---|---|---|
| `removedContains` | A list of strings. | A removed line of a counted file contains one of the strings. |
| `removedMatches` | A list of patterns. | A removed line of a counted file matches one of the patterns. |

The paragraph that says only added lines count is rewritten: added-line
conditions see added lines only, removed-line conditions see removed
lines only, and unchanged lines never count for either. The sentence
reserving a removed-line condition goes. `unknown-condition` now names
six keys. With an empty list, `removedContains` and `removedMatches`
never hold, as the added pair does not.

A removed line that a `removedContains` or `removedMatches` condition
finds is a hit on the old side, as an added line one of the added
conditions finds is a hit on the new side.

### Hits

A hit gains `side`: `"new"` for an added line, `"old"` for a removed one.
An old-side hit names the file by its old path, the line by its number in
the old version, and the text of the removed line. A rule has at most one
hit per side, file and line. Hits are ordered by `rule`, then `file`, then
`side` with `"new"` before `"old"`, then `line`.

In the eligibility result's JSON, `side` is present only when it is
`"old"`, the convention verdict evidence uses; every existing conformance
example therefore keeps its `expect` block. *(My call: consistency with
evidence over an always-present field. The schema allows the key with
either value.)*

### Examples

The Conditions section gains one eligibility example with a removed
fallback: a rule with `removedContains: ["??"]` over a `.tsx` scope, a
diff that removes a `?? ''` line and adds its replacement, an expect
block with one old-side hit. The Eligibility section's rename text gains
a clause for removed lines and the old path. The Running checks section's
definition of a hit is widened to both sides.

### Schemas

- `when.schema.json`: the two keys, with the added pair's item rules.
- `eligibility.schema.json`: `side` on a hit, `enum: ["new", "old"]`,
  not required.

## The reference CLI

- **Diff parsing.** The unified-diff parser already walks `-` lines to
  keep the hunk counts; it now numbers them from the hunk's old start and
  keeps them. The change model's `ChangedFile` gains `removed` beside
  `added`, with the same `{ line, text }` shape, and a deleted file
  carries its removed lines instead of nothing.
- **Selection.** The parser's condition evaluation and hit construction
  gain the removed pair, with the regexes compiled before selection as the
  added patterns are.
- **Selection JSON.** Each entry of `change` gains `removed`, the old-side
  line numbers, beside `added`. *(My call: the two arrays exist for the
  same readers, and a consumer that counts flagged lines needs both.)* A
  hit carries `side` when old, as the spec says.
- **Text output.** An old-side flagged line reads
  `- <old path>:<line> (removed) <text>`; new-side lines are unchanged.
  The reviewer and author preambles say that a flagged line may be one
  the change removed, named by the file's old path. The verdict preamble
  already explains `"side": "old"`.
- **Verdict checking** is unchanged. An old-side evidence line may point
  at an unchanged old line, so the checker still cannot reject one by
  line number.
- **Language server.** The condition docs and completions gain the two
  keys with wording parallel to the added pair.
- **Package version.** The CLI is released as `@mattstack/lore` 0.3.0: a
  new condition key is a minor change for files that use it and no change
  for files that do not. The release is Eloise's; this design and the
  merged spec are the hand-off.

## The writing-lore skill

Step 2 of the sort gains a branch between "yes, a literal in added lines"
and "no, nothing in the diff": the slip always leaves a literal in removed
lines, so the rule takes `removedContains` with the literal as it appeared
in the old code, and both conditions when the slip is a replacement. The
"no" branch narrows to a slip that is something missing or in another
file. The reference's condition table gains the two rows.

## Rollout

1. One branch in this repo: spec text, schemas, conformance examples,
   parser, CLI, text output, language server docs, skill. Tests first for
   each part, as the repo does.
2. Eloise releases 0.3.0 from the merged main.
3. The pack that pins 0.2.0 re-pins and converts its ten rules; that
   work and its notes stay in the private archive.

## Left to the builder

- Where the example-diff parser in the tests gains the `-` form, and how
  the example runner feeds removed lines to the parser.
- Internal names, test file layout, and how the hit set is deduplicated.
- The exact sentences of the preambles, within the meaning above.
- Whether the tree-sitter grammar or editor highlighting needs any change;
  on inspection they do not enumerate condition keys, so the expectation
  is none.
