---
title: Sources and reviews
sidebar_position: 7
---

# Sources and reviews

A source names the document a rule was written from, such as a section of a review guide or a decision record. With sources in place, `lore audit` tells you when that text changes, and `lore review` records that someone compared the rule with it again.

```html
<rule id="money-in-minor-units" category="functional_correctness" severity="blocking">
  <source>
    file: docs/checkout-review.md
    heading: Money is integer minor units
  </source>
  Amounts are integers in minor units (cents).
</rule>
```

This rule cites one section of the review guide.

Requires lore 0.6.0 or later. An older tool leaves out a rule with a `<source>`, so upgrade every tool that reads your rules first.

## The review cycle

A source starts out `never-reviewed`. Run `lore audit` to see it:

```text
.lore/checkout.lore
  warn  never-reviewed  money-in-minor-units  docs/checkout-review.md#Money is integer minor units

never-reviewed: 1
rules with a source: 1, without: 2
```

Read the rule and the section it cites. When they agree, record it, and commit the lock file the command writes:

```sh
lore review money-in-minor-units
git add lore-reviews.lock
```

`lore audit` now reports nothing for that source. When someone later edits the section, the rule comes due:

```text
.lore/checkout.lore
  warn  source-changed  money-in-minor-units  docs/checkout-review.md#Money is integer minor units

source-changed: 1
rules with a source: 1, without: 2
```

Compare the rule with the new text, update the rule if needed, and run `lore review` again. Trailing spaces and extra blank lines never bring a rule due; any other edit to the cited text does, re-wrapping and re-indenting included.

## Citing precisely

A source with only `file` comes due on any edit to that file, and so does every other rule that cites it. In a Markdown file, name a `heading` or a `phrase` so only edits to that part count:

```html
<source>
  - file: docs/checkout-review.md
    heading: Money is integer minor units
  - file: docs/adr/0007-minor-units.md
</source>
```

A list cites several sources. The rule comes due when any of them changes.

## In CI

The findings `source-missing` and `source-unchecked` are errors by default, so `lore audit` exits 1 when a cited file or heading disappears. The others are warnings. Set levels per directory with the `audit` key of a [`.loreconfig`](./configuration.md), or per run with `--level`:

```sh
lore audit --level source-changed=error
```

## Edge cases

### Lock files

Records live in `lore-reviews.lock`, beside the nearest `.loreconfig` that has `root: true` or a `repo` key, or else at the repository root. `lore audit` reads it only once git tracks it.

### Moving a rule

A rule moved to a folder with another lock file is `never-reviewed` in its new place, and its old record becomes an `orphan-review`. Review it again, then `lore review --prune` removes the old record. If the old lock file no longer covers any collected Lore file, no command reads it, so delete it by hand.

### No flag for every rule

A record states that a person compared the rule with its source. So `lore review` names rules one at a time, or one Lore file at a time with `--file`, never all at once.

## Next steps

- [Adopt sources file by file](../../reference/cli/review.md#file): `lore review --file` for one Lore file at a time.
- [`lore audit`](../../reference/cli/audit.md) and [`lore review`](../../reference/cli/review.md): every option and finding.
- [`<source>` reference](../../reference/format/source.md): `file`, `heading` and `phrase`.
- [Auditing sources](../../spec/auditing-sources.md) in the specification.
