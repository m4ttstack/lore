---
title: lore check
sidebar_position: 3
---

# lore check

Checks the rules against an author's change and prints the rules the change must follow.

## Usage

```text
lore check [<commit> | --base <ref>] [rules] [options]
```

`lore check` is the author's command. It builds the change from git, so no diff file is needed, and its text asks the author to fix what the change breaks rather than for verdicts. For a reviewer working from a diff, use [`lore select`](./select.md).

It needs git 2.25 or later.

## Change options

With no commit and no `--base`, `lore check` reads uncommitted work: staged changes, unstaged changes, and untracked files that git does not ignore, all against `HEAD`. In a repo with no commits yet, it compares with the empty tree.

```sh
lore check
```

### `<commit>` {#commit}

Reads one commit against its first parent.

- **Argument:** any commit git can resolve.
- **Default:** uncommitted work.

A root commit is read against the empty tree. Give a commit or `--base`, not both.

```sh
lore check HEAD
```

### `--base <ref>` {#base}

Reads the branch so far: the working tree, untracked files included, against the merge base of `<ref>` and `HEAD`.

- **Argument:** a git ref, such as `main` or `origin/main`.

It covers committed and uncommitted work together. `--base HEAD` is the same as plain `lore check`. A `<ref>` with no merge base with `HEAD` is an input error.

```sh
lore check --base origin/main
```

`--diff` is not accepted: `lore check` always builds the change itself.

## Rules options

These options are defined on [Shared options](./options.md#rules):

- [`--repo <dir>`](./options.md#repo)
- [`--no-repo`](./options.md#no-repo): with `--repo` as well, the repo supplies only the change.
- [`--remote <url>`](./options.md#remote)
- [`--rules-ref <ref>`](./options.md#rules-ref)
- [`--given <dir>`](./options.md#given)

The rules come from the working tree. Without a commit, untracked `.lore` and `.loreconfig` files are read too, so a rule file that has not been added yet already applies. A context `src` is read only when git tracks the file. With a commit, the rules are the tracked files, as in `lore select`.

## Output options

- [`--format text|json`](./options.md#format): text by default, on a terminal or not.
- [`--capabilities <list>`](./options.md#capabilities)
- [`--strict`](./options.md#strict)
- [`--also-in-scope`](./select.md#also-in-scope): see [Rules in scope, not triggered](./also-in-scope.md).
- [`--expand <id>`](./select.md#expand)

## Output

Text output is written for the author. It asks the author to fix any rule the change breaks, and it does not ask for verdicts. For an uncommitted edit that adds a `toFixed(` call under `src/checkout/`:

```text
# Lore rules for this change

These rules apply to your change. Fix any that your change breaks.

A flagged line is a place to look, not a verdict. A flagged line marked (removed) is one the change removed, named by the file's old path. Read the context below before changing code. Judge only by these rules; never invent rules from other prose.

## Rule `money-in-minor-units` (advisory, functional_correctness)

Amounts are integers in minor units (cents). Floating point never touches
money.

Flagged lines:

- `src/checkout/total.ts:2` `export const display = (q) => (q.total / 100).toFixed(2);`

## Rule `price-from-quote` (blocking, functional_correctness)

A displayed price must come from the quote that produced it.

Recomputing a price from its inputs drops quote-level discounts, so the
customer sees one total and is charged another.
```

The default stays text even when stdout is not a terminal, so an agent that runs `lore check` reads the author text. `--format json` prints the selection, with the same shape as `lore select` (see [Output formats](./output.md#selection)).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The check ran. |
| `1` | `--strict` was given and entries were excluded. |
| `2` | Usage or input error, such as no git working copy. |
| `70` | Internal error (a bug). |
