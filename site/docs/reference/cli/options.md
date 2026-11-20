---
title: Shared options
sidebar_position: 7
---

# Shared options

These options mean the same thing on every command that takes them. Each command page lists which ones it accepts and links here.

## Rules {#rules}

The rules options say where the Lore files come from. `lore select`, `lore check` and `lore audit` take all five. `lore review` takes `--repo` and `--given` only, because it writes the working tree.

### `--repo <dir>` {#repo}

The governed repo's working tree: the repo the change is in and whose rules apply.

- **Argument:** a directory inside a git working copy.
- **Default:** the git root above the current directory.

The command finds the working copy's root from the directory given, so any folder inside the repo works.

```sh
lore check --repo ../shop
```

### `--no-repo` {#no-repo}

Takes the governed repo to hold no Lore files. Rules come only from given folders.

- **Argument:** none.

It needs `--remote`, since there is no repo to read the remote from. It cannot be combined with `--rules-ref`. For `lore select` and `lore audit` it cannot be combined with `--repo` either. For `lore check`, `--repo` with `--no-repo` means the repo supplies only the change.

```sh
lore audit --no-repo --remote github.com/acme/shop --given ../checkout-rules
```

### `--remote <url>` {#remote}

The governed repo's remote URL, used to match the `repo` key of a `.loreconfig` in a given folder.

- **Argument:** a remote URL, such as `github.com/acme/shop`.
- **Repeatable:** yes.
- **Default:** every fetch URL `git remote -v` lists for the governed repo.

```sh
lore select --diff change.diff --remote github.com/acme/shop --given ../team-rules
```

### `--rules-ref <ref>` {#rules-ref}

Reads the governed repo's Lore files at this git ref instead of the working tree.

- **Argument:** any git ref or commit.
- **Default:** the working tree.

`lore audit` also reads lock files and cited files at the ref. The command never fetches: in a partial clone, a Lore file whose content is not local is an input error (with git 2.44 or later; older git ignores `GIT_NO_LAZY_FETCH`).

```sh
lore check --base main --rules-ref main
```

### `--given <dir>` {#given}

A given folder: a folder of Lore files kept outside the governed repo, such as a shared rules repository.

- **Argument:** a directory.
- **Repeatable:** yes.

A folder inside another git working copy is an external folder, and only its tracked files are read. A folder in no working copy is a loose folder, and every file it holds is read, without following symlinks. See [Shared rule repositories](../../guide/topics/shared-rules.md).

```sh
lore check --given ../team-rules/lore
```

## Output {#output}

### `--format text|json` {#format}

The output format.

- **Argument:** `text` or `json`.
- **Default:** `text` for `lore check` and `lore audit`. For `lore select`, `text` on a terminal and `json` otherwise.

Text output is written for a person or an agent to read. JSON is the selection (or the audit result) in full. See [Output formats](./output.md).

```sh
lore select --diff change.diff --format json > selection.json
```

### `--capabilities <list>` {#capabilities}

The checks to run, as a comma-separated list. `lore select` and `lore check` only.

- **Argument:** `regex`, `ast-grep`, or both, separated by commas.
- **Default:** `regex,ast-grep`.

A `<check>` in a language left out of the list is skipped with the warning `unsupported-check-language`, and its rule stays eligible. In this version ast-grep checks are skipped either way. Each one reports the warning `check-needs-file`, or `unsupported-check-language` when `ast-grep` 0.51.0 is not on the `PATH`.

```sh
lore check --capabilities regex
```

### `--strict` {#strict}

Exits 1 when errors in the rules excluded entries.

- **Argument:** none.

Without it, an excluded entry is reported on stderr and does not change the exit code on its own; `lore audit` still exits 1 for a finding at level `error`. Warnings never change the exit code, with or without `--strict`.

```sh
lore check --base main --strict
```

### `--help` {#help}

Prints the usage and exits 0. It works on its own (`lore --help`) or after any command.

### `--version` {#version}

Prints the version and exits 0. It works only on its own: `lore --version`.
