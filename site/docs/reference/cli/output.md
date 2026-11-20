---
title: Output formats
sidebar_position: 9
---

# Output formats

This page describes the JSON `lore select` and `lore check` print, how text output is laid out, and the verdict set `lore verdicts` reads. The audit result is described on [`lore audit`](./audit.md#output).

## The selection {#selection}

`lore select --format json` and `lore check --format json` print one object with these keys, in this order:

| Key | Value |
|---|---|
| `lore` | Always `"1"`. |
| `rules` | Each selected rule. |
| `context` | Each selected context. |
| `conditional` | Always an empty list in this version. |
| `change` | Each changed file, as the command read the diff. |
| `excluded` | The errors that excluded files or entries. |
| `warnings` | Warnings for the rules and the run. |
| `alsoInScope` | Only with `--also-in-scope` or `--expand`: see [Rules in scope, not triggered](./also-in-scope.md#json). |

A selected rule has `id`, `file`, `category`, `severity`, `summary` (its first paragraph on one line), `prose` (its full text), `meta`, `sources` and `hits`. A rule moved in with `--expand` also has `"expanded": true`:

```json
{
  "id": "money-in-minor-units",
  "file": ".lore/checkout.lore",
  "category": "functional_correctness",
  "severity": "advisory",
  "summary": "Amounts are integers in minor units (cents). Floating point never touches money.",
  "prose": "Amounts are integers in minor units (cents). Floating point never touches\nmoney.",
  "meta": null,
  "sources": [
    {
      "file": "docs/checkout-review.md",
      "heading": "Money is integer minor units",
      "phrase": null
    }
  ],
  "hits": [
    {
      "file": "src/checkout/total.ts",
      "line": 2,
      "text": "export const display = (q) => (q.total / 100).toFixed(2);"
    }
  ]
}
```

A hit is a line a condition or check found: its file, its line number counted from 1, and its text. A hit on a removed line carries `"side": "old"` and names the file's old path.

A selected context has `id`, `file`, `summary`, `prose`, `src` and `srcText`. `srcText` is the content of the `src` file, or `null` when the command did not read it.

A changed file has `kind` (`A`, `M`, `D` or `R`), `path`, `oldPath` (set for a rename, otherwise `null`), and the `added` and `removed` line numbers:

```json
{
  "kind": "M",
  "path": "src/checkout/total.ts",
  "oldPath": null,
  "added": [2],
  "removed": []
}
```

An excluded entry or a warning is a diagnostic: its `name` (see [Errors and warnings](../../spec/errors-and-warnings.md)), `file`, `entry`, `line` and `range`.

## Text output {#text}

Text output is Markdown. It opens with `# Lore rules for this change` and a short paragraph for its reader. `lore select` asks a reviewer for verdicts and shows the verdict format. `lore check` asks the author to fix what the change breaks. When nothing is selected, the text says so instead.

Each rule follows as `` ## Rule `<id>` (<severity>, <category>) ``, then its prose, then its flagged lines. At most 20 flagged lines print per rule, then `- and N more`, and each line is cut to 200 code points with `...` appended. An old-side hit is marked `(removed)`. Each selected context follows as `` ## Context `<id>` ``.

With `--also-in-scope`, the listing comes next. Warnings close the output, on stdout, under `## Warnings`. Excluded entries go to stderr, one line each, starting with `lore: `.

## The verdict set {#verdict-set}

A verdict set answers a selection. The reviewer returns it in a fenced block tagged `lore-verdicts`:

```json
{
  "lore": "1",
  "verdicts": [
    {
      "rule": "money-in-minor-units",
      "verdict": "fail",
      "evidence": [{ "file": "src/checkout/total.ts", "line": 2 }],
      "note": "toFixed on a float amount"
    },
    { "rule": "price-from-quote", "verdict": "pass" }
  ]
}
```

Each verdict has a `rule`, a `verdict` (`pass`, `fail` or `not-applicable`), and optionally `evidence` and `note`. Evidence is a changed file and a line in it as the change leaves it. With `"side": "old"`, it is a file's old path and a line the change removed.

`lore verdicts` reports these problems:

| Problem | Meaning |
|---|---|
| `invalid-verdict-set` | The set is not in the format. |
| `missing-verdict` | A selected rule has no verdict. |
| `duplicate-verdict` | A rule has more than one verdict. |
| `unselected-verdict` | A verdict names a rule that is neither selected nor listed. |
| `fail-without-evidence` | A `fail` has no evidence location. |
| `evidence-outside-change` | Evidence names a file the change did not touch on that side. |
| `missing-note` | A `fail` or `not-applicable` has no note. |
