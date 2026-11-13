# Listing summary and cap (design)

Date: 2026-11-13. Ticket: LORE-15. Size: a small change to the text output
of `lore select` and `lore check` with `--also-in-scope`.

## Intent

The in-scope listing shows one line per rule that covers the change but was
not triggered. A reviewer who meets a rule only there judges by that line.
Today the line is the rule's first paragraph cut at 160 code points, often
mid-sentence. When the cut hides the rule's limit, the line reads as a wider
demand than the rule, and reviewers fail changes that do not break it.

Measured on one rule set of 224 rules:

| Cut | Shown whole | Cut at a sentence end | Cut mid-sentence |
|---|---|---|---|
| 160 code points (today) | 72 | 47 | 105 |
| whole paragraph, cap 600 | 222 | 0 | 2 |

In a reader check, one rule was wrongly failed in 12 of 12 reads from its
160 code point fragment, and in 2 of 12 once its scope fit inside the
fragment.

## Goals

- A listed rule's line carries its whole first paragraph.
- The cap on the number of lines never drops a blocking rule.
- Authors are told that the first paragraph is the listing line.

## Non-goals

- Sentence detection. Where a sentence ends is fuzzy (code spans,
  abbreviations) and every implementation would have to agree on it.
- Any change to JSON output, to selection, or to `--expand`.
- Rewording rules in any rule set. That is the rule owner's work.

## Anti-goal

- An unbounded listing. The text stays bounded: a safety cap per summary
  and a cap on advisory lines.

## Approaches

1. Whole first paragraph with a high safety cap. Chosen. Simple to state,
   the same in every implementation, and the author controls the line.
2. Whole sentences up to about 400 code points. Slightly shorter output,
   but needs a pinned definition of a sentence end.
3. First sentence only. Shortest, but many rules state their limit in the
   second sentence.

## Design

- **Summary.** `MAX_SUMMARY_CODE_POINTS` goes from 160 to 600. A summary of
  at most 600 code points prints whole. A longer one is cut at 600 code
  points (never inside a code point) and followed by `...`, as today.
- **Cap.** The listing keeps its order (blocking before advisory, then more
  covered paths, then id). Every blocking rule is printed. Advisory rules
  are printed until the section holds 40 rule lines; when the blocking
  rules alone are 40 or more, no advisory rule is printed. The last line
  still counts the rules not shown:
  `` - and N more; `--format json` lists them all ``.
- **Cost.** In the measured rule set a 35 line listing grows from about
  4.6 KB to about 7 KB. The worst case per line is 600 code points.
- **Docs.** The listing design doc of 2026-11-10 gets a dated note pointing
  here; the CLI README states the new cut and cap; the `writing-lore`
  skill says the first paragraph is the listing line: say when the rule
  applies before what it asks for, and keep it under 600 code points.
- **Version.** CLI 0.6.1. No format change, so the spec version does not
  move.

## Left to the builder

- Test names and fixtures; the exact README and skill wording (the skill
  edit follows the skill's own test scenario).
