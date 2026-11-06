# Dropped-line conditions: design

A design for a condition on removed lines whose construct the change did
not add back.

## Intent

`removedContains` and `removedMatches` hold for any removed line that
matches. A diff shows an edited line as a removed line plus an added one,
so a rule about a deleted fallback or a deleted branch is selected every
time someone renames a variable on a line that has a fallback, and every
time a formatter rewraps one. The rule's author means something narrower:
the construct was deleted, not edited.

The evidence is a measurement on one governed repository, 70 recent
commits in each of two trees, of a rule whose trigger is a removed `??`,
a removed branch opener or a removed default argument:

| | Tree 1 | Tree 2 |
|---|---|---|
| Commits selecting the rule today | 54% | 23% |
| Sampled flagged lines that were the slip | 42% | 24% |
| Commits selecting it under this design | 46% | 16% |
| Sampled flagged lines that were the slip, or plausibly it | 91% | 100% |
| True slips still flagged | 11 of 16 | 6 of 7 |

Narrowing the patterns by line shape did not help: an edited line and a
deleted one look the same on the removed side, so shape narrowing lost
true hits as fast as false ones. What separates them is on the added
side, which no removed-line pattern can see.

The change adds `droppedContains` and `droppedMatches`: a removed line
counts only when no added line of the same edit matches the same item.

## Goals

- A rule can be selected by a construct the change deleted, and not by an
  edit that keeps the construct.
- The lines such a condition finds are old-side hits, exactly as the
  removed pair's are.
- The result depends only on the change as the specification defines it,
  so every conforming tool selects the same rules for the same change.
- Conformance examples pin the behavior, including the cases where it
  differs from the removed pair.
- The reference CLI, the schema, the language server's completions and
  docs, and the writing-lore skill all know the new keys.

## Non-goals

- Changing `removedContains` or `removedMatches`. A rule about a replaced
  line needs a removed line and an added one that both match, and keeps
  working as written.
- A mirror on the added side (an added line whose construct the edit did
  not already have). The term this design defines makes it possible
  later; no rule needs it yet. *(My call, shown to Matt.)*
- Hunks. The change model gains nothing.
- Pairing lines by similarity. A threshold cannot be specified or tested
  the way the rest of the specification is.
- Detecting moved code. A block deleted in one place and added in another
  is dropped at the old place; the rule's prose tells the reviewer what to
  check.
- Checks over removed lines, a specification version bump, or a change to
  the eligibility result's shape.
- Converting any rule to the new keys. That happens where the rules live,
  after the CLI release that carries this change.

## Anti-goals

- A result that depends on how a tool printed the diff. Two tools given
  the same added and removed lines must agree, whatever context width or
  hunk boundaries either one saw.
- A rule that means less than its author wrote. A tool on the older
  reading of the specification reports `unknown-condition` for the new
  keys and excludes the entry, which the specification already requires.
- A hit the reviewer cannot find. A dropped line's hit is an ordinary
  old-side hit: the file's old path, the old-side line number and the
  removed text.
- A second way to say "removed". The new pair is defined in terms of the
  removed pair plus one clause, and shares its validation, error names
  and hit shape.

## Constraints

- The names are `droppedContains` and `droppedMatches`, a list of strings
  and a list of patterns in the specification's regex dialect, with the
  removed pair's validation and error names. *(Names are my call, shown
  to Matt.)*
- Everything is computed from the change model as it is: per changed
  file, added lines with new-side numbers and removed lines with old-side
  numbers.
- The repo is public. Examples use the specification's own `acme/shop`
  repository and name no real project.

## Approaches

### What "added back" means

**A. In the same edit (chosen).** The added line sits next to the removed
one with no unchanged line between them. It follows from the line numbers
the change model already has, it is what a reader sees as "this line was
replaced", and it gives the specification one reusable term. Measured:
46% and 16% of commits selected, 11 of 16 and 6 of 7 true slips kept.

**B. In the same hunk.** Slightly quieter (40% and 11%; 10 of 16 and 5 of
7 kept), but a hunk is a product of the diff's context width, so the same
change could select different rules in two tools. Hunks would also have
to be added to the change model and to the conformance diff format.
Rejected.

**C. In the same file.** Simplest to state (29% and 9%), but a common
construct is added somewhere in most changed files, so it kept 7 of 16
and 0 of 7 true slips. Rejected.

