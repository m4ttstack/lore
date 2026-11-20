---
title: lore review
sidebar_position: 6
---

# lore review

Records that a person reviewed named rules against their sources today.

## Usage

```text
lore review (<id>... | --file <lore-file>... | --prune) [--date <YYYY-MM-DD>] [--repo <dir>] [--given <dir>]...
```

`lore review` does not perform the review. A person reads the rule and the text it cites, and the command writes down that they did, with a fingerprint of that text, in the rule's lock file. [`lore audit`](./audit.md) then reports when the text changes. It is the only command that writes a lock file, and it never writes a Lore file.

## Choosing rules

Give exactly one of rule ids, `--file` and `--prune`.

### `<id>` {#id}

A rule compared with its sources.

- **Argument:** a rule id.
- **Repeatable:** yes.

For each named rule, the command resolves every source, fingerprints the text, and replaces the rule's records with one per source. Records for sources the rule no longer has go with them. Every other line of the lock file stays as it was.

```sh
lore review money-in-minor-units
```

### `--file <lore-file>` {#file}

Names every rule in that Lore file that has a source, and skips those without.

- **Argument:** a Lore file, named as `lore audit` prints it: `.lore/checkout.lore`, or `external:` or `loose:` and the path for a given folder.
- **Repeatable:** yes.

```sh
lore review --file .lore/checkout.lore
```

### `--prune` {#prune}

Removes records whose rule or source no longer exists, prints how many, and writes nothing else.

- **Argument:** none.

It is the only way to remove records. It prunes only the lock files `lore audit` would judge; for any other lock file with such records it prints one line on stderr and removes nothing.

```sh
lore review --prune
```

## Other options

### `--date <YYYY-MM-DD>` {#date}

The date to record.

- **Argument:** a real date written `YYYY-MM-DD`.
- **Default:** today, in local time.

```sh
lore review money-in-minor-units --date 2026-11-01
```

- [`--repo <dir>`](./options.md#repo) and [`--given <dir>`](./options.md#given), as on [Shared options](./options.md#rules).

`--rules-ref`, `--remote` and `--no-repo` are usage errors, because the command writes the working tree. It reads Lore files from disk, untracked ones included. Cited files are read as `lore audit` reads them: tracked files only.

## Output

Stdout has one line per rule written or refused, and with `--prune` one per lock file pruned:

```text
$ lore review money-in-minor-units
lore: lore-reviews.lock is not tracked by git; lore audit reads it once it is tracked (for example after git add)
reviewed money-in-minor-units (1 source)
```

The first line is on stderr: `lore audit` reads only a tracked lock file, so `git add lore-reviews.lock` next. The lock file then holds a header and one record per source:

```text
{"lore-reviews":1}
{"rule":"money-in-minor-units","file":"docs/checkout-review.md","heading":"Money is integer minor units","phrase":null,"reviewed":"2026-11-19","hash":"487f1765726e"}
```

A rule with a source that does not resolve is refused: its records stay as they were, the problem is printed on stderr as `lore audit` prints it, and the exit code is 1. The other rules in the run are still written.

There is no flag that records every rule at once. A record states that a person compared the rule with its source, so rules are named one by one or one Lore file at a time.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Every named rule was written. |
| `1` | A rule was refused because a source does not resolve. |
| `2` | Usage or input error, such as an unknown id or a lock file not in the format. Nothing is written. |
| `70` | Internal error (a bug). |
