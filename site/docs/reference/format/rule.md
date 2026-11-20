---
title: <rule>
sidebar_position: 1
---

# `<rule>`

A `<rule>` is one thing a team expects every change to follow. Its opening tag carries its attributes, its children come next, and its prose states the rule.

```html
<rule id="money-in-minor-units" category="functional_correctness" severity="blocking">
  <when>
    addedContains: ["parseFloat(", "toFixed("]
  </when>
  Amounts are integers in minor units (cents). Floating point never touches
  money.
</rule>
```

A rule that is selected for a change needs a verdict: `pass`, `fail` or `not-applicable`.

## Attributes

| Attribute | Required | Type | Description |
|---|---|---|---|
| [`id`](#id) | yes | string | The rule's id, unique across every collected Lore file. |
| [`category`](#category) | no | string | What kind of problem a violation is. |
| [`severity`](#severity) | no | `blocking` or `advisory` | What a violation costs. |
| [`disabled`](#disabled) | no | bare | Turns the rule off without deleting it. |

### `id`

- **Type:** string matching `^[a-z][a-z0-9-]*$` (kebab-case).
- **Required:** yes.

Rules and contexts share one namespace of ids. An id used by more than one entry, in any collected file, excludes every entry that uses it (`duplicate-id`).

```html
<rule id="price-from-quote">
```

### `category`

- **Type:** string matching `^[a-z][a-z0-9_]*$`, and known for the file.
- **Required:** no.
- **Default:** the `category` of the file's [`<defaults>`](./defaults.md); with none, no category and the warning `missing-category`.

Nine categories are fixed: `functional_correctness`, `test_coverage`, `security`, `performance`, `accessibility`, `observability`, `backwards_compatibility`, `documentation` and `code_style`. A `.loreconfig` can declare more with [`categories`](./loreconfig.md#categories). A category that is not known is `unknown-category`, which excludes the rule.

```html
<rule id="tenant-scoped-queries" category="security">
```

### `severity`

- **Type:** `blocking` or `advisory`.
- **Required:** no.
- **Default:** the `severity` of the file's [`<defaults>`](./defaults.md); with none, `advisory`.

A `blocking` violation is fixed, or explicitly waived, before the change merges. An `advisory` violation is raised, and the author decides.

```html
<rule id="price-from-quote" category="functional_correctness" severity="blocking">
```

### `disabled`

- **Type:** bare attribute, with no value.
- **Required:** no.

A disabled rule is never selected. It is still read and checked like any other rule, so its errors still show. Any value, even `disabled="false"`, is `disabled-has-value`. To switch a rule off for part of a repo without editing it, use [`disable`](./loreconfig.md#disable) in a `.loreconfig`.

```html
<rule id="legacy-prices" category="functional_correctness" disabled>
```

## Children

Children come before the prose, in any order.

| Child | Count | Purpose |
|---|---|---|
| [`<scope>`](./scope.md) | 0 or 1 | Narrows the file's scope for this rule. |
| [`<when>`](./when.md) | 0 or 1 | Conditions on the change. |
| [`<check>`](./check.md) | any | Searches whose hits go to the reviewer. |
| [`<source>`](./source.md) | 0 or 1 | The files the rule was written from. |
| [`<meta>`](./meta.md) | 0 or 1 | Free-form notes, such as an owner. |

A child the rule does not allow is `unknown-child`, and a second `<scope>`, `<when>`, `<source>` or `<meta>` is `duplicate-child`.

## Prose

Everything after the children, up to `</rule>`, is the rule's prose, in Markdown. It must state the rule completely on its own: conditions and checks decide when a rule applies, never what it says.

The prose's first paragraph is the rule's **summary**, used in listings such as `--also-in-scope`. Keep it to one or two sentences. A list directly under the first sentence is part of the summary; a blank line before it keeps it out.

## Specification

- [Rules](../../spec/rules.md)
- [Categories and severity](../../spec/categories-and-severity.md)
- [Entries](../../spec/parsing.md#entries) and [Indentation](../../spec/parsing.md#indentation)
