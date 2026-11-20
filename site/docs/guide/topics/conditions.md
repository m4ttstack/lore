---
title: Conditions
sidebar_position: 4
---

# Conditions

A condition is a test on the change itself, written in a `<when>` block. A rule with conditions is selected only when its scope covers a changed file and every condition holds.

```html
<rule id="money-in-minor-units" category="functional_correctness">
  <when>
    addedContains: ["parseFloat(", "toFixed("]
  </when>
  Amounts are integers in minor units (cents). Floating point never touches
  money.
</rule>
```

This rule is selected only when a change adds a line that contains `parseFloat(` or `toFixed(`.

## The eight conditions

| Key | Holds when |
|---|---|
| `addedContains`, `addedMatches` | An added line contains a string, or matches a pattern. |
| `removedContains`, `removedMatches` | A removed line contains a string, or matches a pattern. |
| `droppedContains`, `droppedMatches` | A removed line contains a string or matches a pattern, and the same edit adds it back nowhere. |
| `changed` | Another file matching a glob changed. |
| `unchanged` | No file matching a glob changed. |

The `Contains` keys take plain strings and the `Matches` keys take patterns in Lore's [regex dialect](../../spec/regex-dialect.md). Each key has a "selects" and "does not select" pair, from a real run, on the [`<when>` reference](../../reference/format/when.md).

## Added and removed lines

The added-line and removed-line conditions look only at changed files in the rule's scope. Unchanged lines never count.

When a rule is selected, each line these conditions find is a **hit**: it goes to the reviewer as a place to look. So one condition both selects the rule and shows where. A hit on a removed line is named by the file's old path.

```html
<rule id="fallback-kept" category="functional_correctness">
  <when>
    removedContains: ["??"]
  </when>
  A read of an optional field keeps its `??` fallback.
</rule>
```

This rule is selected by any change that removes a line holding `??`, including an edit that changes the line and keeps the `??`.

## Removed, or dropped

Use the dropped pair for a rule about something being deleted. `droppedContains` finds a removed line only when the same **edit** adds the text back nowhere. An edit is a run of changed lines with no unchanged line between them.

```html
<rule id="amounts-keep-fallback" category="functional_correctness">
  <when>
    droppedContains: ["?? 0"]
  </when>
  A read of an optional amount keeps its `?? 0` fallback. Without it, a
  missing amount reaches the total as `undefined`.
</rule>
```

Changing `quote.tax ?? 0` to `quote.salesTax ?? 0` does not select this rule. Deleting the `?? 0` does, and the removed line is pointed out.

The dropped pair has known limits. An edit that adds the same text for another reason hides the removal. A block moved to another place is found at its old place.

## Other files, changed or not

`changed` and `unchanged` look at every file in the change, in the rule's scope or not. Use them for files that must change together:

```html
<rule id="migration-with-schema" category="backwards_compatibility" severity="blocking">
  <scope>
    files: ["db/migrations/**"]
  </scope>
  <when>
    unchanged: ["/db/schema.sql"]
  </when>
  A new migration ships with the regenerated `db/schema.sql`.
</rule>
```

The rule is selected when a migration changes and `db/schema.sql` does not: exactly when the author needs the reminder. A glob that starts with `/` resolves from the repository root; any other glob resolves from the Lore file's base, as in a scope.

## Choosing a condition

- **No condition** when the rule matters for any change to its files. Scope alone is often enough.
- **`addedContains`** when breaking the rule means writing a particular call or name, such as `parseFloat(`.
- **`addedMatches`** when a plain string would match too much or too little.
- **`droppedContains`** when the rule is about keeping something, such as a guard or a fallback.
- **`removedContains`** when any edit to such a line deserves a look, even one that keeps the text.
- **`unchanged`** when the rule is a reminder that another file must change too.

A condition that is too narrow means the rule is never shown when it matters. When in doubt, leave it out, or list the rule with [`--also-in-scope`](../../reference/cli/also-in-scope.md).

## Edge cases

### An empty list

With an empty list, `unchanged` always holds and every other condition never does.

### Switched-off files

A file a `.loreconfig` `disable` list switches the rule off for does not count for the line conditions. `changed` and `unchanged` still see it.

### Unknown keys

A key that is not one of the eight is an error, `unknown-condition`, and the rule is left out. A tool never ignores a condition it does not know, so a rule never means less than you wrote.

## How a `<when>` is evaluated

1. The rule's counted files are the changed files in its scope that no `disable` list switches it off for.
2. Each line condition looks at the added or removed lines of the counted files.
3. `changed` and `unchanged` look at every path in the change.
4. The rule is selected when it has at least one counted file and every condition holds.
5. Each line a line condition finds becomes a hit.

## Next steps

- [`<when>` reference](../../reference/format/when.md): each key with a selects and does-not-select pair.
- [Checks](./checks.md): point at lines without changing whether a rule is selected.
- [Conditions](../../spec/conditions.md) and [Regex dialect](../../spec/regex-dialect.md) in the specification.
