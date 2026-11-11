# In-scope listing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lore select` and `lore check` can list rules whose scope covers a changed file but whose `<when>` did not hold, and print any of them in full on request.

**Architecture:** The parser's selection loop already separates "scope covers a changed file" from "`<when>` holds"; a new parser entry point returns the rules that pass the first and fail the second, beside the unchanged eligibility result. The CLI turns that into an optional `alsoInScope` key and a text section, moves `--expand`ed rules into `rules`, and the verdict checker stops objecting to verdicts for listed rules.

**Tech Stack:** TypeScript, Bun (`bun test`), the existing `@lore/parser` and `packages/cli`.

**Spec:** `docs/superpowers/specs/2026-11-10-lore-in-scope-listing-design.md` (approved 2026-11-10). Executors read it in full.

## Global Constraints

- Without `--also-in-scope` and `--expand`, every output of `lore select`, `lore check` and `lore verdicts` is byte for byte what it is today. No existing expected file or fixture under `packages/*/test` or `test/fixtures` changes, except where a task says so.
- The spec's eligibility result and `spec/schemas/eligibility.schema.json` are untouched. `EligibilityResult` gains no field.
- The `alsoInScope` key is present only when one of the two options is given; it is never capped in JSON.
- Text section: heading `## Also in scope, not triggered`; at most 40 rule lines; summary cut to 160 code points; order is blocking before advisory, then more covered changed files first, then id; the overflow line is `` - and N more; `--format json` lists them all ``.
- `--expand <id>` is repeatable, implies `--also-in-scope`, and an id outside the listing set is a usage error (exit 2) that names the id.
- Version: `packages/cli/package.json` goes to 0.5.0. No release, tag or publish in this plan.
- Tests: `bun test packages/parser packages/cli` while iterating; before the last commit of a task also `bunx tsc --noEmit`. Comments only for a constraint the code cannot show. No em or en dashes in anything written. Nothing under `private/` is read or changed. This repository is public: no employer, team, pack or person names anywhere.
- Commits end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

- A rename whose old path is in a rule's scope and whose new path is not: the rule is listed, with the old path in `paths`. Pinned in Task 1.
- A rule switched off by config for one covered path but not another: listed, and `paths` holds only the paths it still counts for. Pinned in Task 1.
- `--expand` naming a rule that is already selected, disabled, unknown or out of scope: exit 2 naming the id, never a silent no-op. Pinned in Task 2.
- A summary holding backticks, or a first paragraph of several lines: one line, a safe code span, cut at 160 code points without splitting a code point. Pinned in Task 3.
- A selection saved by 0.4.0 (no `alsoInScope` key) passed to `lore verdicts`: works as before. Pinned in Task 4.

---

### Task 1: Parser: the rules in scope whose `<when>` did not hold

**Files:**
- Modify: `packages/parser/src/select.ts`, `packages/parser/src/index.ts` (export), `packages/parser/src/types.ts`
- Test: `packages/parser/test/select.test.ts`

**Interfaces (produces):**
- `interface Untriggered { id: string; paths: string[] }` (`paths`: the changed paths the rule counts for, sorted by code point, no duplicates)
- `selectDetailed(input: LoreInput, parsed: ParsedInput, change: Change, options?: SelectOptions): Promise<{ result: EligibilityResult; untriggered: Untriggered[] }>` (`untriggered` sorted by id; rules only, never contexts)
- `selectParsed` keeps its signature and returns `(await selectDetailed(...)).result`.

