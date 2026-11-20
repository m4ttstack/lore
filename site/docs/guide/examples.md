---
title: Examples
sidebar_position: 3.5
---

# Examples

This page shows the Lore files of one small, made-up repository: a shop with a checkout, a server and a billing service. Every file is complete, so you can copy it as a starting point.

```text
.loreconfig
.lore/
  security.lore           rules for the whole repo
  checkout.lore           rules for src/checkout/
services/billing/
  .lore/
    invoices.lore         rules for services/billing/
docs/
  checkout-review.md      cited by a rule
  payments.md             read by a context
```

## `.loreconfig`

```yaml
categories: [data_retention]
```

This adds one category of the team's own, `data_retention`, to the nine built-in ones. Without it, a rule with that category would be an error.

## `.lore/security.lore`

```html
<defaults>
  category: security
  severity: blocking
</defaults>

<rule id="tenant-scoped-queries">
  <scope>
    files: ["server/**/*.ts"]
  </scope>
  <check>
    findMany\(
  </check>
  Every database query on customer data filters by `tenantId`.

  A query without it can return another customer's records.
</rule>

<rule id="no-logging-request-bodies">
  <when>
    addedContains: ["console.log(req.body"]
  </when>
  Never log a request body. It can hold passwords and card numbers.
</rule>
```

- `<defaults>` makes both rules `security` and `blocking`, so neither repeats it.
- `tenant-scoped-queries` applies to every change under `server/`. Its check points the reviewer at each added `findMany(` call.
- `no-logging-request-bodies` has no scope, so it covers the whole repo, but it applies only when a change adds a `console.log(req.body` line.

## `.lore/checkout.lore`

```html
<scope>
  files: ["src/checkout/**"]
</scope>

<defaults>
  category: functional_correctness
</defaults>

<rule id="price-from-quote" severity="blocking">
  A displayed price comes from the quote that produced it.

  Recomputing a price drops quote-level discounts, so the customer sees one
  total and is charged another.
</rule>

<rule id="money-in-minor-units">
  <when>
    addedContains: ["parseFloat(", "toFixed("]
  </when>
  <source>
    file: docs/checkout-review.md
    heading: Money is integer minor units
  </source>
  Amounts are integers in minor units (cents). Floating point never touches
  money.
</rule>

<context id="payments-architecture" src="docs/payments.md">
  Read before changing how a payment is captured.
</context>
```

- The `<scope>` at the top limits every entry in the file to `src/checkout/`.
- `price-from-quote` applies to any checkout change. It sets its own severity.
- `money-in-minor-units` applies only when a checkout change adds `parseFloat(` or `toFixed(`. It has no severity, so it is `advisory`. Its `<source>` names the section of the review guide it was written from.
- `payments-architecture` is a context, not a rule. It tells the reviewer to read `docs/payments.md`, and gets no verdict.

## `services/billing/.lore/invoices.lore`

```html
<scope>
  files: ["src/**", "db/**"]
</scope>

<rule id="invoice-numbers-sequential" category="functional_correctness" severity="blocking">
  <scope>
    files: ["src/**"]
  </scope>
  Invoice numbers come from the billing sequence, never from a timestamp or
  a random value.
</rule>

<rule id="invoices-kept-seven-years" category="data_retention" severity="blocking">
  <when>
    addedContains: ["deleteInvoice("]
  </when>
  Invoices are kept for seven years. Code that deletes one checks its age
  first.
</rule>

<rule id="migration-with-schema" category="backwards_compatibility">
  <scope>
    files: ["db/migrations/**"]
  </scope>
  <when>
    unchanged: ["db/schema.sql"]
  </when>
  A new migration ships with the regenerated `db/schema.sql`.
</rule>
```

- This file sits under `services/billing/`, so every glob in it starts there: `src/**` means `services/billing/src/**`.
- The file's scope covers `src/` and `db/`. Two rules narrow it further with a scope of their own.
- `invoices-kept-seven-years` uses the `data_retention` category that `.loreconfig` declared.
- `migration-with-schema` applies when a migration changes and `db/schema.sql` does not. It is a reminder about a file missing from the change.

## What each change selects

These are the rules `lore check` printed for each change.

| Change | Rules | Why |
|---|---|---|
| Edit `src/checkout/total.ts` | `price-from-quote`, plus the `payments-architecture` context | The file is in the checkout scope; nothing triggers the other rule. |
| Add `toFixed(` in `src/checkout/total.ts` | `money-in-minor-units`, `price-from-quote`, plus the context | The added line meets the `addedContains` condition, and is flagged. |
| Add a `findMany(` query in `server/orders.ts` | `tenant-scoped-queries` | The file is in scope. The check flags the new query's line. |
| Add `console.log(req.body)` in a new `server/log.ts` | `no-logging-request-bodies`, `tenant-scoped-queries` | The condition holds, and the new file is also under `server/`. |
| Add a migration in `services/billing/db/migrations/` | `migration-with-schema` | `db/schema.sql` did not change. |
| Add a migration and update `db/schema.sql` | none | The reminder is not needed. |
| Add `deleteInvoice(` in `services/billing/src/invoice.ts` | `invoice-numbers-sequential`, `invoices-kept-seven-years` | The condition holds, and the file is in the `src/` scope. |

For the second change, the full output is:

`````text
# Lore rules for this change

These rules apply to your change. Fix any that your change breaks.

A flagged line is a place to look, not a verdict. A flagged line marked (removed) is one the change removed, named by the file's old path. Read the context below before changing code. Judge only by these rules; never invent rules from other prose.

## Rule `money-in-minor-units` (advisory, functional_correctness)

Amounts are integers in minor units (cents). Floating point never touches
money.

Flagged lines:

- `src/checkout/total.ts:2` `  return (quote.total / 100).toFixed(2)`

## Rule `price-from-quote` (blocking, functional_correctness)

A displayed price comes from the quote that produced it.

Recomputing a price drops quote-level discounts, so the customer sees one
total and is charged another.

## Context `payments-architecture`

Read before changing how a payment is captured.

From `docs/payments.md`:

````
# Payments

Capture happens after the order is confirmed.
````
`````

The context's document is included in the output, so the reader does not have to open it.

## Next steps

- [Quick start](./quick-start.md): build a file like these one step at a time.
- [Writing rules](./topics/writing-rules.md): how to phrase a rule so it stands on its own.
- [Format reference](../reference/format/rule.md): every element and key used above.
