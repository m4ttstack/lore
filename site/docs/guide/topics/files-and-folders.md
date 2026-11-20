---
title: Files and folders
sidebar_position: 1
---

# Files and folders

Rules live in `.lore` files inside a folder named `.lore/`. A `.lore/` folder can sit in any directory of your repository, and you can have as many as you like.

The smallest useful Lore file holds one rule:

```html
<rule id="price-from-quote" category="functional_correctness">
  A displayed price must come from the quote that produced it.
</rule>
```

Saved as `.lore/checkout.lore`, this rule applies to a change anywhere in the repository.

## Putting rules beside their code

A `.lore/` folder's globs resolve from the directory that holds it, which Lore calls the **base**. That lets a set of rules live next to the code it governs:

```text
.lore/
  security.lore          rules for the whole repo
services/billing/
  .lore/
    invoices.lore        globs resolve from services/billing/
  src/
```

A `files: ["src/**"]` scope in `invoices.lore` covers `services/billing/src/**`, not the root `src/`. Moving the billing service moves its rules with it.

Subfolders inside a `.lore/` folder group files and change nothing, including the base. `apps/web/src/checkout/.lore/pricing/quotes.lore` still has the base `apps/web/src/checkout/`.

## What a Lore file holds

A Lore file is a sequence of tagged blocks. At the top level it can hold:

- at most one [`<scope>`](../../reference/format/scope.md) and one [`<defaults>`](../../reference/format/defaults.md), before the first entry;
- any number of [`<rule>`](../../reference/format/rule.md) and [`<context>`](../../reference/format/context.md) entries;
- `<!-- -->` comments and blank lines.

Top-level tags and comments start at column 0. Structured blocks, such as `<scope>` and `<when>`, hold YAML (JSON works too). Prose is Markdown. Indenting inside a block is optional: tools remove the indentation, so use whatever reads best.

How you split rules into files means nothing to a tool, except that a file's `<scope>` and `<defaults>` apply only to that file.

## Edge cases

### Files that are not collected

A tool collects only files tracked by git, so a `.lore/` folder in `node_modules/`, a build output or an ignored scratch folder adds no rules. `lore check` with no commit also reads Lore files you have not added yet, so a new rule applies before you commit it.

A `.lore` file outside any `.lore/` folder is not a Lore file. Neither is a file inside a `.lore/` folder whose name does not end in `.lore`, such as a `README.md` you keep there.

### Files with errors

A tool reports a problem in a file by name, such as `unknown-element`, and leaves out what the problem affects: one entry, or the whole file. The rest of your rules still apply. The full list is [Errors and warnings](../../spec/errors-and-warnings.md).

### Encoding

A Lore file is UTF-8. A byte order mark at the start is ignored, and so is a carriage return before a line feed.

## Next steps

- [Writing rules](./writing-rules.md): what goes inside a `<rule>`.
- [Scope](./scope.md): globs, the base and narrowing a scope per rule.
- [Shared rule repositories](./shared-rules.md): keeping rules in a repository of their own.
- [Files and folders](../../spec/files-and-folders.md) and [Collecting files](../../spec/collecting-files.md) in the specification.
