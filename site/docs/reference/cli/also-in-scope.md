---
title: Rules in scope, not triggered
sidebar_position: 8
---

# Rules in scope, not triggered

A rule whose scope covers a changed file is selected only when its `<when>` holds. With `--also-in-scope`, `lore select` and `lore check` also list the rules whose scope covers a changed file but whose `<when>` did not hold.

Requires lore 0.5.0 or later.

## What is listed

The listing holds rules only. A context, a rule with no `<when>`, a disabled rule, and a rule excluded by an error are never listed. Without the option, the output is the same as before.

## Text

In text, a section follows the rules and contexts and comes before the warnings. For a change to `src/checkout/total.ts`, where `dates-from-locale` covers the file but its `addedContains` found nothing:

```text
## Also in scope, not triggered

These rules cover files you changed, but nothing in your change triggered them. Read any that look relevant with `--expand <id>`.

- `dates-from-locale` (advisory, functional_correctness): Format dates with the user's locale from the session, never the server's.
```

Each line carries the rule's whole first paragraph as its summary, cut only past 600 code points. The section lists every blocking rule, then advisory rules until it holds 40 rule lines. A last line, `` - and N more; `--format json` lists them all ``, counts any left out.

When nothing is selected, the output says so and then prints the section. When the listing is empty, the text is the same as without the option.

## JSON

In JSON the selection gains a last key, `alsoInScope`, which is not capped:

```json
"alsoInScope": [
  {
    "id": "dates-from-locale",
    "file": ".lore/checkout.lore",
    "category": "functional_correctness",
    "severity": "advisory",
    "summary": "Format dates with the user's locale from the session, never the server's.",
    "paths": [
      "src/checkout/total.ts"
    ]
  }
]
```

`paths` holds the changed paths the rule's scope covers, sorted. Entries are sorted blocking before advisory, then by more covered paths first, then by id. When the listing is empty, `alsoInScope` is an empty list.

## Expanding a rule

`--expand <id>` moves a listed rule into `rules`. It is printed in full like a selected rule, with no flagged lines, and marked `"expanded": true` in JSON and `expanded` in its text heading:

```text
## Rule `dates-from-locale` (advisory, functional_correctness, expanded)

Format dates with the user's locale from the session, never the server's.
```

An expanded rule needs a verdict. An id that is not in the listing (already selected, disabled, unknown or out of scope) is a usage error, exit 2.

A listed rule needs no verdict. `lore verdicts` accepts one for it and checks it like any other. A selection saved without `alsoInScope` works as before.

## Cost, and when to turn it on

`packages/cli/test/listing-cost.test.ts` measures 200 rules, each with a summary of about 80 characters, on a change that puts all 200 in scope and triggers 10:

| Output | Added by the listing |
|---|---|
| Text | 45 lines, 5,379 bytes (the cap holds it at 40 rules) |
| JSON | 58,543 bytes (all 190 untriggered rules) |

The change in that test is one file. Each entry's `paths` grows with the changed files the rule covers, so the JSON cost grows with rules times covered files. The cap bounds advisory lines only: every blocking rule prints, and a line can reach 600 code points.

Turn the option on where a missed rule costs more than a few dozen extra lines of reading, and for rule sets whose triggers are literal strings. Leave it off for small sets with no triggers, where it prints nothing.
