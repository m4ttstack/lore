# Lore rules for this change

Answer every rule below with a verdict: `pass`, `fail` or `not-applicable`.

- `pass`: the change keeps the rule.
- `fail`: the change breaks it. Give at least one location: a changed file and a line in it as the change leaves it, or, with `"side": "old"`, a file's old path and a line the change removed.
- `not-applicable`: the rule was selected but does not bear on this change. Say why in `note`.

A flagged line is a place to look, not a verdict. Read the context below before judging. Judge only by these rules; never invent rules from other prose.

Return the verdicts as one fenced code block tagged `lore-verdicts`:

```lore-verdicts
{ "lore": "1", "verdicts": [{ "rule": "<id>", "verdict": "fail", "evidence": [{ "file": "<path>", "line": 12 }], "note": "<why>" }] }
```

## Rule `money-in-minor-units` (blocking, data_lineage)

Money is stored as integer minor units.
Never multiply a price by a float.

Flagged lines:

- `src/Price.ts:4` `total * 1.2`
- `src/Price.ts:9` `price * 0.5`

## Rule `name-things` (advisory, no category)

Name things well.

## Context `architecture`

Pricing lives in one module.

From `docs/architecture.md`:

````
# Architecture

One pricing module.
````

## Warnings

- `check-needs-file` in `.lore/pricing.lore` line 6 (entry `money-in-minor-units`)
