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

- `--diff <file|->`: a unified diff, or `-` for stdin.

Output:

- `--format text|json`: default is text on a terminal, json otherwise.
- `--capabilities <list>`: the checks to run. Default: `regex,ast-grep`.
- `--strict`: exit 1 when errors in the rules excluded entries.

`--paths`, `--change`, `--base` and `--head` are not available yet.

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

- `0`: selection ran, or the verdicts have no problems.
- `1`: `--strict` was given and entries were excluded, or the verdicts have problems.
- `2`: usage or input error.
- `70`: internal error (a bug).

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