Matt chose A, on the grounds that a condition must depend only on the
change, and that "same edit" is what the author of such a rule means.

### How an author writes it

**A. A new pair of keys (chosen).** `droppedContains` and
`droppedMatches`, each a list, beside the four line conditions. It keeps
the rule that every key is one condition and every value a list, and an
older tool excludes the entry instead of misreading it. Cost: eight keys
where there were six.

**B. An option on the removed pair** (`removedMatches: {patterns: [...],
unlessAddedBack: true}`). No new names, but the value stops being a list,
which the schema, the language server and the skill all teach, and the
removed-lines design already rejected an option form for that reason.
Rejected.

**C. A general second key** naming what the edit must not add, which may
differ from what was removed. More expressive, but two keys that only
make sense read together, and nothing measured needs the extra power.
Rejected.

Changing the meaning of the removed pair itself was dropped before these
three: it breaks every rule that needs a removed line and an added line
to match the same thing.

Matt chose A.

## The specification

### Edits

A new term, defined where the Conditions section defines an added line's
and a removed line's text.

Within one changed file, the unchanged lines of the old version and of
the new version are the same lines in the same order. A removed line
lies after some number of them in the old version, and an added line
after some number of them in the new version. An **edit** is the set of
that file's removed and added lines that lie after the same number of
unchanged lines. In other words, two changed lines are in the same edit
when no unchanged line lies between them.

That number follows from the line numbers alone: for a removed line at
old-side line `r` it is `r - 1` minus the count of the file's removed
lines numbered below `r`; for an added line at new-side line `a` it is
`a - 1` minus the count of the file's added lines numbered below `a`.

- A renamed file is one file: its removed lines, named by the old path,
  and its added lines, named by the new path, form edits together.
- A deleted file has no added lines, so none of its edits has one. An
  added file has no removed lines.
- An edit never spans two files.

### Conditions

Two rows join the table, directly after the removed pair, so the check
order in the numbered list follows:

| Key | Value | Holds when |
|---|---|---|
| `droppedContains` | A list of strings. | A removed line of a counted file contains one of the strings, and no added line of the same edit contains that string. |
| `droppedMatches` | A list of patterns. | A removed line of a counted file matches one of the patterns, and no added line of the same edit matches that pattern. |

- The pairing is per item. A removed line that matches two items is
  found when either of them is absent from the edit's added lines: with
  the items `??` and `if (`, a removed `if (a ?? b) {` whose edit adds
  `if (a) {` is found, through `??`.
- Matching is the removed pair's: `droppedContains` compares as
  `removedContains` does and `droppedMatches` searches as
  `removedMatches` does, over the same line text.
- With an empty list neither condition holds, as with the removed pair.
  The sentence about empty lists now names seven conditions that never
  hold.
- `unknown-condition` now names eight keys. Validation of the two new
  keys is the removed pair's, item for item, with the same error names;
  they are checked in table order, after `removedMatches`.
- Each removed line a `droppedContains` or `droppedMatches` condition
  finds is a hit on the old side, named by the file's old path, exactly
  as a removed-pair hit is. A rule that uses both pairs still has at most
  one hit per side, file and line.
- The paragraph that says which lines each condition sees gains one
  sentence: the dropped-line conditions see removed lines, and added
  lines only to decide whether the same edit added the item back.

The eligibility result, its schema and the hit shape do not change.

### Examples

New eligibility examples in the Conditions section, with `acme/shop`
content, that together pin these cases. How many examples carry them is
left to the builder; each case must be visible in an `expect` block.

1. An edit that removes a line with the item and adds a line with the
   item: not found. In the same example, a rule with `removedContains`
   on the same item is eligible, which shows the difference between the
   pairs.
2. An edit that removes a line with the item and adds a line without it:
   found, one old-side hit.
3. A removed line and an added line that both hold the item, in the same
   file, with one unchanged line between them: two edits, so the removed
   line is found. This is the case a hunk-based reading would get wrong.
4. A deleted file: every removed line that matches is found.
5. Two items, one added back in the edit and one not: found (the per-item
   rule above).
6. A renamed file whose edit adds the item back under the new path: not
   found.
7. `droppedMatches` with a pattern, at least once.

`when.schema.json` gains the two keys with the removed pair's item rules.

## The reference CLI

