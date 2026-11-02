# Removed-Line Conditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `removedContains` and `removedMatches` to Lore, with the removed lines they find reported as old-side hits, across the spec, the parser, the CLI, the language server and the writing-lore skill.

**Architecture:** The change model gains `removed` beside `added` on every changed file, from the conformance diff format (`-<n> <text>`) and from the unified-diff parser alike. The parser evaluates the two new keys over removed lines and records their hits with `side: "old"`, the file's old path and the old-side line number. The CLI passes `side` and `removed` through its JSON and marks old-side flagged lines in text.

**Tech Stack:** TypeScript on bun 1.4.3 (workspace: `packages/parser`, `packages/cli`, `packages/language-server`), `bun test`, JSON Schema 2020-12, the spec's own conformance examples run by `packages/parser/test/conformance.test.ts` and `bun run check`.

**Spec:** `docs/superpowers/specs/2026-11-02-lore-removed-lines-design.md`

## Global Constraints

- Every key in a `<when>` must still hold; no "either side" form.
- `removedContains` takes a list of strings with the `addedContains` item rules (non-empty, no line feed or carriage return); `removedMatches` takes patterns in the regex dialect with the `addedMatches` rules.
- A removed line's text is the line as it was in the old version, decoded as an added line's text is.
- A hit carries `side` only when it is `"old"`; absent means new. An old-side hit names the file's old path, the old-version line number and the removed text. At most one hit per rule, side, file and line. Hits order by `rule`, `file`, `side` (new before old), `line`.
- A deleted file's every old-version line is a removed line. An added file, including a git copy, has no removed lines. A renamed file's removed lines belong to its old path.
- `<check>` searches added lines only; unchanged.
- Verdict checking is unchanged.
- The spec stays version 1, status draft; `lore: 1` is unchanged. No new error names.
- Public repo: examples use `acme/shop`; no employer, team, product or ticket names anywhere in the tree or commits. No em or en dashes in prose.
- The CLI package version becomes 0.3.0 on this branch; publishing is not part of this plan.
- Commit messages are short and imperative, as the repo's history shows (`spec: ...`, `parser: ...`, `cli: ...`, `lsp: ...`, `skill: ...`).

## Review Focus

- A diff whose hunk header has no old count (`@@ -3 +3,2 @@`) removes one line numbered from the old start; pinned in Task 3.
- A deleted file in the unified diff carries every old line as removed, in order; pinned in Task 3.
- A rename with edits puts removed lines under the old path while added lines stay under the new path, in one changed file; pinned in Tasks 2 and 3.
- A rule with both an added and a removed condition is eligible only when both hold, and reports hits on both sides, new before old, with no duplicate when the same text is on both sides at the same line number; pinned in Task 2.
- Text output applies the 20-line cap across both sides together, so a rule with many old-side hits still prints `- and N more`; pinned in Task 4.

---

### Task 1: Spec text, schemas and the conformance checker

**Files:**
- Modify: `spec/SPEC.md` (Conventions ~80, diff format ~135-156, output ~209-215, Conditions 3406-3485, Running checks 4169-4176, Eligibility 4405-4418)
- Modify: `spec/schemas/when.schema.json`, `spec/schemas/eligibility.schema.json`
- Modify: `tools/check/check.ts:27-29, 202-223`
- Modify: `README.md:116-121`
- Test: `tests/schemas.test.ts`, `tests/check.test.ts`

**Interfaces:**
- Produces: the normative text Tasks 2 to 6 implement; the `-<n> <text>` diff line form; `side` on a hit in `eligibility.schema.json`.

- [ ] **Step 1: Write the failing schema tests** in `tests/schemas.test.ts` beside the existing eligibility tests:

```ts
test("when accepts removedContains and removedMatches with the added pair's item rules", () => {
  expect(checkJson("when", { removedContains: ["??"], removedMatches: ["\\?\\?"] })).toBe(true);
  expect(checkJson("when", { removedContains: [""] })).toBe(false);
  expect(checkJson("when", { removedContains: ["a\nb"] })).toBe(false);
});
test("eligibility hit takes side old and nothing else", () => {
  const hit = (extra: object) => checkJson("eligibility", { eligible: [], hits: [{ rule: "a", file: "f", line: 1, text: "t", ...extra }], excluded: [], warnings: [] });
  expect(hit({ side: "old" })).toBe(true);
  expect(hit({ side: "new" })).toBe(true);
  expect(hit({ side: "removed" })).toBe(false);
});
```

