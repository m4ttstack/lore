# Dropped-Line Conditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `droppedContains` and `droppedMatches` to Lore: a removed line counts only when no added line of the same edit matches the same item. Spec, schema, parser, CLI version, language server and the writing-lore skill.

**Architecture:** Nothing new enters the change model. An edit is derived per changed file from the line numbers the model already carries: a removed or added line's edit is the number of unchanged lines before it. The parser evaluates the two new keys over removed lines, pairing each item against the added lines of the same edit, and reports the lines it finds as ordinary old-side hits. The diff parser, the eligibility result and the CLI's output shape do not change.

**Tech Stack:** TypeScript on bun 1.4.3 (workspace: `packages/parser`, `packages/cli`, `packages/language-server`), `bun test`, JSON Schema 2020-12, the spec's conformance examples run by `packages/parser/test/conformance.test.ts` and `bun run check`, generated fixtures from `bun scripts/fixtures.ts`.

**Spec:** `docs/superpowers/specs/2026-11-06-lore-dropped-lines-design.md`

## Global Constraints

- The keys are `droppedContains` (a list of strings) and `droppedMatches` (a list of patterns in the regex dialect). Their validation, error names and check order are the removed pair's; in the conditions table and in every key list they come directly after `removedMatches`.
- **Edit:** within one changed file, a removed line at old-side line `r` lies after `r - 1 - (count of that file's removed lines numbered below r)` unchanged lines; an added line at new-side line `a` lies after `a - 1 - (count of that file's added lines numbered below a)`. Lines with the same number are in the same edit. A renamed file is one file (removed lines under the old path, added lines under the new path). An edit never spans two files.
- **Dropped:** a removed line of a counted file is found by an item when the line matches the item and no added line of the same edit matches that same item. Pairing is per item and per edit, never line by line. A condition holds when some removed line is found by one of its items. With an empty list it never holds.
- A found line is a hit on the old side with the removed pair's shape: `side: "old"`, the file's old path, the old-side line number, the removed text. At most one hit per rule, side, file and line, also when a rule uses both pairs.
- `removedContains` and `removedMatches` do not change. Every key in a `<when>` must still hold.
- No change to: the change model types, the unified-diff parser, the conformance diff format, `eligibility.schema.json`, the selection JSON shape, the text output, verdict checking, `<check>`.
- The spec stays version 1, status draft. No new error names. `unknown-condition` covers eight keys.
- The CLI package version becomes 0.4.0 on this branch. Tagging and publishing are not part of this plan; the README download line keeps naming `cli-v0.3.0`.
- Public repo: examples use `acme/shop`; no employer, team, product or ticket names anywhere in the tree or in commits. No em or en dashes in prose.
- Commit messages are short and imperative, as the history shows (`spec: ...`, `parser: ...`, `cli: ...`, `lsp: ...`, `skill: ...`), each ending with the trailer the repo's commits carry for the model that made them.
- Never push. The branch `dropped-lines` stays local until the controller opens the pull request.
- Setup, once, before Task 1: `bun install --frozen-lockfile` in the worktree (it has no `node_modules` yet).

## Review Focus

- Lines listed out of order under a file (the conformance diff format allows any order) give the same edits as sorted lines; pinned in Task 2.
- An edit that follows earlier edits of unequal size in the same file is still paired correctly (the offset arithmetic); pinned in Task 2.
- Two removed lines that hold the item and one added line that holds it, in one edit: neither is found. Two items, one added back: found through the other. Pinned in Task 2 and in a conformance example.
- The same change printed at two context widths (one hunk at `-U3`, two hunks at `-U0`) selects the same rules with the same hits; pinned in Task 3.
- A line whose only change is the final line break (`\ No newline at end of file`) is removed and added in one edit, so it is not found; pinned in Task 3.

---

### Task 1: Spec text, schema and README

**Files:**
- Modify: `spec/SPEC.md` (Conditions, lines 3418 to 3503)
- Modify: `spec/schemas/when.schema.json`
- Modify: `README.md:116-123`
- Test: `tests/schemas.test.ts` (beside the test at line 93)

**Interfaces:**
- Produces: the normative text Tasks 2 to 6 implement. No examples yet: they land with the parser in Task 2, because the conformance test runs every example through the parser.

- [ ] **Step 1: Write the failing schema test** in `tests/schemas.test.ts`, after the removed-pair test:

```ts
test("when accepts droppedContains and droppedMatches with the removed pair's item rules", () => {
  expect(checkJson("when", { droppedContains: ["??"], droppedMatches: ["\\?\\?"] })).toBe(true);
  expect(checkJson("when", { droppedContains: [""] })).toBe(false);
  expect(checkJson("when", { droppedContains: ["a\nb"] })).toBe(false);
  expect(checkJson("when", { droppedMatches: [""] })).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/schemas.test.ts`
Expected: FAIL on the new test only.

- [ ] **Step 3: Update `when.schema.json`.** Add `droppedContains` with `removedContains`'s item schema and `droppedMatches` with `removedMatches`'s, directly after `removedMatches`.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test tests/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Edit the spec prose** in the Conditions section. Each edit names the text it changes so it can be found with grep:

1. Conditions table: two rows directly after `removedMatches`:
   - `droppedContains` | A list of strings. | A removed line of a counted file contains one of the strings, and no added line of the same edit contains that string.
   - `droppedMatches` | A list of patterns (see [Regex dialect](#regex-dialect)). | A removed line of a counted file matches one of the patterns, and no added line of the same edit matches that pattern.
2. After the bullet that defines "An **added line's text**, and a **removed line's text**", a new bullet defining an **edit**, carrying the definition in Global Constraints in the spec's own voice: the unchanged lines of a file's old and new versions are the same lines in the same order; a removed line lies after some number of them in the old version and an added line after some number in the new version; an edit is the set of one file's removed and added lines that lie after the same number, so two changed lines are in the same edit when no unchanged line lies between them; the number follows from the line numbers (give both formulas); a renamed file's removed lines, named by its old path, and its added lines, named by its new path, form edits together; a deleted file's edits have no added line; an edit never spans two files.
3. In the same bullet list, the sentence "The added-line conditions see added lines only and the removed-line conditions removed lines only; the unchanged lines around them never count for either." gains: "The dropped-line conditions see removed lines, and added lines only to decide whether the same edit added the item back."
4. After the `removedMatches` bullet ("`addedMatches` searches each line's text ... `removedMatches` does the same over removed lines."), a new bullet: `droppedContains` compares as `removedContains` does and `droppedMatches` searches as `removedMatches` does. Each item is paired on its own: a removed line that matches two items is found when either of them is on no added line of its edit. Pairing is by edit, not line by line: one added line that matches an item keeps every removed line of that edit from being found through that item.
5. "With an empty list, `unchanged` always holds and the other five conditions never do." becomes "the other seven".
6. The hit bullet ("When a rule is eligible, each added line ... and each removed line one of its `removedContains` or `removedMatches` conditions finds is a hit on the old side, named by the file's old path.") gains: "A removed line that a `droppedContains` or `droppedMatches` condition finds is a hit on the old side in the same way."
7. Check order item 4: "one of the six above" becomes "one of the eight above". Item 5: "when an `addedContains` or `removedContains` string is empty" becomes "when an `addedContains`, `removedContains` or `droppedContains` string is empty".
8. A short paragraph of known limits after the hit bullet list, before "A tool checks a `<when>` in this order": an edit that adds the same item for another reason keeps a removal from being found; an edit that keeps the item but changes what it applies to is not found, so a rule about such a change uses the removed pair; a block moved within a file or to another file is found at its old place.

- [ ] **Step 6: Edit `README.md`** Conditions paragraph: after "or in removed lines (`removedContains`, `removedMatches`)" add ", or in removed lines whose text the same edit did not add back (`droppedContains`, `droppedMatches`)", and change "as are the removed lines the removed pair finds" to "as are the removed lines the removed and dropped pairs find".

- [ ] **Step 7: Run the checker and the suites that read the spec**

Run: `bun run check && bun test tests packages/parser/test/conformance.test.ts`
Expected: `bun run check` clean, everything PASSES.

- [ ] **Step 8: Commit**

```bash
git add spec/SPEC.md spec/schemas/when.schema.json README.md tests/schemas.test.ts
git commit -m "spec: droppedContains and droppedMatches, removed lines the edit did not add back"
```

---

### Task 2: Parser: validation, edits, selection, hits and the conformance examples

**Files:**
- Modify: `packages/parser/src/blocks.ts:12, 51-52` (the `CONDITIONS` list and the `contains` / `matches` tests in `checkWhen`)
- Modify: `packages/parser/src/select.ts` (`conditionsHold` 100-128, `compileRegexes` 140-144, the rule branch of `runChecks` 175-185)
- Modify: `spec/SPEC.md` (four new examples in Conditions, after the example that ends near line 3630)
- Modify: every test that cites a spec example by number after the insertion point (find them with `grep -rn "example([0-9]" packages tests tools scripts`), and `test/fixtures` (regenerated)
- Test: `packages/parser/test/blocks.test.ts`, `packages/parser/test/select.test.ts`, `packages/parser/test/conformance.test.ts`

**Interfaces:**
- Consumes: the spec text from Task 1.
- Produces, in `select.ts` (module-private):
  - `function editOf(file: Changed): (side: "added" | "removed", line: ChangedLine) => number`, the number of unchanged lines before a changed line. It must not assume the lines arrive sorted.
  - `function dropped(file: Changed, items: readonly ((text: string) => boolean)[]): ChangedLine[]`, the file's removed lines found by at least one item, in the file's removed-line order.
  - `conditionsHold` and the hit construction both go through `dropped`, so eligibility and hits cannot disagree.

- [ ] **Step 1: Write the failing validation test** in `packages/parser/test/blocks.test.ts`, after the removed-pair test at line 101:

```ts
test("droppedContains and droppedMatches validate like the removed pair", () => {
  expect(checkWhen({ droppedContains: ["??"], droppedMatches: ["\\?\\?"] }, LINE)).toBeNull();
  expect(checkWhen({ droppedContains: [""] }, LINE)).toEqual({ name: "invalid-when", line: LINE });
  expect(checkWhen({ droppedContains: ["a\nb"] }, LINE)).toEqual({ name: "invalid-when", line: LINE });
  expect(checkWhen({ droppedMatches: ["a\nb"] }, LINE)).toEqual({ name: "regex-not-one-line", line: LINE });
  expect(checkWhen({ removedMatches: ["a\nb"], droppedContains: [""] }, LINE)).toEqual({ name: "regex-not-one-line", line: LINE });
});
```

The last assertion pins the check order: `removedMatches` is checked before `droppedContains`.

- [ ] **Step 2: Write the failing selection tests** in `packages/parser/test/select.test.ts`, a new `describe("select: dropped lines", ...)` after `describe("select: removed lines", ...)`, using the file's `repo`, `rule`, `change` and `ALL` helpers:

```ts
const dropped = (id: string, when: string) => repo({ ".lore/a.lore": rule(id, `<when>\n${when}\n</when>\n`) });
const FALLBACK = dropped("fallback-dropped", 'droppedContains: ["??"]');

test("an edit that adds the item back is not found, and the removed pair still is", async () => {
  const edited = change("M a.ts", "-2 const x = y ?? ''", "+2 const x = z ?? ''");
  expect((await select(FALLBACK, edited, ALL)).eligible).toEqual([]);
  expect((await select(dropped("fallback-touched", 'removedContains: ["??"]'), edited, ALL)).eligible).toEqual(["fallback-touched"]);
});

test("an edit that does not add the item back is found, as an old-side hit", async () => {
  const result = await select(FALLBACK, change("M a.ts", "-2 const x = y ?? ''", "+2 const x = y"), ALL);
  expect(result.eligible).toEqual(["fallback-dropped"]);
  expect(result.hits).toEqual([{ rule: "fallback-dropped", file: "a.ts", line: 2, text: "const x = y ?? ''", side: "old" }]);
});

test("an unchanged line between the removed and the added line makes two edits", async () => {
  const input = dropped("guard-dropped", 'droppedContains: ["if (!q)"]');
  const result = await select(input, change("M a.ts", "-3 if (!q) return null", "+4 if (!q) return fallback"), ALL);
  expect(result.hits.map((hit) => hit.line)).toEqual([3]);
  expect((await select(input, change("M a.ts", "-3 if (!q) return null", "+3 if (!q) return fallback"), ALL)).eligible).toEqual([]);
});

test("lines listed in any order give the same edits", async () => {
  expect((await select(FALLBACK, change("M a.ts", "+2 const x = z ?? ''", "-2 const x = y ?? ''"), ALL)).eligible).toEqual([]);
  const result = await select(FALLBACK, change("M a.ts", "+8 const cap = c.cap", "-8 const cap = c.cap ?? 9", "-7 const rate = c.rate ?? 0", "+7 const rate = c.rate"), ALL);
  expect(result.hits.map((hit) => hit.line)).toEqual([7, 8]);
});

test("an edit after earlier edits of unequal size is still paired", async () => {
  expect((await select(FALLBACK, change("M a.ts", "-2 a", "-3 b", "+2 c", "-10 const x = y ?? 0", "+9 const x = z ?? 0"), ALL)).eligible).toEqual([]);
  const result = await select(FALLBACK, change("M a.ts", "-2 a", "-3 b", "+2 c", "-10 const x = y ?? 0", "+9 const x = y"), ALL);
  expect(result.hits.map((hit) => hit.line)).toEqual([10]);
});

test("pairing is by edit, not line by line", async () => {
  const lines = ["M a.ts", "-7 const rate = c.rate ?? 0", "-8 const cap = c.cap ?? 9", "+7 const rate = c.rate ?? 0.05", "+8 const cap = c.cap"];
  expect((await select(FALLBACK, change(...lines), ALL)).eligible).toEqual([]);
});

test("each item is paired on its own", async () => {
  const input = dropped("branch-or-fallback-dropped", "droppedMatches: ['\\?\\?', '^\\s*if \\(']");
  const result = await select(input, change("M a.ts", "-4   if (code ?? fallback) {", "+4   if (code) {"), ALL);
  expect(result.hits).toEqual([{ rule: "branch-or-fallback-dropped", file: "a.ts", line: 4, text: "  if (code ?? fallback) {", side: "old" }]);
  expect((await select(input, change("M a.ts", "-4   if (code ?? fallback) {", "+4   if (code ?? other) {"), ALL)).eligible).toEqual([]);
});

test("a deleted file's matching lines are all found", async () => {
  const result = await select(FALLBACK, change("D legacy/a.ts", "-1 const x = y ?? 0", "-2 const z = 1", "-3 const w = v ?? 1"), ALL);
  expect(result.hits.map((hit) => [hit.file, hit.line])).toEqual([["legacy/a.ts", 1], ["legacy/a.ts", 3]]);
});

test("a renamed file pairs removed lines under the old path with added lines under the new one", async () => {
  const input = repo({ ".lore/a.lore": rule("usd-dropped", "<when>\ndroppedContains: [\"'USD'\"]\n</when>\n") });
  expect((await select(input, change("R legacy/P.tsx -> checkout/P.tsx", "-3 'USD'", "+3 settings.currency ?? 'USD'"), ALL)).eligible).toEqual([]);
  const result = await select(input, change("R legacy/P.tsx -> checkout/P.tsx", "-3 'USD'", "+3 settings.currency"), ALL);
  expect(result.hits.map((hit) => hit.file)).toEqual(["legacy/P.tsx"]);
});

test("a rule with both pairs has one hit per removed line", async () => {
  const input = dropped("both", 'removedContains: ["??"]\ndroppedContains: ["??"]');
  const result = await select(input, change("M a.ts", "-2 const x = y ?? ''", "+2 const x = y"), ALL);
  expect(result.hits).toEqual([{ rule: "both", file: "a.ts", line: 2, text: "const x = y ?? ''", side: "old" }]);
});

test("every condition must hold, and an empty list never does", async () => {
  const gone = change("M a.ts", "-2 const x = y ?? ''", "+2 const x = y");
  expect((await select(dropped("needs-added", 'addedContains: ["parseFloat("]\ndroppedContains: ["??"]'), gone, ALL)).eligible).toEqual([]);
  expect((await select(dropped("empty", "droppedContains: []"), gone, ALL)).eligible).toEqual([]);
});

test("a removed line in a file outside the rule's scope is not found", async () => {
  const input = repo({ "checkout/.lore/a.lore": rule("scoped", '<when>\ndroppedContains: ["??"]\n</when>\n') });
  expect((await select(input, change("M legacy/a.ts", "-2 const x = y ?? ''"), ALL)).eligible).toEqual([]);
});
```

- [ ] **Step 3: Run both files to verify they fail**

Run: `bun test packages/parser/test/blocks.test.ts packages/parser/test/select.test.ts`
Expected: FAIL on the new tests only (the new keys report `unknown-condition`, so the rules are excluded).

- [ ] **Step 4: Implement.** In `blocks.ts`, `CONDITIONS` gains `"droppedContains", "droppedMatches"` after `"removedMatches"`, and `checkWhen`'s `contains` and `matches` tests cover them. In `select.ts`: `editOf` and `dropped` as in Interfaces; `conditionsHold` gains the two cases (`counted.some((file) => dropped(file, tests).length > 0)`, one test function per item); `compileRegexes` also compiles `droppedMatches`; the rule branch of `runChecks` records `hit(entry.id, file.oldPath, line, "old")` for every line `dropped` returns for the entry's `droppedContains` and `droppedMatches` items together, skipping files whose `oldPath` is null.

- [ ] **Step 5: Run to verify they pass**

Run: `bun test packages/parser/test/blocks.test.ts packages/parser/test/select.test.ts`
Expected: PASS

- [ ] **Step 6: Add four conformance examples** to `spec/SPEC.md`, in Conditions, directly after the example whose rule is `fallback-kept`. Each gets one or two sentences of lead-in prose in the spec's voice saying what it shows.

Example A (an edit that adds the item back, an edit that does not, and the removed pair beside it):

``````
=== apps/web/src/checkout/.lore/reads.lore
<rule id="fallback-dropped" category="functional_correctness">
<when>
droppedContains: ["??"]
</when>
A read of an optional field keeps its `??` fallback.
</rule>

<rule id="fallback-touched" category="functional_correctness">
<when>
removedContains: ["??"]
</when>
A change to a line with a `??` fallback keeps the default it had.
</rule>
=== diff
M apps/web/src/checkout/Price.tsx
-2   const label = quote.label ?? ''
+2   const label = quote.title ?? ''
M apps/web/src/checkout/Total.tsx
-5   const tax = quote.tax ?? 0
+5   const tax = quote.tax
=== expect
{
  "eligible": ["fallback-dropped", "fallback-touched"],
  "hits": [
    { "rule": "fallback-dropped", "file": "apps/web/src/checkout/Total.tsx", "line": 5, "text": "  const tax = quote.tax ?? 0", "side": "old" },
    { "rule": "fallback-touched", "file": "apps/web/src/checkout/Price.tsx", "line": 2, "text": "  const label = quote.label ?? ''", "side": "old" },
    { "rule": "fallback-touched", "file": "apps/web/src/checkout/Total.tsx", "line": 5, "text": "  const tax = quote.tax ?? 0", "side": "old" }
  ],
  "excluded": [],
  "warnings": []
}
``````

Example B (an unchanged line between makes two edits; touching lines make one):

``````
=== apps/web/src/checkout/.lore/guards.lore
<rule id="guard-dropped" category="functional_correctness">
<when>
droppedContains: ["if (!quote)"]
</when>
A component keeps its guard for a missing quote.
</rule>
=== diff
M apps/web/src/checkout/Cart.tsx
-3   if (!quote) return null
+3   if (!quote) return <Empty />
M apps/web/src/checkout/Summary.tsx
-3   if (!quote) return null
+4   if (!quote) return <Empty />
=== expect
{
  "eligible": ["guard-dropped"],
  "hits": [
    { "rule": "guard-dropped", "file": "apps/web/src/checkout/Summary.tsx", "line": 3, "text": "  if (!quote) return null", "side": "old" }
  ],
  "excluded": [],
  "warnings": []
}
``````

Example C (`droppedMatches`; each item paired on its own; pairing by edit, not line by line):

``````
=== apps/web/src/checkout/.lore/branches.lore
<rule id="branch-or-fallback-dropped" category="functional_correctness">
<when>
droppedMatches: ['\?\?', '^\s*if \(']
</when>
A cleanup keeps the branches and fallbacks that still do something.
</rule>
=== diff
M apps/web/src/checkout/Coupon.tsx
-7   const rate = coupon.rate ?? 0
-8   const cap = coupon.cap ?? Infinity
+7   const rate = coupon.rate ?? 0.05
+8   const cap = coupon.cap
M apps/web/src/checkout/Discount.tsx
-4   if (code ?? defaultCode) {
+4   if (code) {
=== expect
{
  "eligible": ["branch-or-fallback-dropped"],
  "hits": [
    { "rule": "branch-or-fallback-dropped", "file": "apps/web/src/checkout/Discount.tsx", "line": 4, "text": "  if (code ?? defaultCode) {", "side": "old" }
  ],
  "excluded": [],
  "warnings": []
}
``````

The lead-in for C says plainly that line 8 of `Coupon.tsx` lost its fallback and is still not found, because line 7 of the same edit adds `??`.

Example D (a deleted file, and a rename whose edit adds the item back under the new path):

``````
=== apps/web/src/.lore/currency.lore
<rule id="currency-literal-dropped" category="functional_correctness">
<when>
droppedContains: ["'USD'"]
</when>
Removing a hard-coded currency also removes what depended on it.
</rule>
=== diff
D apps/web/src/legacy/Price.tsx
-3 const currency = 'USD'
R apps/web/src/legacy/Total.tsx -> apps/web/src/checkout/Total.tsx
-6 const currency = 'USD'
+6 const currency = settings.currency ?? 'USD'
=== expect
{
  "eligible": ["currency-literal-dropped"],
  "hits": [
    { "rule": "currency-literal-dropped", "file": "apps/web/src/legacy/Price.tsx", "line": 3, "text": "const currency = 'USD'", "side": "old" }
  ],
  "excluded": [],
  "warnings": []
}
``````

In the spec each block opens with six backticks followed by `example eligibility` and closes with six backticks, as its neighbours do.

- [ ] **Step 7: Renumber and regenerate.** Four new examples shift every later example number by four. Confirm the new numbers with `extractExamples` from `tools/check/extract.ts` (do not trust a count from this plan), update every `example(<n>)` citation the grep in Files finds, then run `bun scripts/fixtures.ts`.

- [ ] **Step 8: Run the conformance suite, the checker and the generated-files check**

Run: `bun test packages/parser tests scripts && bun run check && git status --short test/fixtures | head -5`
Expected: all PASS, `bun run check` clean, and `test/fixtures` shows the regenerated entries as modified or added (they are committed in the next step).

- [ ] **Step 9: Commit**

```bash
git add packages/parser spec/SPEC.md test/fixtures
git add -u packages tests tools scripts
git commit -m "parser: droppedContains and droppedMatches pair removed lines with their edit"
```

---

### Task 3: CLI: proof through real diffs, docs and version

**Files:**
- Modify: `packages/cli/README.md:38` (the Output paragraph), `packages/cli/package.json` (version)
- Test: `packages/cli/test/diff.test.ts` (or a new `packages/cli/test/dropped.test.ts` if that reads better beside it)

**Interfaces:**
- Consumes: `parseUnifiedDiff(text: string): Change` from `packages/cli/src/diff.ts` (unchanged) and `select` from `@lore/parser`.
- Produces: no source change in `packages/cli/src`. If a test below fails, the defect is in Task 2's code or in the diff parser; report it, do not work around it in the test.

- [ ] **Step 1: Write the tests.** One rule, `droppedContains: ["??"]`, in an input built as `packages/parser/test/select.test.ts` builds its `repo(...)`. Each test parses a unified diff with `parseUnifiedDiff` and runs `select` on the result.

```ts
const INPUT: LoreInput = { repo: [{ path: ".lore/a.lore", content: '<rule id="fallback-dropped" category="functional_correctness">\n<when>\ndroppedContains: ["??"]\n</when>\nA rule.\n</rule>\n' }], given: [], remotes: ["https://github.com/acme/shop"] };
const ALL: SelectOptions = { capabilities: ["regex"] };
const HEADER = ["diff --git a/src/a.ts b/src/a.ts", "index 111..222 100644", "--- a/src/a.ts", "+++ b/src/a.ts"];
// One file, two edits: line 2 keeps its fallback, line 6 loses it.
const WIDE = [...HEADER, "@@ -1,7 +1,7 @@", " one", "-const a = x ?? 0", "+const a = y ?? 0", " three", " four", " five", "-const b = z ?? 1", "+const b = z", " seven"].join("\n");
const NARROW = [...HEADER, "@@ -2 +2 @@", "-const a = x ?? 0", "+const a = y ?? 0", "@@ -6 +6 @@", "-const b = z ?? 1", "+const b = z"].join("\n");

test("the same change at two context widths selects the same hits", async () => {
  const wide = await select(INPUT, parseUnifiedDiff(WIDE), ALL);
  const narrow = await select(INPUT, parseUnifiedDiff(NARROW), ALL);
  expect(wide.hits).toEqual([{ rule: "fallback-dropped", file: "src/a.ts", line: 6, text: "const b = z ?? 1", side: "old" }]);
  expect(narrow).toEqual(wide);
});

test("a line that only gains its final line break is not found", async () => {
  const diff = [...HEADER, "@@ -3 +3 @@", "-const a = x ?? 0", "\\ No newline at end of file", "+const a = x ?? 0"].join("\n");
  expect((await select(INPUT, parseUnifiedDiff(diff), ALL)).eligible).toEqual([]);
});

test("a rename with an edit pairs across the two paths", async () => {
  const diff = ["diff --git a/src/old.ts b/src/new.ts", "similarity index 80%", "rename from src/old.ts", "rename to src/new.ts", "--- a/src/old.ts", "+++ b/src/new.ts", "@@ -2 +2 @@", "-const a = x ?? 0", "+const a = y ?? 0"].join("\n");
  expect((await select(INPUT, parseUnifiedDiff(diff), ALL)).eligible).toEqual([]);
});
```

- [ ] **Step 2: Run them**

Run: `bun test packages/cli/test`
Expected: PASS. These tests pin behavior Task 2 built; a failure is a finding.

- [ ] **Step 3: Docs and version.** In `packages/cli/README.md`, extend the sentence "An old-side hit is marked `(removed)` in text and carries `"side": "old"` in json." with "A line a dropped-line condition finds is such a hit." Bump `packages/cli/package.json` to `0.4.0`.

- [ ] **Step 4: Run the CLI suite, the type check, the bundle and the version check**

Run: `bun test packages/cli && bunx tsc --noEmit && bun run --filter @mattstack/lore build && test "$(bun packages/cli/dist/lore.js --version)" = "0.4.0" && echo VERSION_OK`
Expected: PASS and `VERSION_OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "cli: dropped-line conditions hold at any context width; 0.4.0"
```

---

### Task 4: Language server knows the two keys

**Files:**
- Modify: `packages/language-server/src/docs.ts:18, 40-45`
- Test: `packages/language-server/test/completion.test.ts:104`

**Interfaces:**
- Produces: `WHEN_KEYS` with eight entries in spec table order; `WHEN_DOCS.droppedContains` and `WHEN_DOCS.droppedMatches`.

- [ ] **Step 1: Update the completion test** to expect `["addedContains", "addedMatches", "removedContains", "removedMatches", "droppedContains", "droppedMatches", "changed", "unchanged"]`, and add `expect(WHEN_DOCS.droppedContains).toContain("no added line of the same edit")` and the same for `droppedMatches`.

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/language-server/test/completion.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement.** `WHEN_DOCS.droppedContains`: "Holds when a removed line of a counted file contains one of the strings, case-sensitive, and no added line of the same edit contains that string. In a rule, each such line is a hit on the old side." `WHEN_DOCS.droppedMatches`: "Holds when a removed line of a counted file matches one of the patterns in the regex dialect, and no added line of the same edit matches that pattern. In a rule, each such line is a hit on the old side."

- [ ] **Step 4: Run the language server suite**

Run: `bun test packages/language-server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/language-server
git commit -m "lsp: complete and document droppedContains and droppedMatches"
```

---

### Task 5: The skill scenario gains a deleted-construct trap

**Files:**
- Modify: `skills/writing-lore/tests/source-skill.md` (a new item after item 7)
- Modify: `skills/writing-lore/tests/rubric.md` (C4 clarified, a new criterion)

**Interfaces:**
- Produces: the failing test for Task 6. The controller, not the implementer, runs the scenario (implementers do not dispatch subagents).

Load `superpowers:writing-skills` before editing; these files are the skill's tests.

- [ ] **Step 1: Add the trap to `source-skill.md`** as item 8, in the source skill's own voice (a review checklist for a storefront's checkout code, under `apps/web/src/checkout`):

```markdown
## 8. Optional amounts keep their fallback `[BLOCKING]`

A read of an optional amount (`quote.tax ?? 0`, `line.discount ?? 0`) keeps its `?? 0`. The slip is a cleanup that deletes the fallback, so a missing amount reaches the total as `undefined`. A line that is edited and still has its `?? 0` is fine.
```

- [ ] **Step 2: Update `rubric.md`.** Append to C4: "It stays `removedContains`, not a dropped-line condition: an edit that reads a different flag adds `isEnabled('` back and is still the slip." Add, under a new heading "Refactor round 2 (dropped-line conditions)":

```markdown
- C20 Item 8: the deleted fallback is a rule scoped inside what the source governs, with `droppedContains` (or `droppedMatches`) on the fallback, because an edited line that keeps its fallback is not the slip; not `removedContains`, which selects the rule on every such edit, and not an always-on rule.
```

- [ ] **Step 3: Commit**

```bash
git add skills/writing-lore/tests
git commit -m "skill: scenario trap for a deleted fallback"
```

- [ ] **Step 4 (controller): Baseline run (RED).** Build the CLI (`bun run --filter @mattstack/lore build`). Run the scenario in `scenario.md` as a GREEN-style run (the current skill present, no spec, no README) with a fresh agent on `sonnet` at `medium` effort, `LORE` being `node <worktree>/packages/cli/dist/lore.js`. Grade item 8 against C20. Expected: C20 fails (the current skill teaches only the removed pair). Record the rule the agent wrote for item 8.

---

### Task 6: The writing-lore skill teaches the dropped pair

**Files:**
- Modify: `skills/writing-lore/SKILL.md` (step 3, the "Yes, but only in removed lines" branch and item 3; the common-mistakes table)
- Modify: `skills/writing-lore/reference.md:208-250` (condition table, bullets), and the diagnostics row near line 551 if it lists the line conditions

**Interfaces:**
- Consumes: the trap and rubric from Task 5; the built CLI from Task 3.

Load `superpowers:writing-skills` before editing. Keep the skill's voice and length: this is one branch and one question, not a new section.

- [ ] **Step 1: Edit `SKILL.md`.** In step 3 item 2, the removed-lines branch becomes two cases decided by one question, "can an edited line that still matches the item ever be the slip?":
  - never (a deleted fallback, a deleted branch): `droppedContains`, the literal as it appeared in the old code. A removed line counts only when the same edit adds no line with that literal, so a rename or a reformat of the line does not select the rule.
  - it can (a replaced assertion, a call whose argument is swapped, such as an `isEnabled('` read that now reads another flag): `removedContains`, with `addedContains` too when the slip is a replacement, since every condition must hold.
  In item 3, `droppedMatches` joins `removedMatches` for a slip only in removed lines, and the sentence about alternatives gains "nor are `droppedContains` and `droppedMatches`". In the common-mistakes table add the row: "`removedContains` on a common construct, selected by every edit of such a line" | "`droppedContains`, when an edited line that keeps the construct is never the slip".

- [ ] **Step 2: Edit `reference.md`.** Two table rows after `removedMatches` ("a removed line of a counted file contains one, and no added line of the same edit contains it" and the `Matches` twin). After the counted-files paragraph, the definition of an edit in two sentences (changed lines of one file with no unchanged line between them; a renamed file is one file). In the bullets: the hit bullet names the dropped pair beside the removed pair; a new bullet with a checked example (a two-line diff that edits a fallback and one that deletes it, with which is found) and the two limits an author must know (an edit that adds the item for another reason hides the removal; pairing is by edit, not line by line). Every example in the reference must be run through the built CLI before it is written down.

- [ ] **Step 3: Commit**

```bash
git add skills/writing-lore/SKILL.md skills/writing-lore/reference.md
git commit -m "skill: write deleted-construct slips as droppedContains"
```

- [ ] **Step 4 (controller): Verify run (GREEN).** Run the scenario again with the edited skill, same model, effort and CLI. Grade with the rubric. C20 must pass with a dropped-pair rule for item 8; C4 must still pass with `removedContains` for item 6; C5, C18 and C19 must still pass. If C20 or C4 fails, the finding goes back to this task's implementer with the agent's rule quoted.

---

### Task 7: Whole-branch verification

**Files:** none new.

- [ ] **Step 1: Run what CI runs, in CI's order** (`.github/workflows/ci.yml`), up to and including `bun run check`:

Run: `bun install --frozen-lockfile && (cd packages/tree-sitter-lore && bunx tree-sitter generate) && bun scripts/fixtures.ts && git diff --exit-code -- packages/tree-sitter-lore/src test/fixtures && bun run build && bunx tsc --noEmit && bun test && bun run check && echo CI_MIRROR_OK`
Expected: `CI_MIRROR_OK`. A non-empty generated-files diff means fixtures were not regenerated and committed in Task 2.

- [ ] **Step 2: Bundle smoke with a dropped-line rule.** In a scratch directory outside the repo, write a rules folder with one rule using `droppedContains: ["??"]` and a `.loreconfig` with `repo: github.com/acme/shop`, and two diffs (an edit that keeps `??`, an edit that deletes it). Run `node packages/cli/dist/lore.js select --no-repo --given <folder> --remote https://github.com/acme/shop --diff <file> --format json --strict` on each.
Expected: the first selects nothing; the second selects the rule with one hit carrying `"side": "old"`; both exit 0.

- [ ] **Step 3: Scan files this branch touched for dashes**

Run: `git diff --name-only origin/main...HEAD | xargs grep -nP "\x{2014}|\x{2013}" ; echo "dashes: $?"`
Expected: `dashes: 1` (no match).

- [ ] **Step 4: Confirm the commit list** (the two docs commits, then one commit per task 1 to 6), then stop; the branch is handed to the final review.
