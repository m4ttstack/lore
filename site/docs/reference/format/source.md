---
title: <source>
sidebar_position: 7
---

# `<source>`

A `<source>` names the files a rule was written from, such as a review guide or a decision record. [`lore audit`](../cli/audit.md) uses it to tell when that text changes, so the rule can be reviewed again.

```html
<rule id="money-in-minor-units" category="functional_correctness">
  <source>
    file: docs/checkout-review.md
    heading: Money is integer minor units
  </source>
  Amounts are integers in minor units (cents). Floating point never touches
  money.
</rule>
```

The block is YAML (or JSON): one mapping, or a list of one or more mappings, each naming one source. It takes no attributes, a rule has at most one, and a context has none. Requires lore 0.6.0 or later.

A `<source>` never changes whether a rule is selected, and parsing never reads the cited file. A source that does not resolve is still valid; `lore audit` reports it.

## Keys

| Key | Required | Type | Description |
|---|---|---|---|
| [`file`](#file) | yes | path | The cited file. |
| [`heading`](#heading) | no | string | A heading in a Markdown file. |
| [`phrase`](#phrase) | no | string | Text that appears in the file, or in the heading's section. |

### `file`

- **Type:** a non-empty path to one file, not a glob.
- **Required:** yes.

A path that starts with `./` or `../` is relative to the Lore file and must stay inside the Lore root. A path that starts with `/` is from the repository root. Any other path resolves from the Lore file's base, as a scope glob does. Segments follow the rules of a context's [`src`](./context.md#src).

```yaml
file: /docs/checkout-review.md
```

### `heading`

- **Type:** a non-empty string: the heading's text or its slug.
- **Required:** no.

Only for a file ending in `.md`, `.mdx` or `.markdown`, compared case-sensitively. When more than one heading matches, the audit uses the first and reports `ambiguous-heading`.

```yaml
heading: Money is integer minor units
```

### `phrase`

- **Type:** a non-empty string.
- **Required:** no.

With `heading`, the phrase must appear inside that heading's section. In a Markdown file without `heading`, the audit reviews the section the phrase is in; in any other file, the whole file. Matching ignores differences in whitespace, so a phrase can span lines.

```yaml
phrase: Never use floating point for money
```

A source with only `file` is flagged by any edit to that file. In a Markdown file, give a `heading` or a `phrase` so only edits to that section count.

## Several sources

A list keeps its order. Two items that resolve to the same file, heading and phrase are `invalid-source`:

```html
<source>
  - file: docs/checkout-review.md
    heading: Money is integer minor units
  - file: docs/adr/0007-minor-units.md
</source>
```

This rule cites a section of the review guide and a whole decision record.

## Errors

Every problem with the block's value is `invalid-source`, which excludes the rule: an unknown key, a missing or empty `file`, a `heading` on a file that is not Markdown, or a path that breaks the rules above.

## Specification

- [Sources](../../spec/sources.md)
- [File paths](../../spec/sources.md#file-paths)
- [Auditing sources](../../spec/auditing-sources.md)
- [`source.schema.json`](../../spec/schemas/source.md)