- [ ] **Step 2: Write the failing checker tests** in `tests/check.test.ts` inside the `diff-syntax` test:

```ts
expect(rules(swap("M src/x.ts\n+2 two", "M src/x.ts\n-2 gone\n+2 two"))).toEqual([]);
expect(rules(swap("M src/x.ts\n+2 two", "D src/x.ts\n-1 gone"))).toEqual([]);
expect(rules(swap("M src/x.ts\n+2 two", "R src/y.ts -> src/x.ts\n-1 gone\n+2 two"))).toEqual([]);
expect(rules(swap("M src/x.ts\n+2 two", "A src/x.ts\n-1 gone"))).toContain("diff-syntax");
for (const line of ["-0 two", "-2two"]) expect(rules(swap("M src/x.ts\n", `M src/x.ts\n${line}\n`))).toContain("diff-syntax");
```

- [ ] **Step 3: Run both files to verify they fail**

Run: `bun test tests/schemas.test.ts tests/check.test.ts`
Expected: FAIL on the new assertions only.

- [ ] **Step 4: Update the schemas.** In `when.schema.json` add `removedContains` with `addedContains`'s item schema and `removedMatches` with `addedMatches`'s. In `eligibility.schema.json` add to a hit's properties `"side": { "enum": ["new", "old"] }`, not required.

