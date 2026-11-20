---
title: Writing rules
sidebar_position: 2
---

# Writing rules

A rule is one thing your team expects every change to follow. It has an id, an optional category and severity, and prose that states the rule completely.

```html
<rule id="tenant-scoped-queries" category="security" severity="blocking">
  Every query on customer data filters by `tenantId`.

  A query without it can return another customer's records.
</rule>
```

The first paragraph is the rule; the second says why it matters.

## A complete example

A real rule usually adds a scope, a condition and a link back to where it came from:

```html
<rule id="money-in-minor-units" category="functional_correctness" severity="blocking">
  <scope>
    files: ["src/checkout/**/*.ts"]
  </scope>
  <when>
    addedContains: ["parseFloat(", "toFixed("]
  </when>
  <source>
    file: docs/checkout-review.md
    heading: Money is integer minor units
  </source>
  Amounts are integers in minor units (cents). Floating point never touches
  money.

  Store and pass cents as integers, and format them only for display.
</rule>
```

Children come first, in any order, then the prose. Each child is covered on its own page: [scope](./scope.md), [conditions](./conditions.md), [sources](./sources-and-reviews.md).

## Ids

An id is kebab-case: lowercase letters, digits and `-`, starting with a letter. Rules and contexts share one set of ids across every collected file, external folders included. Two entries with the same id are both left out, so pick ids that say what the rule is about, such as `money-in-minor-units` rather than `checkout-rule-3`.

## Categories

A category says what kind of problem a violation is. Nine are fixed:

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

You can declare your own in a [`.loreconfig`](./configuration.md). A rule with no category still works; it gets the warning `missing-category`, so you can wrap existing rules first and classify them later.

## Severity

`blocking` means a violation is fixed, or explicitly waived, before the change merges. `advisory` means a reviewer raises it and the author decides. A rule with no severity takes the severity in its file's `<defaults>`. It is advisory only when neither the rule nor the file sets one, so a rule blocks only when someone wrote `blocking`.

To set a category or severity for every rule in a file, use [`<defaults>`](../../reference/format/defaults.md). A rule's own attributes win.

## Prose

The prose is the rule. Conditions and checks decide when a rule applies and where to look; they never add to what it says. A reader who skips every block above the prose should still know exactly what the rule asks.

- **Lead with the rule.** The first paragraph is the rule's summary, shown in listings. Keep it to one or two sentences.
- **Say why after.** A second paragraph on the cost of breaking the rule helps a reviewer judge edge cases.
- **One rule per entry.** Two expectations in one rule get one verdict between them, so a reviewer can't pass one and fail the other.
- **Name things exactly.** Write `IconButton` and `aria-label`, not "icon buttons need labels".

A list directly under the first sentence is part of the summary. Put a blank line before a list to keep it out.

## Turning a rule off

Add the bare `disabled` attribute to stop a rule being selected without deleting it. Its errors are still reported. To switch a rule off for part of a repository without editing its file, use [`disable`](./configuration.md#switching-rules-off) in a `.loreconfig`.

```html
<rule id="legacy-prices" category="functional_correctness" disabled>
```

## How a rule's category and severity are found

1. The rule's own `category` or `severity` attribute.
2. Otherwise, the file's `<defaults>`.
3. Otherwise, no category (with the warning `missing-category`) and `advisory`.

## Next steps

- [Scope](./scope.md): limit a rule to the files it can be broken in.
- [Conditions](./conditions.md): select a rule only when the change does something specific.
- [`<rule>` reference](../../reference/format/rule.md): every attribute and child, key by key.
- The [`writing-lore` skill](https://github.com/m4ttstack/lore/blob/main/skills/writing-lore/SKILL.md): guidance for an agent converting a review guide into rules.
