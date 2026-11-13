# lore

The `lore` command reads Lore rule files and tells a reviewer or an author which rules apply to a change. It never calls a forge, a model or the network. Git is the only program it runs, and only when an input needs it.

It has five commands.

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

In text a section `## Also in scope, not triggered` follows the rules and contexts and comes before the warnings. It opens with a short paragraph, then has one line per rule in the same order, with the rule's whole first paragraph as the summary, cut only past 600 code points:

```
- `no-eur` (advisory, code_style): Do not hardcode EUR.
```

It lists every blocking rule, then advisory rules until the section holds 40 rule lines; a last line, `` - and N more; `--format json` lists them all ``, counts any left out. When nothing is selected, the output says so and then prints the section; for `lore select` the verdict format follows it. When the listing is empty, the text output is the same as without the option; JSON carries an empty `alsoInScope`.

`--expand <id>` moves a listed rule into `rules`. It is printed in full like a selected rule, with no flagged lines, marked `"expanded": true` in JSON and `expanded` in its text heading, and it needs a verdict. An id that is not in the listing (already selected, disabled, unknown or out of scope) is a usage error, exit 2.

A listed rule needs no verdict. `lore verdicts` accepts one for it and checks it like any other verdict. A selection saved without `alsoInScope` works as before.

### Cost, and when to turn it on

`packages/cli/test/listing-cost.test.ts` measures a set of 200 rules, each with a summary of about 80 characters, on a change that puts all 200 in scope and triggers 10. The text section is 45 lines and 5,379 bytes, because the cap holds it at 40 rules. The `alsoInScope` key adds 58,543 bytes to the JSON, because it lists all 190. The change is one file; each entry's `paths` grows with the changed files the rule covers, so the JSON cost grows with rules times covered files.

The cap bounds advisory lines only: every blocking rule prints, and a line can reach 600 code points.

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

It reads every rule collected for the governed repo and the given folders, disabled rules included, with no change involved. For each source it reads the cited file, finds the heading or phrase, and compares the fingerprint of that text with the rule's record in its lock file, `lore-reviews.lock` (see [Where lock files live](#where-lock-files-live)). Only `lore review` writes that file; `lore audit` never changes a file.