- [ ] **Step 5: Update the checker.** In `tools/check/check.ts` add `const MINUS_LINE = /^-([1-9]\d*) (.*)$/;` and in `checkDiff` track an `oldTarget` beside `target`: a `D` or `M` file line sets it to the path, `A` sets it to null, a rename sets it to the old path. A `-` line with `oldTarget === null` reports `diff-syntax` with "is a - line without an M, D or R file line before it"; a well-formed `-` line otherwise reports nothing (the old version is unknown, so there is no `diff-agrees` check for it).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/schemas.test.ts tests/check.test.ts`
Expected: PASS

- [ ] **Step 7: Edit the spec prose.** Each edit names the sentence it replaces so the implementer finds it with grep:

1. Conventions, **Change**: "a set of changed files and, for each added, modified or renamed file, its added lines" becomes "a set of changed files and, for each one, its added lines and its removed lines. An added file has no removed lines; a deleted file has no added lines."
2. Diff format: after the `+<n> <text>` bullet add `-<n> <text>`: "a removed line. Line `<n>` (counted from 1) of the old version of the file named by the nearest `M`, `D` or `R` line above it (for a rename, the old path) is `<text>`, read as a `+` line's text is." Extend the malformed sentence: "a `+` line anywhere else, such as after a `D` line, is malformed, and so is a `-` line after an `A` line. Under one file, `+` and `-` lines may come in any order." Replace "Any line of a changed file that is not listed as an added line is unchanged." with "Any line of a changed file's new version that is not listed as added, and any line of its old version that is not listed as removed, is unchanged."
3. "What the governed repo contains": after "has unknown content apart from its added lines" add "and its old version has unknown content apart from its removed lines".
4. Output, **Hits** bullet: "A hit's `line` is the `+<n>` line number from the diff, and its `text` is that line's text" becomes "A hit's `line` is the `+<n>` or `-<n>` line number from the diff and its `text` is that line's text; a hit on a removed line carries `"side": "old"` and names the file by its old path, and a hit on an added line carries no `side`." **Order**: "hits are ordered by `rule`, then `file`, then `line`" becomes "hits are ordered by `rule`, then `file`, then side with new before old, then `line`".
5. Conditions table: two rows after `addedMatches`, `removedContains` ("A removed line of a counted file contains one of the strings.") and `removedMatches` ("A removed line of a counted file matches one of the patterns."). Bullet "An **added line's text**" becomes "An **added line's text**, and a **removed line's text**," with "In a conformance example it is the `<text>` of a `+<n> <text>` or `-<n> <text>` line." Replace "Only added lines count. The unchanged lines around them and removed lines never do." with "The added-line conditions see added lines only and the removed-line conditions removed lines only; the unchanged lines around them never count for either." Extend the `addedContains` and `addedMatches` bullets with "`removedContains` and `removedMatches` do the same over removed lines." Empty-list bullet: "the other three conditions never do" becomes "the other five". Hit bullet: "each added line of a counted file that one of its `addedContains` or `addedMatches` conditions finds is a hit" gains "and each removed line one of its `removedContains` or `removedMatches` conditions finds is a hit on the old side, named by the file's old path". Check order item 4: "one of the four above" becomes "one of the six above"; item 5: "when an `addedContains` string is empty" becomes "when an `addedContains` or `removedContains` string is empty". Delete "A condition on removed lines is reserved for a later version." The sentence that introduces example 64, "Only added lines count. `'USD'` is on an unchanged line", becomes "Unchanged lines never count. `'USD'` is on an unchanged line".
6. Running checks: "Each check searches the rule's counted files that have added lines; a deleted file has none. A **hit** names the rule, the changed file (by its new path), the number of an added line, and that line's text" becomes "Each check searches the rule's counted files that have added lines; a deleted file has none. A **hit** names the rule, a side, the changed file and a line's number and text: on the new side the file's new path and an added line, on the old side the file's old path and a removed line. A check's hits and an added-line condition's hits are on the new side; a removed-line condition's hits are on the old side". "An eligible rule's hits are those of its checks and those of its added-line conditions. A rule has at most one hit per file and line" becomes "... its checks and those of its added-line and removed-line conditions. A rule has at most one hit per side, file and line".
7. Eligibility: "A deleted file has one path: its old path. It has no added lines." gains "Every line of its old version is a removed line." The rename bullet: "Its added lines are lines of its new version, and a hit names it by its new path (...), whichever path made it a counted file." becomes "Its added lines are lines of its new version and its removed lines are lines of its old version; a hit on an added line names it by its new path and a hit on a removed line by its old path (...), whichever path made it a counted file."

8. `README.md` conditions paragraph: "text in added lines (`addedContains`, `addedMatches`)" becomes "text in added lines (`addedContains`, `addedMatches`) or in removed lines (`removedContains`, `removedMatches`)", and "The added lines that `addedContains` or `addedMatches` find are also pointed out to the reviewer" gains "as are the removed lines the removed pair finds, by the file's old path".

- [ ] **Step 8: Run the checker and the suites that read the spec**

Run: `bun run check && bun test tests packages/parser/test/conformance.test.ts`
Expected: `bun run check` clean, everything PASSES. No example changes yet: those land with the parser in Task 2.

- [ ] **Step 9: Commit**

```bash
git add spec tools/check README.md tests
git commit -m "spec: removedContains and removedMatches, with hits on the old side"
```

---

### Task 2: Parser: change model, validation, selection and hits

**Files:**
- Modify: `packages/parser/src/types.ts:21-26`
- Modify: `packages/parser/src/blocks.ts:12, 44-64`
- Modify: `packages/parser/src/select.ts:12-13, 76-80, 100-124, 136-138, 152-168, 214-220, 269-271`
- Modify: `packages/parser/test/harness.ts:33-52`, `spec/SPEC.md` (three examples), `packages/parser/test/collect.test.ts` (example numbers)
- Test: `packages/parser/test/blocks.test.ts`, `packages/parser/test/select.test.ts`, `packages/parser/test/conformance.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `export interface ChangedLine { line: number; text: string }` (rename of `AddedLine`; keep `export type AddedLine = ChangedLine` so no importer breaks).
  - `ChangedFile`: every variant gains `removed: ChangedLine[]`.
  - `export interface Hit { rule: string; file: string; line: number; text: string; side?: "old" }`.
- Consumes: the spec prose from Task 1; this task adds the examples that pin it.

- [ ] **Step 1: Write the failing validation tests** in `packages/parser/test/blocks.test.ts`, following the file's existing `checkWhen` tests:

```ts
test("removedContains and removedMatches validate like the added pair", () => {
  expect(checkWhen({ removedContains: ["??"], removedMatches: ["\\?\\?"] }, LINE)).toBeNull();
  expect(checkWhen({ removedContains: [""] }, LINE)).toEqual({ name: "invalid-when", line: LINE });
  expect(checkWhen({ removedContains: ["a\nb"] }, LINE)).toEqual({ name: "invalid-when", line: LINE });
  expect(checkWhen({ removedMatches: ["a\nb"] }, LINE)).toEqual({ name: "regex-not-one-line", line: LINE });
});
```

