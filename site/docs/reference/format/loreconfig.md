---
title: .loreconfig
sidebar_position: 9
---

# `.loreconfig`

A `.loreconfig` file holds settings for the directory it is in and every directory below it. It can sit in any directory of a repository, except inside a `.lore/` folder.

```yaml
root: true
categories: [data_provenance]
disable: [legacy-prices]
audit:
  maxAgeDays: 180
```

The whole file is one YAML (or JSON) mapping. An empty file sets nothing.

## Keys

All keys are optional.

| Key | Type | Description |
|---|---|---|
| [`lore`](#lore) | `1` | The specification version the files follow. |
| [`root`](#root) | boolean | Makes this directory a Lore root, where lookup stops. |
| [`repo`](#repo) | string | Marks this directory as standing for another repository's root. |
| [`loose`](#loose) | boolean | Says a loose folder is meant to be loose. |
| [`categories`](#categories) | list of strings | Categories declared for this directory and below. |
| [`disable`](#disable) | list of ids | Entries switched off for changed files here and below. |
| [`audit`](#audit) | mapping | Age limit and finding levels for `lore audit`. |

### `lore`

- **Type:** the number `1`.
- **Default:** `1`.

Any other value, such as `lore: 2`, is `invalid-loreconfig`.

```yaml
lore: 1
```

### `root`

- **Type:** boolean.
- **Default:** `false`.

`true` makes this directory a **Lore root**: lookup for directories at or below it stops here and never reads a `.loreconfig` above it. A file-relative `src` or `<source>` path must not climb above its Lore root. `root: yes` is a string, not a boolean, and is `invalid-loreconfig`.

```yaml
root: true
```

### `repo`

- **Type:** string, `<host>/<path>`.

Marks this directory as standing for the root of the repository it names. In a shared rules repository, the Lore files below a directory marked `repo: github.com/acme/shop` apply when the governed repo is the shop. See [External folders](../../spec/external-folders.md).

```yaml
repo: github.com/acme/shop
```

### `loose`

- **Type:** boolean.
- **Default:** `false`.

Only has an effect in the `.loreconfig` at the top of a loose folder: a given folder in no git working copy. `true` says the folder is meant to be loose, so the `untracked-given-folder` warning is not reported. Requires lore 0.2.0 or later.

```yaml
loose: true
```

### `categories`

- **Type:** list of strings matching `^[a-z][a-z0-9_]*$`.

Declares categories beyond the nine fixed ones, for Lore files in this directory and below. Lists add down the tree: a `.loreconfig` below cannot take away a category one above declares.

```yaml
categories: [data_provenance, web_vitals]
```

### `disable`

- **Type:** list of entry ids.

Switches entries off for changed files in this directory and below, without editing the files that hold them. A switched-off file does not count toward the entry's conditions and checks, though `changed` and `unchanged` still see it. Lists add down the tree. An id that names no entry the list can switch off is the warning `unknown-disabled-id`.

```yaml
disable: [legacy-prices-from-quote]
```

### `audit`

- **Type:** mapping with two optional keys, `maxAgeDays` and `levels`.

`maxAgeDays` is a positive integer: the age after which `lore audit` reports `review-overdue`. `levels` maps a finding name to `error`, `warn` or `off`. Requires lore 0.6.0 or later. The findings and their default levels are on [`lore audit`](../cli/audit.md#findings).

```yaml
audit:
  maxAgeDays: 180
  levels:
    source-changed: error
    never-reviewed: off
```

## Errors

Every problem in a `.loreconfig` is `invalid-loreconfig`: an unknown key, a value the table does not allow, or a YAML problem. A tool ignores that `.loreconfig` as a whole, as if it did not exist, and reports the error once. Entries that relied on it then fail on their own, so a category it declared becomes `unknown-category`.

## Lookup order

For a directory, settings come from the `.loreconfig` files that apply to it:

1. The `.loreconfig` in the directory itself, if any.
2. Each `.loreconfig` in a directory above it, one level at a time.
3. Lookup stops at the directory's Lore root: the nearest directory at or above it whose `.loreconfig` has `root: true`, or else the repository root. In a loose folder it never goes above the folder. In a shared rules repository, it stops at the directory marked with `repo` unless a `root: true` sits higher, so shared settings above the marked directories need a `root: true` beside them.
4. `categories` and `disable` lists add up across every file found.
5. `maxAgeDays` and each finding level take the value of the nearest file that sets it. A setting no file sets keeps its default.

The directory is the one that holds the Lore file for `categories` and `audit`, and the one that holds the changed file for `disable`. A `.loreconfig` with a problem is skipped in this lookup.

## Specification

- [.loreconfig](../../spec/loreconfig.md)
- [Lore root](../../spec/loreconfig.md#lore-root)
- [External folders](../../spec/external-folders.md)
- [`loreconfig.schema.json`](../../spec/schemas/loreconfig.md)
