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

- `--diff <file|->`: a unified diff, or `-` for stdin. Its paths must carry the `a/` and `b/` prefixes; when `diff.mnemonicPrefix` or `diff.noprefix` is set, make one with `git diff --src-prefix=a/ --dst-prefix=b/`. The prefixes, including git's mnemonic ones, are detected from each `diff --git` header; a `--no-prefix` diff of a top-level `c/` or `o/` folder is ambiguous and is read as prefixed. A copy (`git diff -C`) is reported as an added file with only the lines its hunk shows, so a copy's unchanged lines are not added lines.

Output:

- `--format text|json`: default is text on a terminal, json otherwise. Text shows at most 20 flagged lines per rule (then `- and N more`), each cut to 200 code points with `...` appended; json keeps every hit in full.
- `--capabilities <list>`: the checks to run. Default: `regex,ast-grep`.
- `--strict`: exit 1 when errors in the rules excluded entries.

`--paths`, `--change`, `--base` and `--head` are not available yet.

ast-grep checks are skipped in this version: each one reports the warning `check-needs-file`, and its rule stays eligible.

The command reads only files git tracks in a working copy, or the files a loose folder holds. In a loose folder symlinks are never followed and are skipped silently. In a working copy a symlink is read only when it points to a tracked file inside the same place. It never fetches (with git 2.44 or later; older git ignores `GIT_NO_LAZY_FETCH`): with `--rules-ref` in a partial clone, a Lore file whose content is not local is an input error. Two more warnings say what it could not read:

- `src-not-read`: a selected context's `src` target exists, but the command did not read it, so its `srcText` is null.
- `lore-file-not-read`: a Lore or `.loreconfig` file the parser would have collected (tracked in a working copy, or held by a loose folder) could not be read (a symlink out of its place or to nothing, a directory), or a tracked Lore file lies outside a sparse-checkout cone, so any entries it holds are missing from the selection.

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
