---
title: Configuration
sidebar_position: 8
---

# Configuration

A `.loreconfig` file holds settings for its directory and everything below it, like a `.gitignore`. Every key is optional, and most repositories need none.

```yaml
categories: [data_retention]
```

This `.loreconfig` at the repository root lets any rule use the category `data_retention`.

## A complete example

```yaml
lore: 1
root: true
categories: [data_retention, web_vitals]
disable: [icon-buttons-have-labels]
audit:
  maxAgeDays: 180
  levels:
    source-changed: error
```

This file declares two categories, switches one rule off for changed files in its directory and below, marks a Lore root, and sets how `lore audit` reports. Each key is described on the [`.loreconfig` reference](../../reference/format/loreconfig.md).

## Declaring categories

The nine fixed categories cover most rules. Declare more with `categories` when your team needs a word of its own, such as `data_retention`. A declared category is known for Lore files in that directory and below.

## Switching rules off

`disable` switches entries off for changed files in its directory and below, without editing the file that holds them. A team can use a shared rule everywhere except a legacy folder:

```yaml
# legacy/.loreconfig
disable: [currency-from-settings]
```

A change under `legacy/` does not count toward `currency-from-settings`. A change elsewhere still selects it. A `disable` id that names no entry gets the warning `unknown-disabled-id`, so a typo does not go unnoticed.

The `disabled` attribute on a rule is the author's switch; `disable` is the consumer's.

## Lore roots

`root: true` makes a directory a **Lore root**: lookup for anything at or below it stops there. Use it in a monorepo where `apps/web/` should not inherit settings from the repository root:

```yaml
# apps/web/.loreconfig
root: true
categories: [web_vitals]
```

`apps/web/` now knows `web_vitals` but not the root's `data_retention`.

## Edge cases

### A broken `.loreconfig`

A `.loreconfig` with any problem, such as an unknown key or `root: yes`, is ignored as a whole and reported as `invalid-loreconfig`. Rules that relied on it then fail on their own: one whose category it declared becomes `unknown-category`.

### Not inside a `.lore/` folder

A `.loreconfig` inside a `.lore/` folder is ignored. Put it in the directory that holds the folder, or above.

### Lists add up

`categories` and `disable` lists add down the tree. A `.loreconfig` below cannot take away a category, or switch a rule back on, that one above it set.

## Lookup order

For a directory, the settings come from:

1. its own `.loreconfig`, if any;
2. each `.loreconfig` above it, one directory at a time;
3. up to its Lore root: the nearest directory with `root: true`, or else the repository root.

`categories` and `disable` add up across every file found. `maxAgeDays` and each audit level take the nearest value set.

## Next steps

- [Shared rule repositories](./shared-rules.md): the `repo` key, for rules kept in another repository.
- [`.loreconfig` reference](../../reference/format/loreconfig.md): every key, with types and defaults.
- [.loreconfig](../../spec/loreconfig.md) in the specification.