- [ ] **Step 2: Write the failing selection tests** in `packages/parser/test/select.test.ts`, a new `describe("select: removed lines")` using the file's `repo`, `rule`, `change` and `ALL` helpers:

```ts
test("removedContains selects on a removed line and reports it on the old side", async () => {
  const input = repo({ ".lore/a.lore": rule("fallback-kept", '<when>\nremovedContains: ["??"]\n</when>\n') });
  const result = await select(input, change("M a.ts", "-2 const x = y ?? ''", "+2 const x = y"), ALL);
  expect(result.eligible).toEqual(["fallback-kept"]);
  expect(result.hits).toEqual([{ rule: "fallback-kept", file: "a.ts", line: 2, text: "const x = y ?? ''", side: "old" }]);
});

test("removedMatches searches removed lines only", async () => {
  const input = repo({ ".lore/a.lore": rule("flag-read-kept", "<when>\nremovedMatches: ['^\\s*isEnabled\\(']\n</when>\n") });
  expect((await select(input, change("M a.ts", "+1   isEnabled('x')"), ALL)).eligible).toEqual([]);
  expect((await select(input, change("M a.ts", "-1   isEnabled('x')"), ALL)).eligible).toEqual(["flag-read-kept"]);
});

test("both sides must hold, and hits order new before old without duplicates", async () => {
  const input = repo({ ".lore/a.lore": rule("expectation-replaced", '<when>\naddedContains: ["expect("]\nremovedContains: ["expect("]\n</when>\n') });
  expect((await select(input, change("M a.test.ts", "+5 expect(a).toBe(1)"), ALL)).eligible).toEqual([]);
  const result = await select(input, change("M a.test.ts", "-5 expect(a).toBe(2)", "+5 expect(a).toBe(1)"), ALL);
  expect(result.hits).toEqual([
    { rule: "expectation-replaced", file: "a.test.ts", line: 5, text: "expect(a).toBe(1)" },
    { rule: "expectation-replaced", file: "a.test.ts", line: 5, text: "expect(a).toBe(2)", side: "old" },
  ]);
});

test("a deleted file's removed lines count and are named by its path", async () => {
  const input = repo({ ".lore/a.lore": rule("legacy-usd", "<when>\nremovedContains: [\"'USD'\"]\n</when>\n") });
  const result = await select(input, change("D legacy/Price.tsx", "-3 const c = 'USD'"), ALL);
  expect(result.hits).toEqual([{ rule: "legacy-usd", file: "legacy/Price.tsx", line: 3, text: "const c = 'USD'", side: "old" }]);
});

test("a renamed file's removed lines are hits by its old path", async () => {
  const input = repo({ "checkout/.lore/a.lore": rule("usd", "<when>\nremovedContains: [\"'USD'\"]\n</when>\n") });
  const result = await select(input, change("R legacy/Price.tsx -> checkout/Price.tsx", "-3 'USD'", "+3 settings.currency"), ALL);
  expect(result.hits.map((hit) => hit.file)).toEqual(["legacy/Price.tsx"]);
});

test("a removed line never counts for an added condition or a check", async () => {
  const input = repo({ ".lore/a.lore": rule("no-usd", "<when>\naddedContains: [\"'USD'\"]\n</when>\n<check>\n'USD'\n</check>\n") });
  expect((await select(input, change("M a.ts", "-1 'USD'"), ALL)).eligible).toEqual([]);
});
```

- [ ] **Step 3: Extend the harness** `toChange` in `packages/parser/test/harness.ts`: every pushed file gets `removed: []`; a line matching `/^-(\d+)(?: (.*))?$/` pushes `{ line, text }` onto the current file's `removed`, and throws `removed line in an added file: <line>` when the current file's kind is `A`.

- [ ] **Step 4: Add the spec examples.** Three edits to `spec/SPEC.md`:

1. Conditions: after the `addedMatches` example (example 70, "`^` matches only at the start") and before "`changed` and `unchanged`", insert:

