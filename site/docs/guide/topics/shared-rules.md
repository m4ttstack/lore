---
title: Shared rule repositories
sidebar_position: 9
---

# Shared rule repositories

Rules don't have to live in the repository they govern. A team can keep them in a repository of their own and hand that folder to the tool, so one set of rules serves several repositories.

```sh
lore check --given ../team-rules/lore
```

`--given` names a **given folder**: a folder of Lore files outside the repository being changed.

## A complete example

A team rules repository maps its rules onto each repository with a `repo` key:

```text
team-rules/lore/
  .loreconfig            root: true
                         categories: [data_provenance]
  shop/
    .loreconfig          repo: github.com/acme/shop
    .lore/
      checkout.lore      base: the shop repo's root
```

`shop/.loreconfig` marks `shop/` as standing for the root of `github.com/acme/shop`. Below it, directories mirror the shop repository, so `checkout.lore` resolves its globs from the shop's root:

```html
<scope>
  files: ["src/checkout/**"]
</scope>

<rule id="prices-from-pricing-service" category="data_provenance" severity="blocking">
  Prices shown in checkout come from the pricing service, never from the
  product catalog.
</rule>
```

From a clone of the shop, with an uncommitted edit to `src/checkout/price.ts`:

```text
$ lore check --given ../team-rules/lore
...
## Rule `prices-from-pricing-service` (blocking, data_provenance)

Prices shown in checkout come from the pricing service, never from the
product catalog.
```

The tool read the shop's remote (`git@github.com:acme/shop.git`), matched it to `repo: github.com/acme/shop`, and collected the rules below `shop/`. Without `--given`, or with `--remote github.com/acme/blog`, the same change selects nothing.

## Matching the governed repo

The tool matches each `repo` key against the governed repo's remotes, read from `git remote -v`. Pass `--remote` to name them yourself, for example in CI where the clone's remote is a mirror. Only the Lore files below a marked directory that names the governed repo are collected.

## Reading rules at a ref

A change judged by its own rules can loosen the rule it breaks in the same commit. To judge a change by the rules on the branch it merges into, read the governed repo's Lore files at that ref:

```sh
lore check --base origin/main --rules-ref origin/main
```

The change itself still comes from your branch. Only the rules come from `origin/main`.

## Edge cases

### Tracked files only

A given folder inside a git working copy is an **external folder**: only files git tracks there are read. Commit new rules in the team repository before they apply.

### Loose folders

A given folder in no working copy, such as a downloaded copy of the rules, is a **loose folder**. Every file under it is read, and the tool warns `untracked-given-folder` unless its top `.loreconfig` says `loose: true`.

### Ids across repositories

Ids must be unique across every collected file, the governed repo's and the given folders' together. Two rules with the same id are both left out.

### Lock files

Each marked directory gets its own `lore-reviews.lock`, so the shop's and the blog's review records never meet.

## Next steps

- [`--given`, `--remote` and `--rules-ref`](../../reference/cli/options.md#rules): the options, with defaults.
- [Configuration](./configuration.md): `root`, `categories` and `disable` in a team repository.
- [External folders](../../spec/external-folders.md) in the specification.
