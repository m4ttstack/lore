# Listing Summary and Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The in-scope listing prints a rule's whole first paragraph (safety cap 600 code points) and never drops a blocking rule from its 40 line cap; authors are told the first paragraph is the listing line; the CLI is ready to release as 0.6.1.

**Architecture:** One function in `packages/cli/src/text.ts` (`listingSection`) and one constant change. Docs and the `writing-lore` skill follow. No change to JSON output, selection or the spec's format.

**Tech Stack:** TypeScript, Bun tests (`bun test`), the repo's `bun run check`.

**Spec:** `docs/superpowers/specs/2026-11-13-listing-summary-design.md` (ticket LORE-15).

## Global Constraints

- This repo is public. No employer, team, pack or person names anywhere; nothing from `private/`.
- No em or en dashes in anything written (scan: `LC_ALL=C grep -rn -e $'\xe2\x80\x93' -e $'\xe2\x80\x94' <paths>` prints nothing).
- `MAX_SUMMARY_CODE_POINTS` is 600. A summary of at most 600 code points prints whole; a longer one is cut at 600 code points, never inside a code point, followed by `...`.
- `MAX_LISTED_RULES` stays 40 and counts rule lines. Every blocking rule is printed. Advisory rules are printed, in the existing order, until the section holds 40 rule lines; when blocking rules alone are 40 or more, no advisory rule is printed. The last line is `` - and N more; `--format json` lists them all `` where N is the number of rules not printed; it is absent when N is 0.
- The listing's order does not change (blocking before advisory, then more covered paths, then id). JSON output does not change.
- Code comments only where they state a constraint the code cannot show.
- Commits end with the Co-Authored-By line of the model that wrote them.
- Work in the worktree `.worktrees/listing-summary` on branch `listing-summary`. The main checkout stays on `main`.

## Review Focus

- A listing with 40 or more blocking rules: all are printed and the count line names only the advisory rules left out.
- A listing with fewer than 40 rules in all: output is byte-identical to today's except for summaries between 161 and 600 code points.
- A summary of exactly 600 code points, and one of 601 made of astral code points: kept whole, and cut without splitting a code point.
- The author audience (`lore check`) uses the same function: the same cut and cap apply.
- A listing that is all advisory and longer than 40: 40 lines, as today.

---

### Task 1: The cut and the cap

**Files:**
- Modify: `packages/cli/src/text.ts` (constants near line 33; `listingSection` near line 97)
- Test: `packages/cli/test/text.test.ts` (the listing tests near lines 185 to 207)
- Modify: `packages/cli/README.md` (lines 92 and 98), `docs/superpowers/specs/2026-11-10-lore-in-scope-listing-design.md` (the bullets near line 128), `packages/cli/package.json` (`"version": "0.6.1"`)

**Interfaces:** No signature changes. `listingSection(listed: ListedRule[], audience)` keeps its shape; `ListedRule.severity` is `"blocking" | "advisory"` as today.

- [ ] **Step 1: Failing tests** in `text.test.ts`, using the file's existing helpers (`listed`, `withListing`, `ruleLines`):
  - a summary of 600 `a` prints whole; 601 `a` prints 600 followed by `...`; 601 of `\u{1F600}` prints 600 of them followed by `...` (replaces the two 160 tests);
  - a summary of 200 code points prints whole with no `...`;
  - 45 blocking and 10 advisory rules: 45 rule lines, all blocking, then `` - and 10 more; `--format json` lists them all ``;
  - 30 blocking and 20 advisory: 40 rule lines (30 blocking, then the first 10 advisory in order), then `- and 10 more; ...`;
  - 45 advisory: unchanged from today (40 lines, `- and 5 more; ...`);
  - 12 blocking and 5 advisory: 17 lines and no count line;
  - one of the cap cases rendered for the author audience gives the same rule lines.
- [ ] **Step 2:** `bun test packages/cli/test/text.test.ts` fails on the new cases.
- [ ] **Step 3:** Set `MAX_SUMMARY_CODE_POINTS = 600`. In `listingSection`, print every blocking rule, then advisory rules while the printed count is below `MAX_LISTED_RULES`; the count line uses `listed.length` minus the printed count.
- [ ] **Step 4:** `bun test` (whole repo) passes; `bun run check` passes; `bun run build` passes.
- [ ] **Step 5:** Docs. `packages/cli/README.md`: line 92 says the summary is the rule's whole first paragraph, cut only past 600 code points; line 98 says every blocking rule is listed and advisory rules fill up to 40 lines. In the 2026-11-10 listing design, add a dated line under the bullets: "2026-11-13: the cut is 600 code points and the cap never drops a blocking rule; see `2026-11-13-listing-summary-design.md`." Set the CLI version to `0.6.1`. If a test or fixture pins the version string, update it.
- [ ] **Step 6:** Dash scan on the changed files. Commit `cli: list a rule's whole first paragraph and keep every blocking rule (LORE-15)`.

### Task 2: Writing guidance

**Files:**
- Modify: `skills/writing-lore/SKILL.md` (the "First paragraph" bullet near line 151 and the Common mistakes table), `skills/writing-lore/reference.md` if it describes the summary, `skills/writing-lore/tests/source-skill.md` and `tests/rubric.md` (one new trap and one rubric line)

This is a skill edit: the implementer loads `superpowers:writing-skills` first and follows the skill's own "Revising this skill" section (add the trap to the source and a line to the rubric, run the scenario with the current skill and watch it fail, change the skill, run again until it passes).

- [ ] **Step 1:** Add a trap to `tests/source-skill.md`: an instruction whose requirement is general in its first sentence and limited in a later paragraph (for example a rule that only applies to exported helpers, with the limit stated two paragraphs down). Add the rubric line: "the rule's first paragraph says when the rule applies before what it asks for, and holds the limit".
- [ ] **Step 2:** Run the scenario with the current skill (fresh subagent, per `tests/scenario.md`); record that the converted rule's first paragraph lacks the limit (RED). If it already passes, record that and keep the skill change minimal.
- [ ] **Step 3:** Change the "First paragraph" bullet to say: the first paragraph is what a listing shows for a rule that was not triggered, so it says when the rule applies before what it asks for, carries the rule's limits, and stays under 600 code points. Add one Common mistakes row: "A general demand first, the limit in a later paragraph" against "scope and limit in the first paragraph".
- [ ] **Step 4:** Run the scenario again until the rubric line passes (GREEN). Dash scan. Commit `skills: writing-lore puts a rule's scope in its first paragraph (LORE-15)`.

---

## After the tasks

- Whole-branch review on the most capable model.
- Open the pull request, wait for CodeRabbit and CI, answer findings, then stop for Matt's go before merging.
- After the merge (separate, on Matt's word): tag `cli-v0.6.1` so the release workflow publishes `lore.js`, then a small docs change for the README download link.

## Not in this plan

- Releasing; bundling 0.6.1 into any rule set; rewording rules.