````
A removed line counts only for the removed-line conditions. The first
rule's condition finds the removed fallback, which is a hit on the old
side. The second rule's `addedContains` sees the added line only, and
`??` is on no added line:

``````example eligibility
=== apps/web/src/checkout/.lore/reads.lore
<rule id="fallback-kept" category="functional_correctness">
<when>
removedContains: ["??"]
</when>
A read of an optional field keeps its `??` fallback.
</rule>

<rule id="fallback-added" category="functional_correctness">
<when>
addedContains: ["??"]
</when>
A new read of an optional field has a `??` fallback.
</rule>
=== apps/web/src/checkout/Price.tsx
export function Price({ quote }) {
  const label = quote.label
  return <span>{label}</span>
}
=== diff
M apps/web/src/checkout/Price.tsx
-2   const label = quote.label ?? ''
+2   const label = quote.label
=== expect
{
  "eligible": ["fallback-kept"],
  "hits": [
    { "rule": "fallback-kept", "file": "apps/web/src/checkout/Price.tsx", "line": 2, "text": "  const label = quote.label ?? ''", "side": "old" }
  ],
  "excluded": [],
  "warnings": []
}
``````
````

2. Eligibility: at the end of the section's examples (after example 83), insert:

````
A renamed file's removed lines are hits by its old path, even when only
its new path is in the rule's scope:

``````example eligibility
=== apps/web/src/checkout/.lore/currency.lore
<rule id="currency-from-settings" category="functional_correctness">
<when>
removedContains: ["'USD'"]
</when>
A currency code is read from settings, never hard-coded.
</rule>
=== diff
R apps/web/src/legacy/Price.tsx -> apps/web/src/checkout/Price.tsx
-3   const currency = 'USD'
+3   const currency = settings.currency
=== expect
{
  "eligible": ["currency-from-settings"],
  "hits": [
    { "rule": "currency-from-settings", "file": "apps/web/src/legacy/Price.tsx", "line": 3, "text": "  const currency = 'USD'", "side": "old" }
  ],
  "excluded": [],
  "warnings": []
}
``````
````


3. The Eligibility example whose diff starts `D apps/web/src/legacy/OldPrice.tsx` gains the removed lines the matching unified diff in `packages/cli/test/diff.test.ts` carries: under the `D` line `-1 export const OldPrice = 1` and `-2 export default OldPrice`; under the `R` line, before its `+3`, `-3   const label = 'EUR'`. Its `expect` block does not change.

Then renumber the example references the two insertions shift: in `packages/parser/test/select.test.ts` `example(78)` becomes `example(79)`; in `packages/parser/test/collect.test.ts` 87 becomes 89, 88 becomes 90, 89 becomes 91, 96 becomes 98 (both), 100 becomes 102. Confirm with a `bun -e` script over `tools/check/extract.ts` that example 71 is in Conditions and 85 in Eligibility.

- [ ] **Step 5: Run to verify the new tests fail**

Run: `bun run check && bun test packages/parser/test/blocks.test.ts packages/parser/test/select.test.ts packages/parser/test/conformance.test.ts`
Expected: `bun run check` clean; FAIL on the new tests and on examples 71 and 85 (`unknown-condition` excludes their rules); every other example PASSES.

- [ ] **Step 6: Implement the types and validation.** In `types.ts` make the Interfaces changes above. In `blocks.ts` set `CONDITIONS = ["addedContains", "addedMatches", "removedContains", "removedMatches", "changed", "unchanged"]`, apply the empty-or-line-break check to `removedContains` as to `addedContains`, validate `removedMatches` items with `validateRegex` and `removedContains` items with none, keeping the glob validation for the two glob keys.

- [ ] **Step 7: Implement selection.** In `select.ts`:
  - `Changed` gains `oldPath: string | null` and `removed: ChangedLine[]`; `toChanged` sets `oldPath` to the path for `M` and `D`, the old path for `R`, null for `A`, and `removed` from the file (`[]` for `A`).
  - `conditionsHold` gains `removedLine`, the twin of `addedLine` over `file.removed`, and cases for the two keys.
  - `compileRegexes` includes `entry.when?.removedMatches`.
  - `runChecks`: the dedupe key becomes `${rule}\0${side}\0${file}\0${line}`; a `removedLineConditions(when, regexes)` twin of `addedLineConditions` runs over every counted file with `oldPath !== null`, recording `{ rule, file: oldPath, line, text, side: "old" }`. Checks and added conditions are unchanged.
  - `compareHits` orders by rule, file, side (a hit with no `side` before `"old"`), line.