- [ ] **Step 1: Failing tests** in `select.test.ts`, one input with: a rule whose `<when>` holds (not listed, eligible); a rule with `addedContains` that does not hold (listed); a rule with no `<when>` (eligible, not listed); a context whose `<when>` does not hold (not listed); a disabled rule (not listed); a rule with an empty scope (not listed); a rule whose scope covers only the old path of a rename (listed, `paths` = [old path]); a rule whose scope covers a deleted file (listed with that path); a rule switched off by `.loreconfig` for one of two covered paths (listed, `paths` = the other path) and for both (not listed). Assert `result` deep-equals what `selectParsed` returns for the same input.
- [ ] **Step 2:** Run `bun test packages/parser/test/select.test.ts`: FAIL (no `selectDetailed`).
- [ ] **Step 3:** Implement: in the selection loop, a candidate rule with `counted.length > 0`, a non-null `when` and `conditionsHold` false is recorded with its counted paths (each path that is in scope and not disabled for the rule).
- [ ] **Step 4:** Run the parser tests and `bunx tsc --noEmit`: PASS.
- [ ] **Step 5:** Commit `parser: return in-scope rules whose conditions did not hold`.

---

### Task 2: CLI: the options, the JSON key and `--expand`

**Files:**
- Modify: `packages/cli/src/args.ts`, `packages/cli/src/selection.ts`, `packages/cli/src/main.ts`
- Test: `packages/cli/test/selection.test.ts`, `packages/cli/test/main.test.ts`

**Interfaces:**
- Consumes: `selectDetailed`, `Untriggered`.
- Produces:
  - Commands `select` and `check` gain `alsoInScope: boolean` and `expand: string[]` (`--expand` is a repeatable value flag; a non-empty `expand` sets `alsoInScope`).
  - `interface ListedRule { id: string; file: string; category: string | null; severity: "blocking" | "advisory"; summary: string; paths: string[] }`
  - `Selection` gains `alsoInScope?: ListedRule[]`; `SelectedRule` gains `expanded?: true`.
  - `toSelection(model, result, change, sources, unread?, listing?: { untriggered: Untriggered[]; expand: string[] })`: with `listing`, expanded ids leave the listing and join `rules` in id order with `hits: []` and `expanded: true`; the rest become `alsoInScope` in the order of the Global Constraints. Throws `UsageError` naming the first id in `expand` that is not in `untriggered`. Without `listing` the returned object has no `alsoInScope` key.

- [ ] **Step 1: Failing tests.** `toSelection`: order (a blocking rule before an advisory one; two advisory rules ordered by `paths.length` then id); an expanded rule appears in `rules` with `expanded: true` and not in `alsoInScope`; `expand` naming an already selected id, and an unknown id, each throw `UsageError` whose message holds the id; no `listing` gives an object without the key (`"alsoInScope" in selection` is false). `main`: `select --also-in-scope --format json` prints the key; the same command without the option prints exactly the existing expected JSON; `--expand x --expand y` is accepted and `--expand` with no value is a usage error; `check --also-in-scope` is accepted; `--expand not-a-rule` exits 2 with the id on stderr; the help text lists both options.
- [ ] **Step 2:** Run `bun test packages/cli`: FAIL.
- [ ] **Step 3:** Implement. `main.ts` calls `selectDetailed` and passes `listing` only when `alsoInScope` is set. Help text gains: `--also-in-scope        List rules whose scope covers a changed file but whose conditions did not hold` and `--expand <id>          Print one of those rules in full (repeatable; it then needs a verdict)`.
- [ ] **Step 4:** Run the cli tests and `bunx tsc --noEmit`: PASS.
- [ ] **Step 5:** Commit `cli: --also-in-scope and --expand on select and check`.

---

### Task 3: Text output

