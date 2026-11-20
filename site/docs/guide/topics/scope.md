---
title: Scope
sidebar_position: 3
---

# Scope

A scope says which files a rule can be broken in. A rule is selected only when a changed file is in its scope.

```html
<scope>
  files: ["src/checkout/**"]
</scope>
```

At the top of a file, this scope applies to every entry in the file.

## A complete example

`files` lists the paths in scope and `ignores` leaves some out. An entry can narrow its file's scope with a `<scope>` of its own:

```html
<scope>
  files: ["src/components/**/*.tsx"]
  ignores: ["**/*.stories.tsx", "**/*.test.tsx"]
</scope>

<rule id="icon-buttons-have-labels" category="accessibility">
  Every `IconButton` has an `aria-label` that names the action, not the
  icon: "Delete invoice", not "Trash".
</rule>

<rule id="forms-use-field" category="accessibility">
  <scope>
    files: ["src/components/forms/**"]
  </scope>
  Form inputs are wrapped in `Field`, which links the label and the error
  message to the input.
</rule>
```

`icon-buttons-have-labels` covers every component except stories and tests. `forms-use-field` covers only the form components, since a path must be in both scopes.

## Globs

Globs match one path segment at a time. `**` matches any number of whole segments, `*` matches within one segment, and `{ts,tsx}` matches either alternative. The full syntax is on the [`<scope>` reference](../../reference/format/scope.md#glob-syntax).

Globs resolve from the Lore file's base, the directory that holds its `.lore/` folder. So `src/**` in `services/billing/.lore/invoices.lore` means `services/billing/src/**`. See [Files and folders](./files-and-folders.md).

## Edge cases

### No scope

A file with no `<scope>` covers every path under its base. At the repository root, that is every file.

### A scope never widens

An entry's `<scope>` is intersected with its file's. It can narrow the file's scope but never reach a path the file's scope leaves out. To cover a different set of files, put the rule in another file.

### No leading slash, no `..`

A scope glob that starts with `/` is an error (`leading-slash`), and so is one with a `..` segment (`glob-escapes-base`). A scope never reaches outside its base. The [`changed` and `unchanged`](./conditions.md#other-files-changed-or-not) conditions do take a leading `/`, because they look at the whole change.

### Renamed and deleted files

A renamed file is in scope when its old path or its new path is. A deleted file is in scope by its old path.

### Escaping special characters

There is no escape character. To match a literal `[` or `{`, put it in a set: `[[]id].tsx` matches `[id].tsx`.

## Next steps

- [Conditions](./conditions.md): narrow selection further by what the change does.
- [`<scope>` reference](../../reference/format/scope.md): keys, defaults and the full glob syntax.
- [Scope and globs](../../spec/scope-and-globs.md) in the specification.