- [ ] **Step 8: Run the parser suite**

Run: `bun test packages/parser && bunx tsc --noEmit`
Expected: PASS, every conformance example running, typecheck clean. If the CLI package fails to typecheck on `removed` or `ChangedLine`, that is Task 3's work: note it and continue.

- [ ] **Step 9: Commit**

```bash
git add spec/SPEC.md packages/parser
git commit -m "parser: removed-line conditions with old-side hits"
```

---

### Task 3: CLI diff parser keeps removed lines

**Files:**
- Modify: `packages/cli/src/diff.ts:4, 13-27, 128-137, 158-198`
- Test: `packages/cli/test/diff.test.ts`

**Interfaces:**
- Consumes: `ChangedFile` with `removed: ChangedLine[]` from Task 2.
- Produces: `parseUnifiedDiff(text: string): Change` with removed lines numbered from each hunk's old start.

- [ ] **Step 1: Update the existing expectations** in `diff.test.ts` so every expected `ChangedFile` carries `removed`, with the real removed lines from each test's diff: the first test gets `removed: [{ line: 2, text: "old" }]`; "deleted file mode" gets `removed: [{ line: 1, text: "one" }, { line: 2, text: "two" }]`; "a rename with edits" gets `removed: [{ line: 2, text: "before" }]`; "no-newline marker", "quoted path", "path with a space" and the `quoted` helper each get the one `-` line they contain at line 1; "plain diff -u" gets `removed: []` for `p.ts` and `[{ line: 1, text: "m" }]` for `q.ts`; the rest get `removed: []`.

- [ ] **Step 2: Add the failing tests** to the `parseUnifiedDiff` describe:

```ts
test("numbers removed lines from each hunk's -start, with and without an old count", () => {
  const diff = [
    "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts",
    "@@ -3 +3,2 @@", "-gone", "+one", "+two",
    "@@ -10,3 +11,1 @@", " ctx", "-ten", "-eleven", "",
  ].join("\n");
  expect(parseUnifiedDiff(diff).files[0]!.removed).toEqual([
    { line: 3, text: "gone" }, { line: 11, text: "ten" }, { line: 12, text: "eleven" },
  ]);
});

test("a copy with edits is an added file with no removed lines", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/b.ts", "similarity index 90%", "copy from src/a.ts", "copy to src/b.ts",
    "--- a/src/a.ts", "+++ b/src/b.ts", "@@ -1,2 +1,2 @@", " same", "-before", "+after", "",
  ].join("\n");
  expect(parseUnifiedDiff(diff)).toEqual({ files: [{ kind: "A", path: "src/b.ts", added: [{ line: 2, text: "after" }], removed: [] }] });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test packages/cli/test/diff.test.ts`
Expected: FAIL (`removed` missing from every parsed file).

- [ ] **Step 4: Implement.** In `diff.ts`: `HUNK` captures the old start (`/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/`, shifting the later group numbers); `Draft` gains `removed: ChangedLine[]` and the loop keeps `oldLine` beside `newLine`, pushing `{ line: oldLine, text }` for a `-` line and advancing `oldLine` on `-` and context lines; `finish` returns `removed: d.removed` for `M`, `D` and `R`, and `removed: []` for `A` and copies. A deleted file keeps its removed lines and `added: []` as today.

- [ ] **Step 5: Run the CLI suite and typecheck**