**Files:**
- Modify: `packages/cli/src/text.ts`
- Test: `packages/cli/test/text.test.ts` (and a new expected file under `packages/cli/test/expected/` if the suite's pattern uses one)

**Interfaces:** `renderText(selection, audience)` keeps its signature and reads `selection.alsoInScope` and `rule.expanded`.

- [ ] **Step 1: Failing tests.** With a listing of three rules after two selected rules and a context: the section sits after the contexts and before `## Warnings`, opens with the reviewer paragraph of the spec, and each line reads `` - `id` (severity, category): summary `` (`no category` when null). 45 listed rules print 40 lines and `` - and 5 more; `--format json` lists them all ``. A summary of 200 code points is cut to 160 followed by `...`; a summary holding a backtick is printed unchanged inside the line and the id uses the existing `span`. An expanded rule's heading reads `## Rule `id` (severity, category, expanded)` and has no flagged lines. Author audience: the author paragraph of the spec, no verdict wording. No rules and no contexts with a non-empty listing, reviewer: first line `No Lore rules were selected for this change.`, with the excluded sentence appended when `excluded` is non-empty, then the section, then the verdict meanings and the fenced `lore-verdicts` example taken from the preamble; author: no verdict block. Contexts but no rules: the normal preamble, the contexts, then the section. An empty or absent listing: output identical to today's for the same selection (assert against the existing expected text).
- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement; split the preamble constant so its verdict part can be reused without changing today's bytes. **Step 4:** Run the cli tests and `bunx tsc --noEmit`: PASS.
- [ ] **Step 5:** Commit `cli: print the in-scope listing in text output`.

---

### Task 4: Verdicts for listed rules

**Files:**
- Modify: `packages/cli/src/verdicts.ts`
- Test: `packages/cli/test/verdicts.test.ts`

- [ ] **Step 1: Failing tests.** A verdict for a rule in `alsoInScope` gives no `unselected-verdict`; a `fail` for one with no evidence still gives `fail-without-evidence`; two verdicts for one give `duplicate-verdict`; no verdict for a listed rule gives no problem; an expanded rule (in `rules`) with no verdict gives `missing-verdict`; a selection object without the `alsoInScope` key behaves as today (a verdict for an unknown rule is `unselected-verdict`); a selection whose `alsoInScope` is not an array is rejected by `readSelection` with a fixed message.
- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement. **Step 4:** Run: PASS, and `bunx tsc --noEmit`.
- [ ] **Step 5:** Commit `cli: accept verdicts for listed rules`.

---

### Task 5: Cost test, docs and version

**Files:**
- Create: `packages/cli/test/listing-cost.test.ts`
- Modify: `packages/cli/package.json` (0.5.0), `README.md` ("How tools use Lore" and the download line under "Try it" stay on the released version: do not change the 0.4.0 download URL), `packages/cli/README.md`, `docs/superpowers/specs/2026-10-27-lore-applying-rules-design.md` (a short section pointing at the new design)

- [ ] **Step 1: Failing test.** Build in the test a rule set of 200 rules under one folder, each with a one-sentence summary of about 80 characters and an `addedContains` literal unique to it, and a change of one file that all 200 scopes cover and whose added lines hold ten of the literals. Run the real select path with the option on. Assert: 10 selected, 190 listed in JSON; the text section has 40 rule lines plus the overflow line; and pin the two sizes as exact numbers once measured (text section bytes; `alsoInScope` JSON bytes).
- [ ] **Step 2:** Run: FAIL. **Step 3:** Make it pass (the feature exists; this step is fixing the fixture builder and writing the measured numbers into the assertions).
- [ ] **Step 4: Docs.** `README.md`, in "How tools use Lore": one paragraph after the numbered list saying a tool may also show the reviewer the rules whose scope matched but whose conditions did not hold, by one line each, that no verdict is required for those, and that a reviewer can ask for one in full; name the two options. `packages/cli/README.md`: the two options in the command reference with the JSON key and the text section's shape, the two measured sizes with the name of the test that produces them, and "when to turn it on" as the spec words it. The applying-rules design: a section "Listing in-scope rules" of three or four lines pointing at the new design.
- [ ] **Step 5:** Version to 0.5.0. Run the CI steps locally in order: `bun install --frozen-lockfile`, `bun scripts/fixtures.ts`, `git diff --exit-code -- test/fixtures`, `bun run build`, `bunx tsc --noEmit`, `bun test`, then the smoke commands of `.github/workflows/ci.yml` against `packages/cli/dist/lore.js` with and without `--also-in-scope`.
- [ ] **Step 6:** Commit `cli: 0.5.0 with docs and a cost test for the in-scope listing`.
