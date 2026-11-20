---
title: lore verdicts
sidebar_position: 4
---

# lore verdicts

Checks a verdict set against the selection it answers.

## Usage

```text
lore verdicts --selection <file> [<verdicts-file> | -]
```

A reviewer, human or agent, answers each selected rule with `pass`, `fail` or `not-applicable`. `lore verdicts` checks that answer: every rule has one verdict, each `fail` has evidence, each answer other than `pass` has a note, and the evidence names files the change touched.

## Options

### `--selection <file>` {#selection}

The selection the verdicts answer: the JSON `lore select` printed.

- **Argument:** a file path, or `-` for stdin.
- **Required:** yes.

Only one of the selection and the verdicts can come from stdin.

```sh
lore select --diff change.diff --format json > selection.json
```

### `<verdicts-file>` {#verdicts-file}

The verdict set to check.

- **Argument:** a file path, or `-` for stdin.
- **Default:** stdin.

The set is the JSON in the reviewer's `lore-verdicts` block. Its format is on [Output formats](./output.md#verdict-set).

```sh
lore verdicts --selection selection.json verdicts.json
```

[`--help`](./options.md#help) prints the usage.

## Output

The output is always JSON: a `problems` list, empty when the verdicts are complete. Here the verdict set answers `money-in-minor-units` but not `price-from-quote`:

```json
{
  "problems": [
    {
      "name": "missing-verdict",
      "rule": "price-from-quote",
      "detail": "\"price-from-quote\" has no verdict."
    }
  ]
}
```

The command exits 1. With a verdict for both rules, it prints `{ "problems": [] }` and exits 0.

A rule listed by `--also-in-scope` needs no verdict, but one given for it is checked like any other. A rule moved into the selection with `--expand` needs one.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The verdicts have no problems. |
| `1` | The verdicts have problems. |
| `2` | Usage or input error, such as a file that is not JSON. |
| `70` | Internal error (a bug). |
