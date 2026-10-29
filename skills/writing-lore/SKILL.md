---
name: writing-lore
description: Use when writing, converting or revising Lore rule files (.lore, .loreconfig), when turning a review skill, checklist, style guide or AGENTS.md section into Lore rules, or when deciding whether an instruction belongs in a Lore rule, a skill or a lint rule.
---

# Writing Lore

A Lore rule states what a finished change must satisfy, in prose, with just
enough structure for a tool to select it for the changes it bears on.
**Structure decides when a rule applies. Prose says what it requires.**
Every decision below serves one of the two.

Every feature, with a checked example and its pitfalls, is in
[reference.md](reference.md). Read a feature's section before you use it.

## 1. Sort each instruction

Ask of each instruction: could a reviewer who sees only the finished change
tell whether it was followed?

| The instruction is | It goes in |
|---|---|
| Checkable from the change, and a machine can decide it (formatting, a banned import a linter can express) | a lint rule, not Lore |
| Checkable from the change, and it needs judgment | a Lore `<rule>` |
| A step, an order of steps, something to run or open, a question for a person, or work handed to another skill or agent | the skill, unchanged |
| Background a reviewer needs to judge other rules | a Lore `<context>` |

A mixed instruction splits. "Delete the flag's reads, then its definition"
is an order of steps and stays in the skill; "a change that removes a
flag's last read also removes its definition" is an end state a reviewer
can check, so it can be a rule.

## 2. Place the file

- Rules live in `.lore/<topic>.lore` next to the code they govern. Globs
  resolve from the directory that holds the `.lore/` folder.
- A rule's `<scope>` only narrows its file's scope. A requirement that
  covers two trees (`apps/web` and `apps/api`) is two rules in two files,
  one in each tree.
- Rules kept outside the governed repo go in a folder that mirrors the
  repo's paths, with a `.loreconfig` holding `repo: <host>/<path>` at its
  root.
- Inside a git checkout, `lore select` reads only tracked files. A new
  `.lore` file you have not `git add`ed is skipped with no warning, so its
  rules never select. Track every rule file before you test it.

## 3. Decide when the rule is selected

Selection is what Lore is for: a reviewer reads only the rules that bear on
the change. Decide it for each rule, in this order:

1. **Scope.** Narrow `<scope>` to the files where the slip can happen.
   When converting, a rule's scope stays within what the source governs: a
   checkout skill's rules live under checkout, unless the source itself
   names another tree.
2. **Does the slip always leave a literal in the added lines** (a function
   name, an import path, a string)?
   - **Yes:** `<when>` with `addedContains: [...]`, the literals written
     exactly as they appear in code. The rule is selected only when one
     appears, and those lines are flagged for the reviewer.
   - **No** (the slip is something missing, lives in another file, or
     shows only in removed lines): no `<when>`. The rule is selected for
     every change in its scope. The prose says what the reviewer must open
     or compare. Such a rule rides along on every change in its scope, so
     its scope must be narrow: one with no `<when>` at a repo or app root is
     either scoped down or recorded as a gap in the conversion notes.
3. **A literal list cannot say it** (a word boundary, a value that varies):
   `addedMatches` with the smallest regex that works. Every condition in a
   `<when>` must hold, so `addedContains` and `addedMatches` are never
   alternatives to each other: when one alternative needs a pattern, put
   all of them in `addedMatches`, the literals escaped.
4. **A file changed without another** (a migration without the schema):
   `changed` and `unchanged`.
5. **`<check>`** only points at lines in a rule that step 2 left without a
   `<when>`. A check flags lines; it never decides whether the rule is
   selected. Its body is a regex (ast-grep checks are skipped by the
   reference CLI today).

When the source names "signals" (`computeTotal(`, `parseFloat(`), they are
the `addedContains` list. Writing them as a `<check>` makes the rule apply
to every change in scope and buries a plain list under escapes.

## 4. Write the rule

Fill every slot of this shape:

