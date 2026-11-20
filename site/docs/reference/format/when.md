---
title: <when>
sidebar_position: 5
---

# `<when>`

`<when>` is a child of a rule or a context that holds conditions on the change. An entry with a `<when>` is selected only when every one of its conditions holds.

```html
<rule id="prices-not-parsed" category="functional_correctness">
  <when>
    addedContains: ["parseFloat("]
  </when>
  A price is never parsed from text with `parseFloat`.
</rule>
```

The block is YAML (or JSON): a mapping from condition keys to lists. It takes no attributes, and an entry has at most one.

## Keys

All keys are optional, but the mapping must have at least one.

| Key | Type | Holds when |
|---|---|---|
| [`addedContains`](#addedcontains) | list of strings | An added line of a counted file contains one of the strings. |
| [`addedMatches`](#addedmatches) | list of patterns | An added line of a counted file matches one of the patterns. |
| [`removedContains`](#removedcontains) | list of strings | A removed line of a counted file contains one of the strings. |
| [`removedMatches`](#removedmatches) | list of patterns | A removed line of a counted file matches one of the patterns. |
| [`droppedContains`](#droppedcontains) | list of strings | A removed line contains one of the strings, and no added line of the same edit does. |
| [`droppedMatches`](#droppedmatches) | list of patterns | A removed line matches one of the patterns, and no added line of the same edit does. |
| [`changed`](#changed) | list of globs | A changed file anywhere in the change matches one of the globs. |
| [`unchanged`](#unchanged) | list of globs | No changed file anywhere in the change matches any of the globs. |

An entry's **counted files** are the changed files in its scope, apart from those a `.loreconfig` `disable` list switches the entry off for. The six line conditions look only at counted files. `changed` and `unchanged` look at the whole change.

The lines a line condition finds are **hits**: they go to the reviewer as places to look. A hit on a removed line is named by the file's old path and marked as on the old side.

Each pair below comes from a real `lore select` run on a two-commit repo. The rule is shown first, then a change that selects it and one that does not.

### `addedContains`

- **Type:** list of non-empty strings, each on one line.
- **Required:** no.

Holds when an added line of a counted file contains one of the strings. Matching is case-sensitive and compares code point by code point. Unchanged lines never count.

```yaml
addedContains: ["parseFloat("]
```

**Selects:** the change adds a line that calls `parseFloat(`. The rule is selected with a hit on line 4.

```diff title="src/Price.tsx"
-  return <span>{quote.total}</span>
+  const amount = parseFloat(quote.total)
+  return <span>{amount}</span>
```

**Does not select:** with `addedContains: ["'USD'"]`, a change to a file whose unchanged first line holds `'USD'`. Only added lines count.

```diff title="src/Price.tsx"
-  return <span>{quote.total}</span>
+  return <span>{quote.total} {quote.currency}</span>
```

Based on [Example 64](../../spec/conditions.md#example-64).

### `addedMatches`

- **Type:** list of patterns in the [regex dialect](../../spec/regex-dialect.md).
- **Required:** no.

Holds when an added line of a counted file matches one of the patterns. A pattern is searched for anywhere in the line, and `^` matches only at the start of the line's text, before any indentation.

```yaml
addedMatches: ['\d+\.\d{2}']
```

**Selects:** the change adds a price literal. The rule is selected with a hit on line 2.

```diff title="src/Shipping.tsx"
-  return null
+  const shipping = 4.99
+  return shipping
```

**Does not select:** the same change, with `addedMatches: ['^const shipping']`. The added line starts with two spaces, so `^const` does not match.

Based on [Example 65](../../spec/conditions.md#example-65). Write patterns in single quotes in YAML, so backslashes stay as written.

### `removedContains`

- **Type:** list of non-empty strings, each on one line.
- **Required:** no.

Holds when a removed line of a counted file contains one of the strings. It compares as `addedContains` does.

```yaml
removedContains: ["??"]
```

**Selects:** the change removes a line that holds `??`. The hit is on line 2 of the old file.

```diff title="src/Price.tsx"
-  const label = quote.label ?? ''
+  const label = quote.label
```

**Does not select:** the reverse change, which adds `??`. Added lines never count for a removed-line condition.

```diff title="src/Price.tsx"
-  const label = quote.label
+  const label = quote.label ?? ''
```

Based on [Example 66](../../spec/conditions.md#example-66).

### `removedMatches`

- **Type:** list of patterns in the [regex dialect](../../spec/regex-dialect.md).
- **Required:** no.

Holds when a removed line of a counted file matches one of the patterns. It searches as `addedMatches` does.

```yaml
removedMatches: ['isEnabled\(']
```

**Selects:** the change removes a feature flag check. The hit is on line 2 of the old file.

```diff title="src/Banner.tsx"
-  if (isEnabled('new-banner')) return <New />
-  return <Old />
+  return <New />
```

**Does not select:** a change that adds the flag check.

```diff title="src/Banner.tsx"
+  if (isEnabled('new-banner')) return <New />
```

The specification has no example for this key; this pair is from a run only.

### `droppedContains`

- **Type:** list of non-empty strings, each on one line.
- **Required:** no.

Holds when a removed line of a counted file contains one of the strings, and no added line of the same **edit** contains it. An edit is a run of removed and added lines with no unchanged line between them.

```yaml
droppedContains: ["??"]
```

**Selects:** the fallback is removed and not added back.

```diff title="src/Total.tsx"
-  const tax = quote.tax ?? 0
+  const tax = quote.tax
```

**Does not select:** the line changes, but the edit keeps `??`. A `removedContains` condition would hold here.

```diff title="src/Price.tsx"
-  const label = quote.label ?? ''
+  const label = quote.title ?? ''
```

Based on [Example 67](../../spec/conditions.md#example-67). Pairing is by edit, not line by line, so one added line that holds the string keeps every removed line of that edit from being found.

### `droppedMatches`

- **Type:** list of patterns in the [regex dialect](../../spec/regex-dialect.md).
- **Required:** no.

Holds when a removed line of a counted file matches one of the patterns, and no added line of the same edit matches that pattern. Each pattern is paired on its own.

```yaml
droppedMatches: ['\?\?', '^\s*if \(']
```

**Selects:** the `if (` stays, but the `??` is gone, so the `??` pattern finds the line.

```diff title="src/Discount.tsx"
-  if (code ?? defaultCode) {
+  if (code) {
```

**Does not select:** the default changes, but `??` is still on the added line.

```diff title="src/Coupon.tsx"
-  const rate = coupon.rate ?? 0
+  const rate = coupon.rate ?? 0.05
```

Based on [Example 69](../../spec/conditions.md#example-69).

### `changed`

- **Type:** list of globs.
- **Required:** no.

Holds when a changed file anywhere in the change matches one of the globs, in the entry's scope or not. A glob that starts with `/` resolves from the repository root; any other glob resolves against the Lore file's base, as in a [scope](./scope.md). A deleted or renamed file's old path counts too.

```html
<rule id="checkout-follows-api-schema" category="backwards_compatibility">
  <scope>
    files: ["src/**/*.tsx"]
  </scope>
  <when>
    changed: ["/api/schema.graphql"]
  </when>
  A checkout change made alongside an API schema change still works with
  the schema that is deployed now.
</rule>
```

**Selects:** a change to `src/Price.tsx` that also changes `api/schema.graphql`, though the schema is outside the rule's scope.

**Does not select:** the same change to `src/Price.tsx` alone.

Based on [Example 72](../../spec/conditions.md#example-72). A `changed` condition finds no lines, so it gives no hits.

### `unchanged`

- **Type:** list of globs.
- **Required:** no.

Holds when no changed file anywhere in the change matches any of the globs. Globs resolve as for `changed`. With an empty list, `unchanged` always holds.

```html
<scope>
  files: ["**/*.graphql"]
</scope>

<rule id="regen-types-after-graphql" category="functional_correctness">
  <when>
    unchanged: ["/src/__generated__/**"]
  </when>
  A `.graphql` change ships with regenerated types in `src/__generated__/`.
</rule>
```

**Selects:** a change to `api/quote.graphql` with nothing changed under `src/__generated__/`. The reminder applies.

**Does not select:** the same change with `src/__generated__/graphql.ts` changed too. The types were regenerated, so there is nothing to remind the author of.

Based on [Example 73](../../spec/conditions.md#example-73).

## Errors

Every error in a `<when>` excludes its entry:

- `invalid-when`: the value is not a mapping, a condition's value is not a list of strings, or a contains string is empty or spans lines.
- `empty-when`: the mapping has no keys.
- `unknown-condition`: a key is not one of the eight above. A tool never ignores a key it does not know.
- `regex-not-one-line`, `regex-outside-dialect`: a pattern is not one line, or not in the [regex dialect](../../spec/regex-dialect.md).
- `invalid-glob`, `glob-escapes-base`: a glob is malformed, or has a `..` segment.

With an empty list, every condition except `unchanged` never holds.

## Specification

- [Conditions](../../spec/conditions.md)
- [Regex dialect](../../spec/regex-dialect.md)
- [Glob syntax](../../spec/scope-and-globs.md#glob-syntax)
- [`when.schema.json`](../../spec/schemas/when.md)