- **Diff parsing** is unchanged. The unified-diff parser already numbers
  added and removed lines, and edits follow from those numbers. A diff
  whose only difference on a line is the missing final line break shows
  the line removed and added in one edit, so it is not found.
- **Parser.** The list of condition keys, their validation, the regexes
  compiled before selection, condition evaluation and hit construction
  gain the dropped pair. Edits are computed per changed file from the
  line numbers, once per selection.
- **Selection JSON and text output** are unchanged in shape. A dropped
  line is printed as any old-side hit is, `(removed)` included, and
  shares the flagged-line cap.
- **Language server.** The key list, hover docs and completions gain the
  two keys, worded parallel to the removed pair plus the added-back
  clause.
- **Package version.** `packages/cli/package.json` goes to 0.4.0, as the
  removed-lines branch went to 0.3.0: a new condition key is a minor
  change. *(My call, following the earlier branches.)*
- Editor grammars and the formatter plugin do not enumerate condition
  keys, so the expectation is no change there; the builder confirms.

## The writing-lore skill

Step 3 of the skill ("Decide when the rule is selected") gains guidance
on choosing between the pairs for a slip that shows only in removed
lines:

- the slip is a deleted construct, and an edit that keeps the construct
  is not the slip: `droppedContains` or `droppedMatches`;
- the slip is a replacement, where a removed line and an added line both
  matter: `removedContains` or `removedMatches`, with the added-side
  condition, as today;
- the item is a general call and the slip can be a swap of what follows
  it, such as a removed `isEnabled('` read whose edit reads a different
  flag: the removed pair, because the edit adds the item back and a
  dropped-line condition would not see it.

The test an author applies is one question: can an edited line that
still matches the item ever be the slip? If never, the dropped pair; if
it can, the removed pair.

The reference's condition table gains the two rows and the definition of
an edit, with a checked example. The common-mistakes table gains one row:
a removed-line trigger on a common construct that fires on every edited
line.

The edit goes through the skill-writing discipline the repo's skills
already use: the conversion scenario under `skills/writing-lore/tests/`
gains a deleted-construct slip in its source skill (a deleted fallback,
where an edited line that keeps the fallback is never the slip) and a
rubric line that requires the dropped pair for it. The baseline run shows
the current skill reach for the removed pair there, and the verify run
passes with the edited skill against the CLI built from this branch. That
makes the skill the last part built.

The scenario's existing removed-line slip, the removed `isEnabled('` read
in source item 6 with rubric item C4, stays a removed-pair case and C4
keeps requiring `removedContains`. It is the swap case above, so the two
traps together test that the skill teaches the difference. *(My call,
after the builder check asked which pair item 6 should take.)*

## Known limits

Stated in the specification's prose or the skill, so an author knows what
the keys cannot do:

- An edit that adds the same construct for an unrelated reason hides the
  removal. In the measurement this cost 5 of 16 true slips in one tree
  and 1 of 7 in the other.
- An edit that keeps the item but changes what it applies to (a call
  with a different argument) is not found. Such a rule keeps the removed
  pair.
- A moved block is found at its old place.
- Which lines are added, removed and unchanged is decided by the diff the
  tool was given, as it already is for every line condition. An edit
  inherits that and adds nothing to it.

## Rollout

1. One branch in this repo, in this order: specification text, schema
   and conformance examples (with the generated fixtures regenerated and
   committed, since new examples renumber the later ones); parser; CLI
   tests and text-output tests that show nothing changed in shape;
   language server; version bump; the skill last, with its scenario run
   against the built CLI. Tests first for each part, as the repo does.
2. Verification mirrors the CI workflow step for step, including fixture
   regeneration and the generated-files diff.
3. The release owner tags `cli-v0.4.0` on the merged main; the release
   workflow builds and publishes `lore.js`. A docs commit then points the
   download instructions at the new tag.
4. A pack that pins 0.3.0 re-pins and converts its rules; that work and
   its notes stay in the private archive.

## Left to the builder

- Internal names, where edits are computed and how they are cached.
- How many conformance examples carry the seven cases, and where the
  example-diff parser in the tests needs to know nothing new (it already
  reads `-` lines).
- Test file layout in the parser, CLI and language server.
- The exact sentences of the specification, the hover docs and the skill,
  within the meaning above.
- Whether any README or package document lists the condition keys and
  needs the two new ones.
