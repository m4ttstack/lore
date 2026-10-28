# lore

The `lore` command reads Lore rule files and tells a reviewer which rules apply to a change. It never calls a forge, a model or the network. Git is the only program it runs, and only when an input needs it.

It has two commands.

## lore select

Collects the rules for a repo, selects the ones that apply to a diff, and prints the selection.

```
lore select [rules] --diff <file|-> [options]
```

Rules:

- `--repo <dir>`: the governed repo's working tree. Default: the git root above the current directory.
- `--no-repo`: take the governed repo to hold no Lore files. Needs `--remote`.
- `--remote <url>`: the governed repo's remote, used to match `repo`. Repeatable. Default: read from git.
- `--rules-ref <ref>`: read the repo's Lore files at this git ref instead of the working tree.
- `--given <dir>`: a given folder. Repeatable.

Change:

- `--diff <file|->`: a unified diff, or `-` for stdin. Its paths must carry the `a/` and `b/` prefixes; when `diff.mnemonicPrefix` or `diff.noprefix` is set, make one with `git diff --src-prefix=a/ --dst-prefix=b/`.

Output:

- `--format text|json`: default is text on a terminal, json otherwise.
- `--capabilities <list>`: the checks to run. Default: `regex,ast-grep`.
- `--strict`: exit 1 when errors in the rules excluded entries.

`--paths`, `--change`, `--base` and `--head` are not available yet.

ast-grep checks are skipped in this version: each one reports the warning `check-needs-file`, and its rule stays eligible.

The command reads only files git tracks (or a loose folder holds), through symlinks only to tracked files inside the same place. Two more warnings say what it could not read:

- `src-not-read`: a selected context's `src` target exists, but the command did not read it, so its `srcText` is null.
- `lore-file-not-read`: a tracked Lore or `.loreconfig` file could not be read (a symlink out of its place or to nothing, a directory, a sparse-checkout file), so its entries are missing.

## lore verdicts

Checks a verdict set against a selection.

```
lore verdicts --selection <file> [<verdicts-file> | -]
```

- `--selection <file>`: the JSON from `lore select`.
- `<verdicts-file>`: a verdict set, or `-` for stdin. Default: stdin.

## Other flags

- `--help`: print the usage.
- `--version`: print the version.

## Exit codes

- `lore select`: `0` when the selection ran, `1` when `--strict` was given and entries were excluded.
- `lore verdicts`: `0` when the verdicts have no problems, `1` when they have problems.
- Both: `2` for a usage or input error, `70` for an internal error (a bug).

## Build

```
bun install
bun run --filter @lore/cli build
```

This writes one file, `packages/cli/dist/lore.js`. Run it with Node 20 or later, or with Bun:

```
node packages/cli/dist/lore.js --help
bun packages/cli/dist/lore.js --help
```
