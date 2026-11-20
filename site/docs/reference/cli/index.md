---
title: CLI
sidebar_position: 3
---

# CLI

The `lore` command reads Lore rule files and tells a reviewer or an author which rules apply to a change. It never calls a forge, a model or the network. It runs git when an input needs it, and looks for `ast-grep` on the `PATH` only when a selected rule has an `ast-grep` check and the `ast-grep` capability is on.

## Install

Install it as a dev dependency, or run it without installing:

```sh
npm install --save-dev @mattstack/lore
npx @mattstack/lore check
```

It needs Node 20 or later. `lore check` needs git 2.25 or later.

Each [release](https://github.com/m4ttstack/lore/releases) also attaches the command as one file, `lore.js`, with no dependencies. Run it with Node 20 or later, or with Bun:

```sh
node lore.js --help
```

## Commands

| Command | Purpose |
|---|---|
| [`lore select`](./select.md) | Select the rules that apply to a diff, for a reviewer. |
| [`lore check`](./check.md) | Select the rules for an author's own change, built from git. |
| [`lore verdicts`](./verdicts.md) | Check a reviewer's verdicts against a selection. |
| [`lore audit`](./audit.md) | Check that each rule's sources still exist and have not changed. |
| [`lore review`](./review.md) | Record that a person reviewed rules against their sources. |

Options that several commands share are on [Shared options](./options.md). Also see [Rules in scope, not triggered](./also-in-scope.md), [Output formats](./output.md) and [Exit codes](./exit-codes.md).

## `lore --help`

```text
Usage:
  lore select [rules] --diff <file|-> [options]
  lore check [<commit> | --base <ref>] [rules] [options]
  lore verdicts --selection <file> [<verdicts-file> | -]
  lore audit [rules] [options]
  lore review (<id>... | --file <lore-file>... | --prune) [--date <YYYY-MM-DD>] [--repo <dir>] [--given <dir>]...
  lore --help
  lore --version

Rules:
  --repo <dir>               The governed repo's working tree (default: the git root above the current directory)
  --no-repo                  Take the governed repo to hold no Lore files; needs --remote
  --remote <url>             The governed repo's remote, for matching "repo" (repeatable; default: read from git)
  --rules-ref <ref>          Read the repo's Lore files at this git ref instead of the working tree; lore audit also reads lock files and cited files there
  --given <dir>              A given folder (repeatable)

Change:
  --diff <file|->            A unified diff, or - for stdin (lore select)
  <commit>                   The commit lore check reads the change from (default: uncommitted work, untracked files included)
  --base <ref>               lore check: compare with the merge base of <ref> and HEAD (the branch so far)

Output:
  --format text|json         Default: text for lore check and lore audit; for lore select, text on a terminal, json otherwise
  --capabilities <list>      Checks to run, default regex,ast-grep
  --strict                   Exit 1 when the rules have errors that excluded entries
  --also-in-scope            List rules whose scope covers a changed file but whose conditions did not hold
  --expand <id>              Print one of those rules in full (repeatable; it then needs a verdict)

Verdicts:
  --selection <file>         The JSON from lore select
  <verdicts-file>            A verdict set, or - for stdin (default)

Audit:
  --max-age <days>           Report a review older than this many days (overrides .loreconfig)
  --level <finding>=<level>  Set a finding's level: error, warn or off (repeatable; overrides .loreconfig)

Review:
  <id>                       A rule you compared with its sources; its records are written (repeatable)
  --file <lore-file>         Every rule with a source in this Lore file, named as lore audit prints it (repeatable)
  --prune                    Remove records whose rule or source no longer exists; no other run removes another rule's records
  --date <YYYY-MM-DD>        The date to record (default: today)

Exit codes:
  lore select    0 the selection ran, 1 --strict was given and entries were excluded
  lore check     0 the check ran, 1 --strict was given and entries were excluded
  lore verdicts  0 the verdicts have no problems, 1 the verdicts have problems
  lore audit     0 no finding at level error, 1 a finding at level error, or --strict and entries were excluded
  lore review    0 every named rule was written, 1 a rule was refused because a source does not resolve
  all            2 usage or input error, 70 internal error
```
