# `lore check`: design

A short design for a small change to the reference CLI.

## Intent

An agent writing code should be able to check its work against Lore rules
before a reviewer sees it, from one short command that an `AGENTS.md` line
can name. Today that takes a git pipeline (`git add -N . && git diff
$(git merge-base origin/main HEAD) | lore select --diff -`), and the obvious
shorter forms silently miss uncommitted edits or new files.

## Goals

- `lore check` checks uncommitted work.
- `lore check <commit>` checks one commit.
- The output tells the author which rules apply and where to look, so they
  can fix what breaks a rule.

## Non-goals

- Ranges or whole branches (`main..`, merge-base comparisons).
- Checking verdicts. `lore verdicts` stays the review-side check.
- Hooks or editor integration.
- Spec changes. The spec defines selection, not how a tool obtains a change.

## Anti-goals

- A command that reports nothing while uncommitted work, new files included,
  exists.
- Output that asks the author for verdicts, so an agent answers in prose
  instead of fixing code.
- A second notion of what a diff contains that can disagree with `select`.

## Behavior

**`lore check`** compares the working tree with `HEAD`: staged and unstaged
changes to tracked files, plus untracked files that git does not ignore.

**`lore check <commit>`** compares the commit with its first parent. A
root commit compares with the empty tree. `<commit>` is any revision git
resolves to a commit.

**Rules** are read from the working tree, as `select` does by default. In
`lore check` (no commit), untracked `.lore` and `.loreconfig` files that git
does not ignore are read too, so a rule the author just wrote applies at
once. *(My call: an author checking earlier work wants the rules as they
stand now. Review is different, and keeps reading rules at the target
branch.)*

**Options** carried over from `select`: `[rules]` folders, `--repo`,
`--no-repo`, `--remote`, `--rules-ref`, `--given`, `--capabilities`,
`--strict`, `--format text|json`. Not carried over: `--diff`.

**Output.** Text is the default on a terminal and JSON otherwise, as for
`select`.

- Text uses a new author preamble in place of the verdict request: the rules
  below apply to the change, fix any the change breaks, a flagged line is a
  place to look and not a verdict, and judge only by these rules. Rule,
  flagged-line and context sections are the same as `select`'s, with the
  same caps. With nothing selected it prints the same "No Lore rules apply
  to this change."
- JSON is the same selection shape `select` prints. *(My call.)*

**Exit codes.** 0 when the check ran. 1 when `--strict` was given and
entries were excluded. 2 for usage or input errors and 70 for internal errors, as
today. A flagged line never changes the exit code.

## Approaches

1. **One git diff, the existing parser (chosen).** Run
   `git diff --src-prefix=a/ --dst-prefix=b/` against `HEAD` (or
   `<commit>^!`), add `git diff --no-index` from `/dev/null` for each
   untracked file, and feed the combined text to `parseUnifiedDiff`. All of
   `diff.ts`'s handling of renames, copies, deletions and prefixes applies
   unchanged, so `check` and `select` cannot disagree about a diff.
2. **Construct the change directly** in TypeScript. More control, but a
   second path that must agree with `diff.ts` on every edge case.
3. **Flags on `select`** with `check` as an alias. The smallest surface,
   but reviewer wording stays the default and the command gets longer.

## Decided by Matt

- Two modes: uncommitted work, and one commit.
- Author-worded output that lists rules and flagged lines, exit 0, no
  verdict request.
- Approach 1.
- The behavior above, including the calls marked as mine.

## Left to the builder

- Running git with config that can change diff output pinned off
  (`diff.noprefix`, `diff.mnemonicPrefix`, external diff and textconv
  drivers, color), and with `GIT_NO_LAZY_FETCH=1` as elsewhere.
- `--no-index` exits 1 when the files differ; treat 0 and 1 as success.
- Untracked binary files, symlinks and files whose names need quoting.
- Where untracked Lore files join the collection in `input.ts`, which reads
  tracked paths only today.
