---
title: lore audit
sidebar_position: 5
---

# lore audit

Checks that each rule's `<source>` still points at text that exists, and that the text has not changed since someone last reviewed the rule against it.

## Usage

```text
lore audit [rules] [options]
```

`lore audit` reads every rule collected for the governed repo and the given folders, disabled rules included, with no change involved. For each source it reads the cited file, finds the heading or phrase, and compares a fingerprint of that text with the rule's record in its lock file, `lore-reviews.lock`. Only [`lore review`](./review.md) writes that file; `lore audit` never changes a file.

## Rules options

These options are defined on [Shared options](./options.md#rules):

- [`--repo <dir>`](./options.md#repo)
- [`--no-repo`](./options.md#no-repo)
- [`--remote <url>`](./options.md#remote)
- [`--rules-ref <ref>`](./options.md#rules-ref): the rules, the lock files and the cited files are all read at that revision.
- [`--given <dir>`](./options.md#given)

Cited files, Lore files and lock files are read as `lore select` reads rules: tracked files only, from the working tree. A lock file is read only once git tracks it, so `git add` the file `lore review` writes before auditing.

## Audit options

### `--max-age <days>` {#max-age}

Reports `review-overdue` for a record older than this many days.

- **Argument:** a whole number above 0.
- **Default:** `audit.maxAgeDays` from `.loreconfig`; with none set, no age limit.

It overrides `maxAgeDays` in every `.loreconfig` for this run.

```sh
lore audit --max-age 180
```

### `--level <finding>=<level>` {#level}

Sets one finding's level for this run.

- **Argument:** a finding name, `=`, and `error`, `warn` or `off`.
- **Repeatable:** yes, once per finding.
- **Default:** the level from `.loreconfig`, or the finding's default level.

It overrides the `.loreconfig` files. A finding at `off` is not reported.

```sh
lore audit --level source-changed=error --level never-reviewed=off
```

## Output options

- [`--format text|json`](./options.md#format): text by default.
- [`--strict`](./options.md#strict)

`--diff`, `--capabilities`, `--also-in-scope`, `--expand` and positional arguments are usage errors.

## Findings

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

Levels and the age limit can also be set in a `.loreconfig`, under `audit`. See [`.loreconfig`](../../spec/loreconfig.md) in the specification for where each setting is looked up, and [Auditing sources](../../spec/auditing-sources.md) for lock files and orphans.

With `--no-repo`, a source that resolves into the governed repo is `source-unchecked`, since the repo is not there to read. A file-relative source (`./` or `../`) in a given folder is always checked:

```sh
lore audit --no-repo --remote github.com/acme/shop --given ../checkout-rules --level source-unchecked=off
```

## Output

Text output groups findings under each Lore file, one line each: level, finding, rule id, the source, and a reason when there is one. A count per finding follows, then the number of rules with and without a source. Here a rule cites a heading that has never been reviewed:

```text
.lore/checkout.lore
  warn  never-reviewed  money-in-minor-units  docs/checkout-review.md#Money is integer minor units

never-reviewed: 1
rules with a source: 1, without: 2
```

After `lore review money-in-minor-units` and an edit to the cited section, the same rule comes due:

```text
.lore/checkout.lore
  warn  source-changed  money-in-minor-units  docs/checkout-review.md#Money is integer minor units

source-changed: 1
rules with a source: 1, without: 2
```

Both runs exit 0, since the findings are warnings. With `--level source-changed=error`, the second run exits 1.

JSON output adds `excluded`, `unjudged` and `warnings` to the audit result:

```json
{
  "findings": [],
  "summary": {
    "counts": {},
    "rulesWithSource": 1,
    "rulesWithoutSource": 2
  },
  "excluded": [],
  "unjudged": [],
  "warnings": []
}
```

`findings` and `summary` follow the [audit result schema](../../spec/schemas/audit.md). `unjudged` lists `{ "file", "reason" }` for each lock file whose records were not checked for `orphan-review`. In text, excluded entries, warnings and unjudged lock files go to stderr, one line each.

A lock file that is not in the format is an input error, exit 2, naming the file and the line. It is never repaired.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | No finding at level `error`. |
| `1` | A finding at level `error`, or `--strict` was given and entries were excluded. |
| `2` | Usage or input error. |
| `70` | Internal error (a bug). |
