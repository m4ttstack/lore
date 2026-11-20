---
title: lore select
sidebar_position: 2
---

# lore select

Collects the rules for a repo, selects the ones that apply to a diff, and prints the selection for a reviewer.

## Usage

```text
lore select [rules] --diff <file|-> [options]
```

`lore select` is the reviewer's command: it takes a diff from anywhere, such as a pull request, and asks for a verdict on every selected rule. For an author's own uncommitted work or branch, use [`lore check`](./check.md), which builds the change from git.

## Rules options

The rules come from the governed repo and any given folders. These options are defined on [Shared options](./options.md#rules):

- [`--repo <dir>`](./options.md#repo)
- [`--no-repo`](./options.md#no-repo)
- [`--remote <url>`](./options.md#remote)
- [`--rules-ref <ref>`](./options.md#rules-ref)
- [`--given <dir>`](./options.md#given)

The command reads only files git tracks in a working copy, or the files a loose folder holds. In a working copy, a symlink is read only when it points to a tracked file inside the same place.

## Change options

### `--diff <file|->` {#diff}

The change to select rules for, as a unified diff.

- **Argument:** a file path, or `-` to read stdin.
- **Required:** yes.

The diff's paths must carry the `a/` and `b/` prefixes. When `diff.mnemonicPrefix` or `diff.noprefix` is set in git, make the diff with `git diff --src-prefix=a/ --dst-prefix=b/`. A `--no-prefix` diff of a top-level `c/` or `o/` folder is ambiguous and is read as prefixed. A copy (`git diff -C`) is read as an added file holding only the lines its hunk shows.

```sh
git diff main...HEAD > change.diff
lore select --diff change.diff
```

## Output options

- [`--format text|json`](./options.md#format): text on a terminal, JSON otherwise.
- [`--capabilities <list>`](./options.md#capabilities)
- [`--strict`](./options.md#strict)

### `--also-in-scope` {#also-in-scope}

Also lists the rules whose scope covers a changed file but whose conditions did not hold.

- **Argument:** none.

Requires lore 0.5.0 or later. See [Rules in scope, not triggered](./also-in-scope.md).

```sh
lore select --diff change.diff --also-in-scope
```

### `--expand <id>` {#expand}

Prints one of the rules `--also-in-scope` lists in full, as if it were selected. The expanded rule then needs a verdict.

- **Argument:** a rule id from the listing.
- **Repeatable:** yes.

It implies `--also-in-scope`. An id that is not in the listing is a usage error. Requires lore 0.5.0 or later.

```sh
lore select --diff change.diff --expand dates-from-locale
```

## Output

Text output asks the reviewer for a verdict on every rule, then prints each rule with its flagged lines. For a change that adds a `toFixed(` call under `src/checkout/`:

````text
# Lore rules for this change

Answer every rule below with a verdict: `pass`, `fail` or `not-applicable`.

- `pass`: the change keeps the rule.
- `fail`: the change breaks it. Give at least one location: a changed file and a line in it as the change leaves it, or, with `"side": "old"`, a file's old path and a line the change removed.
- `not-applicable`: the rule was selected but does not bear on this change. Say why in `note`.

A flagged line is a place to look, not a verdict. A flagged line marked (removed) is one the change removed, named by the file's old path. Read the context below before judging. Judge only by these rules; never invent rules from other prose.

Return the verdicts as one fenced code block tagged `lore-verdicts`:

```lore-verdicts
{ "lore": "1", "verdicts": [{ "rule": "<id>", "verdict": "fail", "evidence": [{ "file": "<path>", "line": 12 }], "note": "<why>" }] }
```

## Rule `money-in-minor-units` (advisory, functional_correctness)

Amounts are integers in minor units (cents). Floating point never touches
money.

Flagged lines:

- `src/checkout/total.ts:2` `export const display = (q) => (q.total / 100).toFixed(2);`

## Rule `price-from-quote` (blocking, functional_correctness)

A displayed price must come from the quote that produced it.

Recomputing a price from its inputs drops quote-level discounts, so the
customer sees one total and is charged another.
````

`money-in-minor-units` was selected because the added line contains `toFixed(`. `price-from-quote` has no `<when>`, so any change in its scope selects it.

JSON output is the selection. Save it to check verdicts later with [`lore verdicts`](./verdicts.md). Its shape is described on [Output formats](./output.md#selection).

Text shows at most 20 flagged lines per rule, then `- and N more`, and cuts each line to 200 code points with `...` appended. JSON keeps every hit in full.

Excluded entries go to stderr in text, one line each, and to `excluded` in JSON:

```text
lore: excluded unknown-category in .lore/checkout.lore line 24 (entry dates-from-locale)
```

The command also warns about what it could not read:

- `src-not-read`: a selected context's `src` target exists, but the command did not read it, so its `srcText` is null.
- `lore-file-not-read`: a Lore or `.loreconfig` file could not be read (a symlink out of its place or to nothing, a directory, or a tracked file outside a sparse-checkout cone), so any entries it holds are missing.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The selection ran. |
| `1` | `--strict` was given and entries were excluded. |
| `2` | Usage or input error. |
| `70` | Internal error (a bug). |

See [Exit codes](./exit-codes.md) for every command.
