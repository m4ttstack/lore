---
title: Quick start
sidebar_position: 2
---

# Quick start

This page takes you from no rules to a `lore check` that flags a line, in three steps. You need a git repository, Node 20 or later and git 2.25 or later.

## 1. Write one rule

Create `.lore/checkout.lore` at the root of your repository:

```html
<scope>
  files: ["src/checkout/**"]
</scope>

<rule id="price-from-quote" category="functional_correctness" severity="blocking">
  A displayed price must come from the quote that produced it.
</rule>
```

The `<scope>` at the top says the rules in this file apply to changes under `src/checkout/`.

Edit any file under `src/checkout/`, then run:

```sh
npx @mattstack/lore check
```

`lore check` reads your uncommitted work and prints the rules it must follow:

```text
# Lore rules for this change

These rules apply to your change. Fix any that your change breaks.

A flagged line is a place to look, not a verdict. A flagged line marked (removed) is one the change removed, named by the file's old path. Read the context below before changing code. Judge only by these rules; never invent rules from other prose.

## Rule `price-from-quote` (blocking, functional_correctness)

A displayed price must come from the quote that produced it.
```

The rule applies because a changed file is in its scope. Undo that edit and change only `README.md`, and the output is one line:

```text
No Lore rules apply to this change.
```

## 2. Add a condition

Some rules matter only when a change does a particular thing. Add a second rule to the same file, with a `<when>`:

```html
<rule id="money-in-minor-units" category="functional_correctness">
  <when>
    addedContains: ["parseFloat(", "toFixed("]
  </when>
  Amounts are integers in minor units (cents). Floating point never touches
  money.
</rule>
```

`lore check` reads rule files from your working tree, so the new rule applies before you commit it. Now make a change under `src/checkout/` that adds a `toFixed(` call:

```text
## Rule `money-in-minor-units` (advisory, functional_correctness)

Amounts are integers in minor units (cents). Floating point never touches
money.

Flagged lines:

- `src/checkout/total.ts:6` ``   return `Total: ${(quote.total / 100).toFixed(2)}` ``

## Rule `price-from-quote` (blocking, functional_correctness)

A displayed price must come from the quote that produced it.
```

The new rule is selected, and the line that triggered it is flagged as a place to look. A change under `src/checkout/` without `parseFloat(` or `toFixed(` selects only `price-from-quote`.

## 3. Add rules for another part of the repo

A `.lore/` folder can sit anywhere, and its globs resolve from the directory that holds it. Create `services/billing/.lore/invoices.lore`:

```html
<scope>
  files: ["src/**"]
</scope>

<rule id="invoice-numbers-sequential" category="functional_correctness" severity="blocking">
  Invoice numbers come from the billing sequence, never from a timestamp
  or a random value.
</rule>
```

Here `src/**` means `services/billing/src/**`. A change to `services/billing/src/invoice.ts` selects only this rule:

```text
## Rule `invoice-numbers-sequential` (blocking, functional_correctness)

Invoice numbers come from the billing sequence, never from a timestamp
or a random value.
```

The checkout rules stay out of it, because the change is outside their scope.

## Next steps

- [Core concepts](./core-concepts.md): what a rule, a scope and a selection are, in a paragraph each.
- [Writing rules](./topics/writing-rules.md): ids, categories, severity and prose that stands on its own.
- [Conditions](./topics/conditions.md): every `<when>` key, and how to pick one.
- [`lore check`](../reference/cli/check.md): checking one commit or a whole branch instead of uncommitted work.