- Cited files, Lore files and lock files are read as `lore select` reads its rules: tracked files only, from the working tree. An untracked or ignored cited file is `source-missing`. A tracked file the command cannot read safely (a symlink out of its place, a file outside a sparse-checkout cone) is `source-unchecked`. In a loose folder a cited file may be in a hidden directory, such as `.github/`, though not below `.git/`, while Lore files there are still not read.
- A lock file is read only once git tracks it, so `git add` the file `lore review` writes before auditing.
- An untracked Lore or `.loreconfig` file in the governed working tree is not audited, even when `lore review` recorded its rules, and the lock file that would cover it gets no `orphan-review` until git tracks the file.
- A Lore or `.loreconfig` file the command could not read is warned `lore-file-not-read`, as in `lore select`, and the records in the lock file that would cover it are not reported as `orphan-review`, since the rules they belong to may only be unread (see [When a record is an orphan](#when-a-record-is-an-orphan)).
- With `--rules-ref <ref>`, the rules, the lock files and the cited files are all read at that revision. A symlink there among the lock files and cited files is followed as in the working tree: only to a regular file that revision tracks inside the repository.
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

### Where lock files live

A rule's records are in `lore-reviews.lock` in the nearest directory, at or above the directory that holds the Lore file and no higher than the root of its repository (for a loose folder, the loose folder's top), whose `.loreconfig` has `root: true` or a `repo:` key, or else in that root. A directory marked with `repo:` starts a new lock file just as `root: true` does; categories, `disable` and the audit settings still follow the Lore root. In a shared rules repository that serves the shop and the blog:

```
team-repo/lore/
  .loreconfig          root: true
  lore-reviews.lock    the team repository's own rules, as in own/
  own/.lore/team.lore
  shop/
    .loreconfig        repo: github.com/acme/shop
    lore-reviews.lock  the shop's rules below shop/
  web/
    .loreconfig        repo: github.com/acme/shop
    lore-reviews.lock  the shop's rules below web/
  blog/
    .loreconfig        repo: github.com/acme/blog
    lore-reviews.lock  the blog's rules
```

A run from the shop (`--given team-repo/lore`, or `--given team-repo/lore/shop`) reads and writes only the shop's lock files; a run from the blog only the blog's; and the team repository's own run, where every marked directory is `repo-inside-repo`, only `lore/lore-reviews.lock`. The shop and the blog can each have a rule with the same id: their records never meet.

A rule moved to a folder with another lock file, such as from `web/` to `shop/`, or below a new `root: true`, leaves its record behind. It is `never-reviewed` in its new place, and its old record is an `orphan-review` of the old lock file. Review it again, then `lore review --prune` from the same side removes the old record. A directory that gains a `repo:` key moves every rule below it the same way: its rules leave the enclosing lock file's scope, so their old records there become orphans that `--prune` removes. Check `lore audit` output before pruning after such a change. A `repo:` key below another marked directory is `nested-repo` instead, which no layout uses, so while it stands the lock file above it is not judged. A lock file that no longer covers any collected Lore file is not read at all, so delete it by hand. A rule moved within one lock file's folders keeps its records.

### When a record is an orphan

Every Lore file a lock file covers is collected by the same runs, so a run that reads a lock file normally collects all of its rules, and a record no collected rule has is `orphan-review`. A run does not judge a lock file when something it covers may hide a rule:

- an excluded Lore file, or an entry with no readable id;
- a Lore or `.loreconfig` file warned `lore-file-not-read`;
- an untracked Lore or `.loreconfig` file in the governed working tree (not under `--rules-ref`);
- a `nested-repo` `.loreconfig` below a marked directory, for that directory's lock file and that of any Lore root between them.

Then none of that lock file's records is reported. When it holds a record that no collected rule has, stderr says so in one line, so the silence is not taken for a clean lock file:

```
lore: orphan-review not checked in external:lore/shop/lore-reviews.lock: it may cover a rule this run did not collect (an error in external:lore/shop/.lore/bad.lore may hide rules)
```

A record of an excluded entry that has a readable id is never reported.

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

Each setting is looked up on its own, from the nearest `.loreconfig` that sets it on the way up from the rule's Lore file to its Lore root. An `orphan-review` takes the settings of the lock file's directory, looked up the same way.

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

JSON output is `{ "findings": [...], "summary": {...}, "excluded": [...], "unjudged": [...], "warnings": [...] }`. `findings` and `summary` follow `spec/schemas/audit.schema.json`; `excluded` and `warnings` list the excluded entries and the warnings `lore select` would give for the same rules, and `unjudged` lists `{ "file", "reason" }` for each lock file whose records were not checked for `orphan-review`. In text, all three go to stderr, one line each (`lore: excluded ...`, `lore: warning ...`, `lore: orphan-review not checked ...`). An excluded entry is not audited. Warnings never change the exit code, `--strict` included, as in `lore select`.

A lock file that is not in the format (a bad header, a line that is not a record, two records for one source) is an input error, exit 2, naming the file and the line. It is never repaired.

### Moving `source:` out of `<meta>`

A `source` key in `<meta>` stays free-form and is never an error. To list the rules that still carry one and have no `<source>` block, turn its finding on:

```
lore audit --level meta-source=warn
```

Move each one to a `<source>` block by hand or with your own script; there is no migration command.

### Upgrade the tool first

A tool older than this change reads a `<source>` block as `unknown-child` and excludes that rule, and reads the `audit` key as `invalid-loreconfig` and ignores the whole `.loreconfig`, including any `repo:` or `disable:` in it. Upgrade every tool that reads the rules (the `lore` command in CI and on each machine, and the editor extensions) before any rule file uses `<source>` or any `.loreconfig` uses `audit`.

## lore review

Records that a person reviewed named rules against their sources today. It does not perform the review: you read the rule and the text it cites, and the command writes down that you did, with a fingerprint of that text, in the rule's lock file (see [Where lock files live](#where-lock-files-live)). `lore audit` then reports when the text changes. It is the only command that writes the lock file, and it never writes a Lore file.

```
lore review (<id>... | --file <lore-file>... | --prune) [--date <YYYY-MM-DD>] [--repo <dir>] [--given <dir>]...
```

```
$ lore review money-in-minor-units
reviewed money-in-minor-units (1 source)
```

- For each named rule it resolves every source, fingerprints the text and replaces the rule's records with one per source, dated today (or `--date`). Records for sources the rule no longer has go with them.
- `--file <lore-file>` names every rule in that Lore file that has a source, and skips those without. Name the file as `lore audit` prints it (`.lore/checkout.lore`, or `external:` or `loose:` and the path for a given folder).
- A rule with a source that does not resolve is refused: its records stay as they were, the problem is printed on stderr as `lore audit` prints it, and the exit code is 1. The other rules in the run are still written. A rule with an `ambiguous-heading` is written, with the warning.
- A run that names rules changes only those rules' records. Every other line of the lock file stays as it was, records of rules that no longer exist included.
- `--prune` is the only way to remove records. It removes those whose rule or source no longer exists, prints how many, and writes nothing else. It reads and prunes only the lock files of the rules the run collects, and only those `lore audit` would judge (see [When a record is an orphan](#when-a-record-is-an-orphan)). For any other lock file with such records it removes nothing, prints one line on stderr, `lore: not pruning <lock file>: it may cover a rule this run did not collect (<reason>)`, and still exits 0. A record of an excluded entry with a readable id is never removed.
- A lock file that is not in the format is an input error, exit 2, and is left as it is. On any filesystem, `lore review` also refuses, with exit 2, when the lock file's directory has no `lore-reviews.lock` but has a file whose name differs from it only in letter case, such as `LORE-REVIEWS.LOCK`. Where the filesystem folds case, that file would be read and written in the lock file's place, and `lore audit`, which matches names exactly, would never read it. When the records do not change, the file is not rewritten. A changed file is written whole to a temporary file and renamed into place.
- It writes the working tree, so it reads Lore files from disk, untracked ones included, and reads the lock file whether git tracks it yet or not. Cited files are read as `lore audit` reads them: tracked files only, so `git add` a new cited file before reviewing against it. `git add` the lock file before auditing: `lore audit` reads only a tracked lock file, so when the run writes one git does not track, it says so on stderr.
- An id that names no rule, a rule with no `<source>`, a `--file` that is not a collected Lore file, a `--date` that is not a real date, more than one of ids, `--file` and `--prune`, and `--rules-ref`, `--remote` or `--no-repo` are usage errors. Nothing is written.
- Excluded entries and warnings go to stderr as in `lore audit`. Stdout has one line per rule written or refused, and with `--prune` one per lock file pruned.

### Why there is no flag for every rule

A record is a person's statement that they compared the rule with its source. A flag that records every rule, or every changed rule, at once would write that statement for rules nobody read, and the lock file would stop meaning anything. So rules are named one by one or one Lore file at a time. Adding such a flag later breaks nobody; removing one would.

### Adopting it file by file

A rule set that gains `<source>` blocks starts with every source `never-reviewed`, a warning by default, so the build does not fail. Review one Lore file at a time, as you read it:

```
lore review --file .lore/checkout.lore
git add lore-reviews.lock
```

## Other flags

- `--help`: print the usage.
- `--version`: print the version.

## Exit codes

- `lore select`: `0` when the selection ran, `1` when `--strict` was given and entries were excluded.
- `lore check`: `0` when the check ran, `1` when `--strict` was given and entries were excluded.
- `lore verdicts`: `0` when the verdicts have no problems, `1` when they have problems.
- `lore audit`: `0` when no finding is at level `error`, `1` when a finding is at level `error`, or when `--strict` was given and entries were excluded.
- `lore review`: `0` when every named rule was written, `1` when a rule was refused because a source does not resolve.
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
