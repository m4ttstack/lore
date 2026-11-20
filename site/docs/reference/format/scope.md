---
title: <scope>
sidebar_position: 3
---

# `<scope>`

A `<scope>` says which files an entry can be broken in. At the top of a file it applies to every entry in the file; inside an entry it narrows the file's scope for that entry.

```html
<scope>
  files: ["src/components/**/*.tsx"]
  ignores: ["**/*.stories.tsx"]
</scope>
```

The block is YAML (or JSON). It takes no attributes, and a file or an entry has at most one.

## Keys

| Key | Required | Type | Description |
|---|---|---|---|
| [`files`](#files) | no | list of globs | The paths in scope. |
| [`ignores`](#ignores) | no | list of globs | Paths left out, even when `files` matches them. |

A path is in a scope when it matches at least one `files` glob and no `ignores` glob.

### `files`

- **Type:** a non-empty list of globs.
- **Required:** no.
- **Default:** `["**"]`, every path under the base.

An empty list is `empty-files`.

```yaml
files: ["src/checkout/**/*.{ts,tsx}"]
```

### `ignores`

- **Type:** a list of globs.
- **Required:** no.
- **Default:** `[]`.

```yaml
ignores: ["**/*.test.ts", "**/__generated__/**"]
```

## Base

Globs resolve against the Lore file's **base**: the directory that holds its `.lore/` folder. A rule in `services/billing/.lore/invoices.lore` with `files: ["src/**"]` covers `services/billing/src/**`. A glob that starts with `/` is `leading-slash`, and a `..` segment is `glob-escapes-base`, so a scope never reaches outside its base.

## Narrowing

An entry's own `<scope>` is intersected with its file's: a path must be in both. An entry can narrow its file's scope, never widen it:

```html
<scope>
  files: ["src/**/*.ts"]
</scope>

<rule id="money-helpers-pure" category="functional_correctness">
  <scope>
    files: ["src/money/**"]
  </scope>
  Money helpers have no side effects.
</rule>
```

This rule covers `src/money/**/*.ts` only: the file's scope and its own both have to match.

## Glob syntax

| Syntax | Matches |
|---|---|
| `**`, as a whole segment | zero or more whole segments |
| `*` | any run of characters within a segment |
| `?` | any one character |
| `[abc]`, `[a-z]` | one character in the set |
| `[!abc]`, `[!a-z]` | one character not in the set |
| `{a,b}` | any one of the alternatives |

Matching is case-sensitive, and `*` matches dotfiles. There is no escape character and no negation: put a special character in a set to match it (`[[]id].tsx` matches `[id].tsx`), and use `ignores` to leave paths out.

## Specification

- [Scope and globs](../../spec/scope-and-globs.md)
- [Glob syntax](../../spec/scope-and-globs.md#glob-syntax)
- [Files and folders](../../spec/files-and-folders.md), for the base
- [`scope.schema.json`](../../spec/schemas/scope.md)