- Tests in `packages/cli/test/` for both modes, untracked files, untracked
  Lore files, a root commit, a merge commit, and a clean tree.
- `packages/cli/README.md`: a `lore check` section. Root `README.md`: the
  `AGENTS.md` snippet in the Try it section:

  ```markdown
  After editing files, run `lore check` and fix any rule your change breaks.
  ```

## Publishing to npm

Added after the design above was approved: the CLI ships to npm with
`lore check`, so a repo can run it without downloading a release asset.

- **Name:** `@mattstack/lore` (Matt's choice; `lore`, `lore-cli` and
  `@lore/cli` are taken). The binary stays `lore`.
- **Version:** `0.2.0`, the first npm release. The `cli-v0.2.0` tag still
  makes the GitHub release, as today.
- **Package:** public, with only the bundle, its README and a license in
  the tarball. The parser is bundled, so the package has no runtime
  dependencies.
- **How:** Matt publishes by hand with `/matt:npm-publish` (OTP from
  Bitwarden) from the tagged commit on `main`. CI does not publish.
- **Docs:** the root README's Try it section uses `npx @mattstack/lore`, and
  its roadmap stops saying packages wait for a final name, for the CLI.
  The `AGENTS.md` snippet can then name a command every reader has.
- Every outward step (push, tag, publish) waits for Matt's go-ahead.

## Added for 0.2.0: `--base` and `loose`

Added after the plan's first five tasks were built, at the request of a
work pipeline that commits as it goes, so neither mode above sees a
whole branch. Both ship in 0.2.0, before the tag (Matt's decision).

### `lore check --base <ref>`

The non-goal "ranges or whole branches" is narrowed: one range is now in
scope, the branch so far.

- **`lore check --base <ref>`** compares the working tree with the merge
  base of `<ref>` and `HEAD`: everything the branch committed since it
  left `<ref>`, plus staged, unstaged and untracked files git does not
  ignore. Rules are read as in `lore check` with no commit, untracked
  Lore files included.
- `<ref>` is any revision git resolves to a commit. A value starting
  with `-` or one git cannot resolve is `not a commit: <ref>`, as for
  `<commit>`.
- No merge base (unrelated histories, or a repo with no commits yet) is
  an input error: `no merge base between <ref> and HEAD`. *(My call.)*
- `<commit>` and `--base` together are a usage error:
  `give a commit or --base, not both`. *(My call.)*
- Output, options and exit codes are the same as `lore check`.
- Built on approach 1: the tracked part diffs the merge base against the
  working tree, and the untracked part is the same as for `lore check`.

Still out of scope: arbitrary `<a>..<b>` ranges.

### `loose: true` in `.loreconfig`

A loose folder (a given folder in no working copy) always reports
`untracked-given-folder`, so a stray copy of a Lore folder in it cannot
add rules unseen. A team that ships its rules as an installed folder,
such as a plugin, gets that warning on every run even though the
folder is meant to be loose.

- New optional `.loreconfig` key **`loose`**, value `true` or `false`,
  default `false`.
- In the `.loreconfig` at the root of a loose folder (`loose:.loreconfig`),
  `loose: true` says the folder is meant to be loose, and the tool does
  not report `untracked-given-folder` for it.
- Anywhere else (the governed repo, a given folder in a working copy, a
  directory below a loose folder's root) the key is allowed and has no
  effect. *(My call: an error there would break a folder that is
  sometimes checked out and sometimes installed.)*
- Any other value is `invalid-loreconfig`, like every key. A
  `.loreconfig` with a problem is ignored as a whole, so the warning is
  then reported.
- This is a spec change: the `.loreconfig` key table, External folders,
  the warning's row in Errors and warnings, `errors.json`,
  `loreconfig.schema.json`, and conformance examples for the silenced
  warning, the key with no effect below the root, and an invalid value.
  The parser implements it, so the CLI gets it with no CLI change.
