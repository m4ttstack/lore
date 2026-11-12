# lore

The `lore` command reads Lore rule files and tells a reviewer or an author which rules apply to a change. It never calls a forge, a model or the network. Git is the only program it runs, and only when an input needs it.

It has four commands.

Install it as a dev dependency, or run it without installing:

```
npm install --save-dev @mattstack/lore
npx @mattstack/lore check
```

It needs Node 20 or later, and `lore check` needs git 2.25 or later.

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

- `--format text|json`: default is text on a terminal, json otherwise. Text shows at most 20 flagged lines per rule (then `- and N more`), each cut to 200 code points with `...` appended; json keeps every hit in full. An old-side hit is marked `(removed)` in text and carries `"side": "old"` in json. A line a `droppedContains` or `droppedMatches` condition finds is such a hit.
- `--capabilities <list>`: the checks to run. Default: `regex,ast-grep`.
- `--strict`: exit 1 when errors in the rules excluded entries.
- `--also-in-scope`: also list the rules whose scope covers a changed file but whose conditions did not hold. See [Rules in scope, not triggered](#rules-in-scope-not-triggered).
- `--expand <id>`: print one of those rules in full. Repeatable. Implies `--also-in-scope`.

The two options need lore 0.5.0 or later.

`--paths`, `--change`, `--base` and `--head` are not available yet.

ast-grep checks are skipped in this version: each one reports the warning `check-needs-file`, and its rule stays eligible.

The command reads only files git tracks in a working copy, or the files a loose folder holds. In a loose folder symlinks are never followed and are skipped silently. A folder meant to be loose, such as rules installed with a tool, puts `loose: true` in its top `.loreconfig`, and the `untracked-given-folder` warning is not reported for it. The key needs lore 0.2.0 or later: older tools report that `.loreconfig` as `invalid-loreconfig` and ignore it whole, including a `repo:` beside it. In a working copy a symlink is read only when it points to a tracked file inside the same place. It never fetches (with git 2.44 or later; older git ignores `GIT_NO_LAZY_FETCH`): with `--rules-ref` in a partial clone, a Lore file whose content is not local is an input error. Two more warnings say what it could not read:

- `src-not-read`: a selected context's `src` target exists, but the command did not read it, so its `srcText` is null.
- `lore-file-not-read`: a Lore or `.loreconfig` file the parser would have collected (tracked in a working copy, or held by a loose folder) could not be read (a symlink out of its place or to nothing, a directory), or a tracked Lore file lies outside a sparse-checkout cone, so any entries it holds are missing from the selection.

## lore check

Checks the rules against an author's change (work not yet committed, one commit, or the branch so far) and prints the rules the change must follow.

```
lore check [<commit> | --base <ref>] [rules] [options]
```

The change comes from git, so no diff file is needed:

- `lore check` reads uncommitted work: staged changes, unstaged changes, and untracked files that git does not ignore, all against `HEAD`, or against the empty tree when the repo has no commits yet.
- `lore check <commit>` reads one commit against its first parent. A root commit is read against the empty tree.
- `lore check --base <ref>` reads the branch so far: the working tree, untracked files included, against the merge base of `<ref>` and `HEAD`. It covers committed and uncommitted work together. `--base HEAD` is the same as plain `lore check`. A `<ref>` with no merge base with `HEAD` is an input error.

The rules come from the working tree. Without a commit, untracked `.lore` and `.loreconfig` files are read too, so a rule file that has not been added yet already applies. A context `src` stays readable only when git tracks the file. With a commit, the rules are the tracked files, as in `lore select`.

Text output is written for the author, not for a reviewer. It asks the author to fix any rule the change breaks, and says that flagged lines are places to look, not verdicts. It does not ask for a verdict set. JSON output has the same shape as `lore select`.

The default format is text, on a terminal or not, so an agent that runs `lore check` reads the author text; `--format json` prints the selection.

These options work as they do in `lore select`: `[rules]` (`--repo`, `--no-repo`, `--remote`, `--rules-ref`, `--given`), `--capabilities`, `--strict`, `--also-in-scope`, `--expand <id>` and `--format text|json`. With `--no-repo` and `--repo` together, the repo supplies only the change. `--diff` is not accepted.

## Rules in scope, not triggered

A rule whose scope covers a changed file is selected only when its `<when>` holds. With `--also-in-scope`, `lore select` and `lore check` also list the rules whose scope covers a changed file but whose `<when>` did not hold. A context, a rule with no `<when>`, a disabled rule, and a rule excluded by an error are never listed. Without the option, the output is the same as before.

In JSON the selection gains a last key, `alsoInScope`, which is not capped:

```json
"alsoInScope": [
  { "id": "no-eur", "file": ".lore/b.lore", "category": "code_style", "severity": "advisory",
    "summary": "Do not hardcode EUR.", "paths": ["src/p.ts"] }
]
```

`paths` holds the changed paths the rule's scope covers, sorted. Entries are sorted blocking before advisory, then by more covered paths first, then by id.

In text a section `## Also in scope, not triggered` follows the rules and contexts and comes before the warnings. It opens with a short paragraph, then has one line per rule in the same order, with the summary cut to 160 code points:

```
- `no-eur` (advisory, code_style): Do not hardcode EUR.
```

It shows at most 40 rules, then `` - and N more; `--format json` lists them all ``. When nothing is selected, the output says so and then prints the section; for `lore select` the verdict format follows it. When the listing is empty, the text output is the same as without the option; JSON carries an empty `alsoInScope`.

`--expand <id>` moves a listed rule into `rules`. It is printed in full like a selected rule, with no flagged lines, marked `"expanded": true` in JSON and `expanded` in its text heading, and it needs a verdict. An id that is not in the listing (already selected, disabled, unknown or out of scope) is a usage error, exit 2.

A listed rule needs no verdict. `lore verdicts` accepts one for it and checks it like any other verdict. A selection saved without `alsoInScope` works as before.

### Cost, and when to turn it on

`packages/cli/test/listing-cost.test.ts` measures a set of 200 rules, each with a summary of about 80 characters, on a change that puts all 200 in scope and triggers 10. The text section is 45 lines and 5,379 bytes, because the cap holds it at 40 rules. The `alsoInScope` key adds 58,543 bytes to the JSON, because it lists all 190. The change is one file; each entry's `paths` grows with the changed files the rule covers, so the JSON cost grows with rules times covered files.

Turn the option on where a missed rule costs more than a few dozen extra lines of reading, and for rule sets whose triggers are literal strings. Leave it off for small sets with no triggers, where it prints nothing.

## lore verdicts

Checks a verdict set against a selection.

```
lore verdicts --selection <file> [<verdicts-file> | -]
```

- `--selection <file>`: the JSON from `lore select`.
- `<verdicts-file>`: a verdict set, or `-` for stdin. Default: stdin.

## lore audit

Checks that each rule's `<source>` still points at text that exists, and that the text has not changed since someone last reviewed the rule against it.

```
lore audit [rules] [options]
```

It reads every rule collected for the governed repo and the given folders, disabled rules included, with no change involved. For each source it reads the cited file, finds the heading or phrase, and compares the fingerprint of that text with the rule's record in `lore-reviews.lock`. Only `lore review` writes that file; `lore audit` never changes a file.

- Cited files, Lore files and lock files are read as `lore select` reads its rules: tracked files only, from the working tree. An untracked or ignored cited file is `source-missing`. A tracked file the command cannot read safely (a symlink out of its place, a file outside a sparse-checkout cone) is `source-unchecked`.
- A lock file is read only once git tracks it, so `git add` the file `lore review` writes before auditing.
- A Lore or `.loreconfig` file the command could not read is warned `lore-file-not-read`, as in `lore select`, and the records in the lock file of its Lore root are not reported as `orphan-review`, since the rules they belong to may only be unread.
- With `--rules-ref <ref>`, the rules, the lock files and the cited files are all read at that revision.
- A file that is not valid UTF-8 is fingerprinted as its bytes; a `heading` or `phrase` in it is never found.

### Findings

| Finding | Meaning | Default level |
|---|---|---|
| `source-missing` | The file is not a tracked file, or the heading or phrase is not found. | error |
| `source-unchecked` | The files this source needs were not available to look at. | error |
| `ambiguous-heading` | More than one heading matched; the first is used. | warn |
| `source-changed` | The fingerprint differs from the record. | warn |
| `never-reviewed` | A source has no record. | warn |
| `review-overdue` | The record is older than the age limit. Not reported when no limit is set. | warn |
| `orphan-review` | The lock file has a record for a rule or source that no longer exists. | warn |
| `meta-source` | A rule has a `source` key in `<meta>` and no `<source>` block. | off |

A level is `error`, `warn` or `off`. A finding at `off` is not reported.

A source with only `file` is flagged by any edit to that file, and every rule citing that file comes due together. Give a `heading` or a `phrase` wherever the file has one.

### Settings

Levels and the age limit can be set in a `.loreconfig`:

```yaml
audit:
  maxAgeDays: 180
  levels:
    source-changed: error
    never-reviewed: off
```

Each setting is looked up on its own, from the nearest `.loreconfig` that sets it on the way up from the rule's Lore file to its Lore root. An `orphan-review` takes the settings of the `.loreconfig` in the Lore root's directory.

### Options

- `[rules]`: `--repo`, `--no-repo`, `--remote`, `--rules-ref` and `--given`, as in `lore select`.
- `--max-age <days>`: report `review-overdue` for a record older than this many days. A whole number above 0. Overrides `maxAgeDays` in every `.loreconfig` for this run.
- `--level <finding>=<level>`: set one finding's level for this run, overriding the `.loreconfig` files. Repeatable, once per finding.
- `--strict`: exit 1 when errors in the rules excluded entries.
- `--format text|json`: default text.

`--diff`, `--capabilities`, `--also-in-scope`, `--expand` and positional arguments are usage errors.

### Sources it cannot check

With `--no-repo` the governed repo is not there to read, so a source that resolves into it is `source-unchecked`, an error by default. That covers a plain path in any given folder and a leading `/` in an external folder, which name files of the governed repo. A file-relative source (`./` or `../`) in a given folder resolves inside that folder, and a leading `/` in a loose folder resolves from the loose folder, so those are always checked. To audit a rules folder without the repo it governs:

```
lore audit --no-repo --remote github.com/acme/shop --given ../checkout-rules --level source-unchecked=off
```

### Output

Text output groups the findings under each Lore file (or under the lock file, for `orphan-review`), one line each: level, finding, rule id, the source and a reason when there is one. The source is the file, then `#` and the heading, then the phrase in double quotes. A count per finding follows, then the number of rules with and without a source:

```
.lore/checkout.lore
  error  source-missing  money-in-minor-units  docs/checkout-review.md#Money is integer minor units  heading not found: "Money is integer minor units"
  warn  never-reviewed  dates-from-locale  docs/checkout-review.md#Dates

source-missing: 1
never-reviewed: 1
rules with a source: 2, without: 1
```

JSON output is `{ "findings": [...], "summary": {...}, "excluded": [...], "warnings": [...] }`. `findings` and `summary` follow `spec/schemas/audit.schema.json`; `excluded` and `warnings` list the excluded entries and the warnings `lore select` would give for the same rules. In text, both go to stderr, one line each (`lore: excluded ...`, `lore: warning ...`). An excluded entry is not audited. Warnings never change the exit code, `--strict` included, as in `lore select`.

A lock file that is not in the format (a bad header, a line that is not a record, two records for one source) is an input error, exit 2, naming the file and the line. It is never repaired.

### Moving `source:` out of `<meta>`

A `source` key in `<meta>` stays free-form and is never an error. To list the rules that still carry one and have no `<source>` block, turn its finding on:

```
lore audit --level meta-source=warn
```

Move each one to a `<source>` block by hand or with your own script; there is no migration command.

### Upgrade the tool first

A tool older than this change reads a `<source>` block as `unknown-child` and excludes that rule, and reads the `audit` key as `invalid-loreconfig` and ignores the whole `.loreconfig`, including any `repo:` or `disable:` in it. Upgrade every tool that reads the rules (the `lore` command in CI and on each machine, and the editor extensions) before any rule file uses `<source>` or any `.loreconfig` uses `audit`.

## Other flags

- `--help`: print the usage.
- `--version`: print the version.

## Exit codes

- `lore select`: `0` when the selection ran, `1` when `--strict` was given and entries were excluded.
- `lore check`: `0` when the check ran, `1` when `--strict` was given and entries were excluded.
- `lore verdicts`: `0` when the verdicts have no problems, `1` when they have problems.
- `lore audit`: `0` when no finding is at level `error`, `1` when a finding is at level `error`, or when `--strict` was given and entries were excluded.
- All: `2` for a usage or input error, `70` for an internal error (a bug).

## Build

```
bun install
bun run --filter @mattstack/lore build
```

This writes one file, `packages/cli/dist/lore.js`. Run it with Node 20 or later, or with Bun:

```
node packages/cli/dist/lore.js --help
bun packages/cli/dist/lore.js --help
```
