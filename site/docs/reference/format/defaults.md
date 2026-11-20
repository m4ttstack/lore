---
title: <defaults>
sidebar_position: 4
---

# `<defaults>`

`<defaults>` gives every rule in its file a `category` and a `severity` to fall back on. A file has at most one, before its first entry.

```html
<defaults>
  category: functional_correctness
  severity: blocking
</defaults>
```

The block is YAML (or JSON). It takes no attributes. A rule's own attributes take precedence over the defaults, and defaults never apply to a context.

## Keys

| Key | Required | Type | Description |
|---|---|---|---|
| [`category`](#category) | no | string | The category for rules that set none. |
| [`severity`](#severity) | no | `blocking` or `advisory` | The severity for rules that set none. |

### `category`

- **Type:** string matching `^[a-z][a-z0-9_]*$`, and known for the file.
- **Required:** no.

A category that is not known is `unknown-category`. In `<defaults>` that error excludes the whole file, even its rules that set their own category.

```yaml
category: security
```

### `severity`

- **Type:** `blocking` or `advisory`.
- **Required:** no.

Without it, a rule that sets no severity is `advisory`.

```yaml
severity: blocking
```

## Errors

Every error in `<defaults>` excludes the whole file. Any other key, or a value such as `severity: critical`, is `invalid-defaults`.

## Specification

- [Defaults](../../spec/defaults.md)
- [Categories and severity](../../spec/categories-and-severity.md)
- [`defaults.schema.json`](../../spec/schemas/defaults.md)
