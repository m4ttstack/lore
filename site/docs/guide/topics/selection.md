---
title: How selection works
sidebar_position: 10
---

# How selection works

Selection is how a tool decides which rules and contexts apply to a change. It is fully specified, so every conforming tool selects the same entries from the same files and change.

An entry is selected when its scope covers a changed file and its conditions hold:

```html
<scope>
  files: ["src/checkout/**"]
</scope>

<rule id="price-from-quote" category="functional_correctness" severity="blocking">
  A displayed price must come from the quote that produced it.
</rule>
```

Any change to a file under `src/checkout/` selects this rule. A change elsewhere does not.

## Reviewer and author

The same selection serves two readers:

- **A reviewer**, with [`lore select`](../../reference/cli/select.md). It takes a diff, such as a pull request's, and asks for a verdict on every selected rule.
- **An author**, with [`lore check`](../../reference/cli/check.md). It builds the change from git and asks the author to fix what the change breaks.

For a reviewer, the text output ends with the verdict format:

```text
# Lore rules for this change

Answer every rule below with a verdict: `pass`, `fail` or `not-applicable`.
...
Return the verdicts as one fenced code block tagged `lore-verdicts`:
...
## Rule `money-in-minor-units` (advisory, functional_correctness)

Amounts are integers in minor units (cents). Floating point never touches
money.

Flagged lines:

- `src/checkout/total.ts:2` `export const display = (q) => (q.total / 100).toFixed(2);`
```

The full output is on [`lore select`](../../reference/cli/select.md#output).

## Verdicts {#verdicts}

The reviewer answers each selected rule exactly once:

- `pass`: the change keeps the rule.
- `fail`: the change breaks it. Give at least one location: a changed file and a line in it.
- `not-applicable`: the rule was selected but does not bear on this change. Say why in `note`.

```json
{
  "lore": "1",
  "verdicts": [
    {
      "rule": "money-in-minor-units",
      "verdict": "fail",
      "evidence": [{ "file": "src/checkout/total.ts", "line": 2 }],
      "note": "toFixed on a float amount"
    },
    { "rule": "price-from-quote", "verdict": "pass" }
  ]
}
```

Because every selected rule needs one answer, a rule that passed can be told apart from a rule nobody checked. [`lore verdicts`](../../reference/cli/verdicts.md) checks a verdict set against the saved selection and lists anything missing.

## Rules that almost applied

A rule whose scope covers a changed file but whose conditions did not hold is not selected. With `--also-in-scope`, the tool lists those rules too, one line each, so a reviewer can ask for one in full with `--expand`. Listed rules need no verdict. See [Rules in scope, not triggered](../../reference/cli/also-in-scope.md).

## Edge cases

### Rules in the change

A Lore file in the change is read as the change leaves it. A rule the change adds can apply to that same change, and a rule the change deletes does not. To judge by the rules before the change, use [`--rules-ref`](./shared-rules.md#reading-rules-at-a-ref).

### Errors

An entry with an error, or in a file with a file-level error, is never selected. The tool reports it as excluded, and every other entry still applies. With `--strict`, an excluded entry makes the command exit 1.

### Deleted and renamed files

A deleted file counts by its old path. A renamed file counts by both paths, so a rule scoped to either one applies.

## How an entry is selected

1. Its file is collected, and neither the file nor the entry has an error.
2. It is not `disabled`.
3. At least one changed file is in its scope and not switched off by a `disable` list.
4. Its `<when>`, if it has one, holds.

## Next steps

- [Conditions](./conditions.md): the tests in step 4.
- [Output formats](../../reference/cli/output.md): the selection JSON and the verdict set, field by field.
- [Eligibility](../../spec/eligibility.md) in the specification.
