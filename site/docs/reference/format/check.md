---
title: <check>
sidebar_position: 6
---

# `<check>`

A `<check>` is a child of a rule that holds a search. When the rule is selected, the search runs over the rule's counted files, and each line it finds goes to the reviewer as a **hit**.

```html
<rule id="money-in-minor-units" category="functional_correctness">
  <check>
    parseFloat\(|toFixed\(
  </check>
  Amounts are integers in minor units (cents). Floating point never touches
  money.
</rule>
```

A hit is a place to look, never a verdict. A check does not decide whether its rule is selected; use [`<when>`](./when.md) for that. A rule may have any number of checks, and a context has none.

## Attributes

| Attribute | Required | Type | Description |
|---|---|---|---|
| [`lang`](#lang) | no | string | The check's language. |

### `lang`

- **Type:** string.
- **Required:** no.
- **Default:** `regex`.

The specification defines `regex` and `ast-grep`. Any other value is kept as written; a tool skips that check with the warning `unsupported-check-language`, and the rule stays selected. `lang` with no value, or `lang=""`, is `invalid-attribute-value`.

```html
<check lang="ast-grep">
  console.log($$$)
</check>
```

## Body

The body is the lines strictly between the tags, with indentation removed, so the tags go on lines of their own. A `regex` body is one pattern in the [regex dialect](../../spec/regex-dialect.md); a body of two or more lines is `regex-not-one-line`, and anything outside the dialect is `regex-outside-dialect`. An `ast-grep` body may span lines.

A `regex` check searches the added lines of each counted file.

## In the lore command

The `lore` command runs `regex` checks. In this version it skips `ast-grep` checks, and their rules stay selected. Each one reports `check-needs-file`, or `unsupported-check-language` when `ast-grep` 0.51.0 is not on the `PATH`. See [`--capabilities`](../cli/options.md#capabilities).

## Specification

- [Checks](../../spec/checks.md)
- [Running checks](../../spec/checks.md#running-checks)
- [ast-grep checks](../../spec/checks.md#ast-grep-checks)
- [Regex dialect](../../spec/regex-dialect.md)
