---
title: <context>
sidebar_position: 2
---

# `<context>`

A `<context>` points a reviewer at a document to read when the context is selected, such as an architecture note. It gets no verdict, and has no category and no severity.

```html
<context id="payments-architecture" src="docs/payments-architecture.md">
  <scope>
    files: ["src/payments/**"]
  </scope>
  Read before changing how a payment is captured.
</context>
```

Context documents stay where they already live; the context only points at them.

## Attributes

| Attribute | Required | Type | Description |
|---|---|---|---|
| [`id`](#id) | yes | string | The context's id, shared with rule ids. |
| [`src`](#src) | no | path | The document to read. |
| [`disabled`](#disabled) | no | bare | Turns the context off without deleting it. |

Any other attribute, `category` and `severity` included, is `unknown-attribute`.

### `id`

- **Type:** string matching `^[a-z][a-z0-9-]*$`.
- **Required:** yes.

Contexts and rules share one namespace of ids, as on [`<rule>`](./rule.md#id).

```html
<context id="payments-architecture" src="docs/payments-architecture.md">
```

### `src`

- **Type:** a relative path to one file, not a glob.
- **Required:** no.

A path that starts with `./` or `../` is relative to the Lore file, and must not leave the Lore root (`src-escapes-root`). Any other path resolves from the Lore file's base. Segments are separated by `/`, none may be empty, and `.` and `..` may appear only at the start.

When `src` names no tracked file, the context gets the warning `missing-src-target` and is still selected as usual. The `lore` command passes the file's text to the reviewer as `srcText` when it can read it.

```html
<context id="checkout-readme" src="./../README.md">
</context>
```

### `disabled`

- **Type:** bare attribute, with no value.
- **Required:** no.

Works as on [`<rule>`](./rule.md#disabled).

## Children

A context takes [`<scope>`](./scope.md), [`<when>`](./when.md) and [`<meta>`](./meta.md), each at most once. `<check>` and `<source>` are `unknown-child` on a context.

## Body

The prose after the children is the context's body. With `src`, the body is an optional note on when or why to read the document. Without `src`, the body is the context itself:

```html
<context id="checkout-glossary">
  A quote is the priced basket the customer agreed to. An order is a paid
  quote.
</context>
```

This context carries its text inline, so the reviewer reads the body itself.

## Specification

- [Context](../../spec/context.md)
- [Rules](../../spec/rules.md#attributes), for how attributes are read
