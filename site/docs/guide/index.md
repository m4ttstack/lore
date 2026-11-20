---
slug: /
title: What is Lore
sidebar_position: 1
---

# What is Lore

Lore is an open file format for the rules a team expects every change to follow: the domain knowledge a linter can't check and a new contributor can't guess. Rules live in plain files next to your code. Each rule says where it applies, so any tool or reviewer, human or AI, can work out which rules matter for a given change.

```html
<scope>
  files: ["src/checkout/**/*.{ts,tsx}"]
</scope>

<rule id="price-from-quote" category="functional_correctness" severity="blocking">
  A displayed price must come from the quote that produced it.

  Recomputing a price from its inputs drops quote-level discounts, so the
  customer sees one total and is charged another.
</rule>

<rule id="money-in-minor-units" category="functional_correctness">
  <when>
    addedContains: ["parseFloat(", "toFixed("]
  </when>
  Amounts are integers in minor units (cents). Floating point never touches
  money.
</rule>
```

The first rule applies to any change under `src/checkout/`. The second applies only when the change adds a `parseFloat(` or `toFixed(` call there.

:::note
Lore is an early-stage proposal. The syntax and the name may change before a first stable version.
:::

## Why Lore

Every codebase has rules that matter more than formatting: how money is rounded, which queries must be scoped to a tenant, which files must change together. Those rules usually live in wiki pages, review checklists, long `AGENTS.md` files, or in senior engineers' heads.

That works poorly as a codebase grows:

- **Reviewers can't tell which rules apply.** A 300-line guide is either read in full for every change, or skimmed and missed.
- **Rules are hard to maintain.** Changing one rule means editing a long document and hoping nothing else depended on it.
- **Every tool wants its own format.** Each AI coding and review tool has a different instructions file, and none says which rules a review actually checked.

Lore gives each rule just enough structure for a machine to select it, and keeps the rule itself in plain prose for people and models to apply. In a test on a production codebase, a review agent given Lore caught more planted rule breaks than the same agent given prose, at about 40% of the cost. The method and numbers are in [Does it work?](https://github.com/m4ttstack/lore#does-it-work) in the README.

## Design principles

1. **Plain files, versioned with the code.** Rules are reviewed, blamed and reverted like any other change. No service or account is needed.
2. **Selected, not skimmed.** A rule's scope and conditions are evaluated by code against a diff. Given the same files and the same change, every conforming tool selects the same rules.
3. **Prose is the rule.** Structure only decides when a rule applies. What the rule says is written out in Markdown, complete on its own.
4. **Readable without tooling.** A person or an AI agent who has never heard of Lore can open a `.lore` file and apply it correctly.
5. **Tool-neutral.** Lore is a specification with a conformance suite, not a product. Editors, review bots, CI and agents can all implement it.

## How tools use Lore

Given a change, a tool collects the `.lore` files, selects every rule whose scope covers a changed file and whose conditions hold, and points at lines worth a closer look. It hands the selected rules to a reviewer, who answers each one with `pass`, `fail` or `not-applicable`. Because every selected rule needs exactly one answer, a rule that passed can be told apart from a rule nobody checked.

The reference tool is the [`lore` command](../reference/cli/index.md), on npm as `@mattstack/lore`.

## Next steps

- [Quick start](./quick-start.md): write one rule and run `lore check` on a change in a few minutes.
- [Core concepts](./core-concepts.md): the ten terms the rest of these docs use.
- [Specification](../spec/introduction.md): the normative rules every conforming tool follows.
