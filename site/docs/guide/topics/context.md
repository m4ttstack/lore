---
title: Context
sidebar_position: 6
---

# Context

A context points a reviewer at background reading, such as an architecture note, and says when it is relevant. It is selected like a rule but gets no verdict: it is never pass or fail.

```html
<context id="billing-architecture" src="docs/billing.md">
  Read before reviewing changes to how invoices are calculated.
</context>
```

When this context is selected, the reviewer is told to read `docs/billing.md`.

## A complete example

A context takes the same `<scope>` and `<when>` a rule does, so it shows up only when it matters:

```html
<context id="payments-capture-flow" src="docs/payments/capture.md">
  <scope>
    files: ["services/payments/**"]
  </scope>
  <when>
    addedContains: ["capture(", "authorize("]
  </when>
  The capture flow has three states and a retry rule that is easy to break.
  Read it before changing when a payment is captured.
</context>
```

The context is selected only for a change that adds a `capture(` or `authorize(` call under `services/payments/`.

## With or without `src`

With `src`, the body is an optional note on when or why to read the document. The `lore` command includes the document's text in the selection when git tracks the file, so a reviewer does not have to open it.

Without `src`, the body is the context itself. Use that for short background that has no other home:

```html
<context id="checkout-glossary">
  <scope>
    files: ["src/checkout/**"]
  </scope>
  A quote is the priced basket the customer agreed to. An order is a paid
  quote. Never call a quote an order in code or copy.
</context>
```

Long or shared documents stay where they are; Lore only points at them.

## Edge cases

### Paths

A `src` that starts with `./` or `../` is relative to the Lore file and must stay inside the Lore root. Any other `src` resolves from the Lore file's base, as a scope glob does. It names one file, not a glob.

### A missing document

A context whose `src` names no tracked file gets the warning `missing-src-target` and is still selected.

### Not a rule

A context has no category, no severity, no `<check>` and no `<source>`. Use a rule for anything a reviewer must pass or fail.

## Next steps

- [Writing rules](./writing-rules.md): for expectations a reviewer must check.
- [`<context>` reference](../../reference/format/context.md): attributes and children.
- [Context](../../spec/context.md) in the specification.