```html
<rule id="money-in-minor-units" category="functional_correctness" severity="blocking">
  <meta>
    source: checkout-review#2-money-is-integer-minor-units
  </meta>
  <when>
    addedContains: ["parseFloat(", "toFixed(", "Number("]
  </when>
  Amounts are integers in minor units (cents). Build them with
  `Money.fromCents` and display them with `formatMoney`.

  Floating point drifts by fractions of a cent, so totals stop matching
  what the payment provider charges.
</rule>
```

- **id:** kebab-case, names the requirement, never changes once used.
  Verdicts and reports refer to it.
- **category:** one of the fixed categories in reference.md. A custom one
  needs a `.loreconfig` entry; use it only when no fixed one fits.
- **severity:** `blocking` or `advisory`. `[BLOCKING]` maps to blocking,
  `[NON-BLOCKING]` to advisory. A conditional source ("usually blocking")
  gets one value, and the choice goes in the conversion notes.
- **meta `source`:** when converting, `<source document>#<heading slug>`,
  so every rule traces to the prose it came from. When writing a rule
  fresh, name the decision record or incident write-up that motivates it,
  if there is one a reader can open.
- **First paragraph:** the requirement, as what the change must do, in one
  or two sentences. Tools show it as the rule's summary.
- **The rest:** the stakes and the specifics a reviewer needs. Someone who
  never read the source must be able to apply the rule from its prose
  alone.
- **Converting:** keep the source's wording. Change it only to drop what
  the reviewer cannot open (ticket and MR numbers, internal links), to turn
  a question heading into a requirement, or where the format forces it.
  Every change goes in the conversion notes.

## 5. Context entries

A `<context>` points the reviewer at background, says when it is relevant,
and gets no verdict. Use `src` only for a file every reader of the rules
can open: a file of the governed repo, or, in an external folder, a file
in that folder written file-relative (`./guide.md`). Otherwise put the
background in the context's prose.

## 6. Prove it

Keep fixture diffs and a test next to the rules, so the next edit can re-run
them:

- one diff per rule that should select it;
- one diff per trigger list that should not (a near miss);
- one diff outside every scope, which selects nothing.

Then:

- `lore select --diff <fixture> --format json` (for an external folder add
  `--no-repo --given <folder> --remote <url>`): the expected ids are in
  `rules`, and the flagged lines are the right ones.
- `--strict` exits 0: no entry was excluded for an error.
- Read `--format text` once. It is exactly what the reviewer receives.
- A verdict set answering every selected rule passes `lore verdicts`.

## 7. Conversion notes

Keep a notes file beside the rules. For each batch: each rule id with its
source heading; each instruction not converted and why (a step, a lint
rule, a hand-off, a format gap); every wording and severity decision. Whoever
reviews the batch reads it next to the rules.

## 8. After converting

The source keeps only its steps and ends with one that runs `lore select`
on the change and answers the selected rules. It stops restating rules that
Lore now holds: two copies drift apart.

## Common mistakes

| Mistake | Instead |
|---|---|
| The source's signal literals written as a regex `<check>` | `<when>` with `addedContains` |
| `\(` or `\b` in a pattern for a fixed string | a plain string in `addedContains` |
| One rule scoped across two trees | one rule per tree, in each tree's file |
| A rule with no `<when>` at the repo root | scope it to where the slip happens, or record a gap |
| `addedContains` and `addedMatches` in one `<when>` as alternatives | all alternatives in one `addedMatches` list (both conditions must hold) |
| A rule with no `source` in `<meta>` | `source: <document>#<heading slug>` |
| "This shipped once (!4120)" in the prose | the stakes without the reference the reviewer cannot open |
| A procedure step written as a rule | leave it in the skill; convert only the end state |
| A formatting or import rule a linter can decide | a lint rule |
| Ad hoc diffs thrown away after one run | fixtures and a test kept beside the rules |

## Revising this skill

[tests/](tests/) holds a synthetic source skill with every trap above, the
conversion scenario and its rubric. When a conversion teaches something
new, add the trap to the source and a line to the rubric, run the scenario
with the current skill and watch it fail, then change the skill and run it
again until it passes.
