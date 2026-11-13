# Listing in-scope rules that were not selected: design

Date: 2026-11-10. Status: for approval. Tracker: LORE-8.

## Intent

A rule that `lore select` does not select is invisible to the reviewer.
When the rule's author did not predict how a violation would be written,
the rule never arrives and nothing says so. A field replay on one pack of
about 200 rules measured this: on planted violations that sat inside a
rule's scope, the trigger failed to fire for about a quarter of them, and
more often when the violation was spelled in an unusual way. On a typical
change with rules in scope, selection handed over 11 rules where the
scopes alone covered 50. The narrowing is the point of triggers; the
silence about the other 39 is the cost.

This change lets a reviewer see what else governs the changed files, as
one line per rule, without paying for the full text.

## Goals

- An option on `lore select` and `lore check` that lists every rule
  whose scope covers a changed file but whose `<when>` did not hold: id,
  severity, category and a one-line summary.
- A way to read one of those rules in full by id, in the same output
  form as a selected rule.
- Verdicts may be given for listed rules and are never required.
- The listing stays short in the text output: capped and sorted.
- The cost in output size is measured on a large rule set and written
  into the docs, with guidance on when to turn the option on.

## Non-goals

- On by default. The option is opt-in in this release; the default is
  decided later from measurements.
- Any change to eligibility. Which rules are selected, and which need a
  verdict, is unchanged.
- Paths mode and its `conditional` key.
- Listing contexts. Only rules are listed.

## Anti-goals

- A listing so long that reviewers skip it.
- Output that changes for anyone who does not pass the new options.
- A listed rule quietly becoming a required verdict.

## Approaches considered

1. **A command option computed in the selection step (chosen).** The
   selection loop already finds, for each rule, the changed files its
   scope covers before it tests `<when>`. Rules that pass the first step
   and fail the second are exactly the listing. It is a command feature,
   like `conditional`: the eligibility result of the spec is unchanged.
2. **Fill the reserved `conditional` key.** It is promised to paths mode
   with a narrower meaning (rules held back only by added-line
   conditions) and it carries ids only. Changing its type or meaning
   would break the one consumer contract that exists.
3. **Do it outside Lore**, by running selection twice, once on a copy of
   the rules with every `<when>` removed. This is how the replay measured
   the gap. It needs no release, but every consumer would rebuild it and
   the rule copy drifts from what the parser accepts.

## Design

### The set

A rule is listed when all of these hold:

- it is a rule, not a context;
- it is not disabled, its scope is not empty, and it is not disabled for
  the path by a config (the same tests selection applies);
- its scope covers at least one changed path, counted exactly as
  selection counts it (both paths of a rename, the old path of a
  deletion);
- it has a `<when>` and that `<when>` did not hold.

A rule with no `<when>` is never listed: when its scope covers a changed
file it is selected. A rule excluded by an error is never listed; it is
already in `excluded`.

### Options

- `--also-in-scope` on `select` and `check`. Without it, output is byte
  for byte what it is today.
- `--expand <id>`, repeatable, on `select` and `check`. Each named rule
  that is in the listing set is moved into `rules` and printed in full,
  with no flagged lines and with `"expanded": true` in JSON. An expanded
  rule is a selected rule from then on: it needs a verdict. `--expand`
  implies `--also-in-scope`. An id that is not in the listing set (not
  in scope, already selected, unknown, disabled) is a usage error, exit
  2, naming the id.

### JSON

With `--also-in-scope` (or `--expand`) the selection gains one key.
Without those options the key is absent and the JSON is byte for byte
what it is today:

```json
"alsoInScope": [
  { "id": "...", "file": "...", "category": "...", "severity": "advisory",
    "summary": "...", "paths": ["src/a.ts"] }
]
```

It is not capped. `lore verdicts` reads a selection without the key (any
saved 0.4.0 selection) as having an empty listing. `paths`
holds the changed paths the rule's scope covers, sorted. Entries are
sorted as in the text output.

### Text

A section after the contexts and before the warnings:

```
## Also in scope, not triggered

These rules cover files in this change, but nothing in the change
triggered them. No verdict is needed for them. If one looks relevant to
what the change does, run the command again with `--expand <id>` to read
it, or give it a verdict directly.

- `money-as-integers` (blocking, money): Amounts are integer cents, never floats.
- ...
- and 12 more; `--format json` lists them all
```

- One line per rule: id, severity, category, summary. The summary is the
  entry's existing summary (its first paragraph, joined), cut to 160
  code points.
- Order: blocking before advisory, then rules covering more changed
  paths first (a rename with both paths in scope counts twice), then id.
- At most 40 lines; the rest are counted in a final line.
- 2026-11-13: the cut is 600 code points and the cap never drops a blocking rule; see `2026-11-13-listing-summary-design.md`.
- For the author audience (`check`) the paragraph reads: "These rules
  cover files you changed, but nothing in your change triggered them.
  Read any that look relevant with `--expand <id>`."
- When no rule and no context is selected and the listing is not empty,
  the output opens with "No Lore rules were selected for this change."
  (with the existing sentence about excluded entries appended exactly as
  it is appended today), then the section. For the reviewer audience the
  section is followed by the verdict format block from the preamble (the
  fenced `lore-verdicts` example and the three verdict meanings), so a
  verdict for a listed rule can be written; the author audience gets no
  such block.
- When contexts are selected but no rules, the normal preamble and the
  contexts print as today, then the section.
- When the listing is empty the output is what it is today, option or
  not.

### Verdicts

`lore verdicts` accepts a verdict whose rule is in `alsoInScope`: no
`unselected-verdict` problem. Such a verdict is checked like any other
(evidence inside the change, a note where one is needed, no duplicates).
A missing verdict for a listed rule is never a problem. An expanded rule
sits in `rules` and is required as any selected rule is.

### Cost, and when to turn it on

- A test builds a 200-rule fixture where one change puts every rule in
  scope and triggers ten. It pins two sizes: the text section (lines and
  bytes; bounded by the cap) and the `alsoInScope` JSON (bytes; not
  capped, so this is where a large set costs).
- The docs give both measured sizes for that fixture, name the test that
  produces them, and say: turn the option on where a missed rule costs more than a few
  dozen extra lines of reading, and for rule sets whose triggers are
  literal strings; leave it off for small sets with no triggers, where
  it prints nothing.

### Version and docs

CLI 0.5.0. The applying-rules design gains a short section pointing
here, and the README's command reference gains the two options. The
spec's eligibility rules and its eligibility schema are untouched.
Turning the option on in any team's review skill is a separate change
outside this repository.

## Testing

- Parser: the set, including a rename, a deletion, a disabled rule, a
  rule disabled for a path by config, an empty scope, a rule with no
  `<when>`, and a rule whose `<when>` holds.
- CLI: JSON and text with and without the option (without it, existing
  fixtures must not change); order and cap; the nothing-selected case;
  both audiences; `--expand` for a listed rule, for two rules, and each
  usage error.
- Verdicts: a verdict for a listed rule passes; a `fail` for one without
  evidence is still a problem; no verdict for one is not a problem; an
  expanded rule without a verdict is a problem.

## After it ships

The private replay harness reruns its planted violations with the option
on and reports two numbers: how many more violations have their rule
either selected or listed, and how many lines the listing adds per
change. Those decide whether the option becomes the default.

## Left to the builder

Where the listing is computed (the selection loop or a helper beside
it), internal names, the fixture's shape, and the exact wording of usage
errors.
