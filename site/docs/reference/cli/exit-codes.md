---
title: Exit codes
sidebar_position: 10
---

# Exit codes

Every command exits `2` for a usage or input error and `70` for an internal error (a bug). The other codes depend on the command.

| Command | `0` | `1` |
|---|---|---|
| [`lore select`](./select.md) | The selection ran. | `--strict` was given and entries were excluded. |
| [`lore check`](./check.md) | The check ran. | `--strict` was given and entries were excluded. |
| [`lore verdicts`](./verdicts.md) | The verdicts have no problems. | The verdicts have problems. |
| [`lore audit`](./audit.md) | No finding at level `error`. | A finding at level `error`, or `--strict` was given and entries were excluded. |
| [`lore review`](./review.md) | Every named rule was written. | A rule was refused because a source does not resolve. |

Warnings never change the exit code, with or without `--strict`.

A usage error is a problem with the command line, such as an unknown option. An input error is a problem with what the command reads, such as no git working copy, a diff that cannot be read, or a lock file not in the format. Both print one line on stderr, starting with `lore: `:

```text
$ lore audit --expand x
lore: unknown option: --expand
```