Run: `bun test packages/cli && bunx tsc --noEmit`
Expected: PASS, including the two tests that compare a unified diff with a conformance example (the OldPrice example gained its removed lines in Task 2, so both sides agree); `main.test.ts` and `verdicts.test.ts` unaffected.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/diff.ts packages/cli/test/diff.test.ts
git commit -m "cli: keep removed lines from the unified diff"
```

---

### Task 4: CLI selection JSON, text output, docs and version

**Files:**
- Modify: `packages/cli/src/selection.ts:11, 26, 75, 84-89`
- Modify: `packages/cli/src/text.ts:4-28, 41`
- Modify: `packages/cli/README.md:38`, `packages/cli/package.json` (version)
- Modify: `packages/cli/test/fixtures.ts:33-38`
- Test: `packages/cli/test/text.test.ts`, `packages/cli/test/selection.test.ts`, `packages/cli/test/main.test.ts`

**Interfaces:**
- Consumes: `Hit.side` and `ChangedFile.removed` from Task 2.
- Produces: `SelectedRule.hits: { file; line; text; side?: "old" }[]`; `Selection.change[]` entries gain `removed: number[]`.

- [ ] **Step 1: Write the failing tests.** In `selection.test.ts`, a test that `toSelection` carries `side: "old"` on a hit and `removed` line numbers on each change entry, using the fixtures file with the fixture `change` extended so `src/Price.ts` has `removed: [{ line: 4, text: "total * 1.1" }]` and `src/new.ts` has `removed: []`:

```ts
test("old-side hits and removed line numbers pass through", () => {
  const withOld = { ...result, hits: [{ rule: "money-in-minor-units", file: "src/Price.ts", line: 4, text: "total * 1.1", side: "old" as const }] };
  const selection = toSelection(model, withOld, change, sources);
  expect(selection.rules.find((rule) => rule.id === "money-in-minor-units")!.hits).toEqual([{ file: "src/Price.ts", line: 4, text: "total * 1.1", side: "old" }]);
  expect(selection.change.map((file) => file.removed)).toEqual([[4], []]);
});
```

In `text.test.ts`, beside the backticks tests:

```ts
test("an old-side flagged line is marked removed", () => {
  const selection = toSelection(model, { ...result, hits: [{ rule: "money-in-minor-units", file: "src/Price.ts", line: 4, text: "total * 1.1", side: "old" }] }, change, sources);
  expect(renderText(selection)).toContain("- `src/Price.ts:4` (removed) `total * 1.1`\n");
});

test("the flagged-line cap counts both sides", () => {
  const hits = Array.from({ length: 25 }, (_, i) => ({ rule: "money-in-minor-units", file: "src/Price.ts", line: i + 1, text: "x", ...(i % 2 ? { side: "old" as const } : {}) }));
  expect(renderText(toSelection(model, { ...result, hits }, change, sources))).toContain("- and 5 more\n");
});

test("both preambles say a flagged line may be a removed one", () => {
  const selection = toSelection(model, result, change, sources);
  for (const text of [renderText(selection), renderText(selection, "author")]) expect(text).toContain("marked (removed)");
});
```

The `expected/select.md` fixture file keeps its current content: the fixture `change` gains removed lines but the fixture `result` has no old-side hit, and the preamble sentence change below must be applied to `expected/select.md` too.

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/cli/test/selection.test.ts packages/cli/test/text.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement.** In `selection.ts` add `side?: "old"` to the hit type, map it through (`side` only when present), and add `removed: file.removed.map((line) => line.line)` beside `added`. In `text.ts` render an old-side hit as `- ${span(`${hit.file}:${hit.line}`)} (removed) ${span(cut(hit.text))}`; in both preambles, after "A flagged line is a place to look, not a verdict." add the sentence "A flagged line marked (removed) is one the change removed, named by the file's old path." Update `expected/select.md` for the preamble sentence. In `packages/cli/README.md` line 38 add "an old-side hit is marked `(removed)` in text and carries `"side": "old"` in json". Bump `packages/cli/package.json` version to `0.3.0`; leave the README download line naming `cli-v0.2.0` until the release exists.

- [ ] **Step 4: Run the CLI suite, the bundle smoke and the version check**

Run: `bun test packages/cli && bunx tsc --noEmit && bun run --filter @mattstack/lore build && test "$(bun packages/cli/dist/lore.js --version)" = "0.3.0" && echo VERSION_OK`
Expected: PASS and `VERSION_OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "cli: old-side hits and removed line numbers in select output; 0.3.0"
```

---

### Task 5: Language server knows the two keys

**Files:**
- Modify: `packages/language-server/src/docs.ts:18, 39-44`
- Test: `packages/language-server/test/completion.test.ts:103`

**Interfaces:**
- Produces: `WHEN_KEYS` with six entries; `WHEN_DOCS` entries for both.

- [ ] **Step 1: Update the completion test** at line 103 to expect `["addedContains", "addedMatches", "removedContains", "removedMatches", "changed", "unchanged"]`, and add, importing `WHEN_DOCS` from `../src/docs`: `expect(WHEN_DOCS.removedContains).toStartWith("Holds when a removed line")` and the same for `removedMatches`.

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/language-server/test/completion.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement.** `WHEN_KEYS` in spec table order. `WHEN_DOCS.removedContains`: "Holds when a removed line of a counted file contains one of the strings, case-sensitive. In a rule, each such line is a hit on the old side." `WHEN_DOCS.removedMatches`: "Holds when a removed line of a counted file matches one of the patterns in the regex dialect. In a rule, each such line is a hit on the old side."

- [ ] **Step 4: Run the language server suite**

Run: `bun test packages/language-server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/language-server
git commit -m "lsp: complete and document removedContains and removedMatches"
```

---

### Task 6: The writing-lore skill

**Files:**
- Modify: `skills/writing-lore/SKILL.md:55-66`
- Modify: `skills/writing-lore/reference.md:208-246, 544`
- Modify: `skills/writing-lore/tests/rubric.md` (C4)
- Test: the scenario in `skills/writing-lore/tests/scenario.md`, run per superpowers:writing-skills

**Interfaces:**
- Consumes: the built CLI from Task 4 (`bun run --filter @mattstack/lore build`, then `node packages/cli/dist/lore.js`).

- [ ] **Step 1: Rewrite rubric C4** to the new criterion: "C4 Item 6: the removal ORDER is a skill step; the slip (a flag read removed while the definition stays) is a rule with `removedContains: ["isEnabled('"]` and prose that tells the reviewer to check `flags.ts`; not an always-on rule, not an added-line stand-in, and not a rule that encodes step order."

- [ ] **Step 2: Baseline (RED).** Run the scenario with the current skill and the built 0.3.0 CLI, as `scenario.md` describes a GREEN run (skill present, no spec, no README), with a fresh subagent on `sonnet` at `medium` effort. Grade with the rubric. Record in the dispatch report how the agent handled item 6: the expected failure is an always-on rule or a deferral, because the skill's step 2 still says removed lines get no `<when>`.

- [ ] **Step 3: Edit the skill.** In `SKILL.md` step 2, between the "Yes" and "No" branches insert: "**Yes, but only in removed lines** (a deleted fallback, a removed call, a replaced assertion): `<when>` with `removedContains: [...]`, the literal as it appeared in the old code. The reviewer is pointed at the removed line by the file's old path. A replacement takes both conditions, `addedContains` for the new line and `removedContains` for the old one, since every condition must hold." Narrow the "No" branch to "(the slip is something missing, or lives in another file)". In `reference.md` add the two table rows after `addedMatches` ("a removed line of a counted file contains one" and "matches one"), extend the hit bullet with "and each removed line the removed pair finds is a hit on the old side, by the file's old path", extend the empty-list bullet to "the others", and change the `check-needs-file` row's fix to "a regex check, `addedContains` or `removedContains`".

- [ ] **Step 4: Verify (GREEN).** Run the scenario again with the edited skill, same model and CLI. Grade with the rubric. C4 must pass with a `removedContains` rule, and C5, C19 and C18 must still pass. Record the transcript's rule for item 6 in the report.

- [ ] **Step 5: Commit**

```bash
git add skills/writing-lore
git commit -m "skill: write removed-line slips as removedContains"
```

---

### Task 7: Whole-branch verification

**Files:** none new.

- [ ] **Step 1: Run everything CI runs that this branch can affect**

Run: `bun run build && bunx tsc --noEmit && bun test && bun run check`
Expected: all PASS, `bun run check` clean.

- [ ] **Step 2: Scan the tree for forbidden names and dashes** in files this branch touched

Run: `git diff --name-only main...HEAD | xargs grep -nP "\x{2014}|\x{2013}" ; echo "dashes: $?"`
Expected: `dashes: 1` (no match).

- [ ] **Step 3: Confirm the commit list** matches one commit per task above, then stop; the branch is handed to review.
