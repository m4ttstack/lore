# Checked Rule Sources and Review Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rule names its sources in a `<source>` YAML block; `lore audit` reports sources that no longer resolve or that changed since review; `lore review` records a review in a tool-written lock file.

**Architecture:** The parser package owns everything two tools must agree on: the block, the `sources` model field, heading matching, fingerprints, the lock file format, the `audit` config key and the finding computation, all pinned by spec examples (a new `audit` example kind). The CLI owns reading files from disk and git, the two commands, their output and exit codes. Editor packages learn the block's name only.

**Tech Stack:** TypeScript on Bun (tests with `bun:test`), the `yaml` package, `node:crypto` for SHA-256, tree-sitter for the grammar.

**Spec:** `docs/superpowers/specs/2026-11-12-lore-sources-and-reviews-design.md`

## Global Constraints

- The format stays `lore: 1`. No new syntax: `<source>` is a structured block read by `readBlock`, as `<scope>` and `<when>` are.
- `<meta>` keeps no reserved keys. No code reads `meta.source` except the `meta-source` finding, which only notes its presence.
- No command rewrites a `.lore` file. Only `lore review` writes `lore-reviews.lock`.
- Parsing never reads a cited file. `lore select` and `lore check` text output does not change.
- Finding names and default levels, exactly: `source-missing` error, `source-unchecked` error, `ambiguous-heading` warn, `source-changed` warn, `never-reviewed` warn, `review-overdue` warn, `orphan-review` warn, `meta-source` off.
- Fingerprint: first 12 hex characters of SHA-256 over normalized UTF-8 text (LF line endings, trailing whitespace per line removed, runs of blank lines collapsed to one, leading and trailing blank lines removed).
- Lock file: `lore-reviews.lock` in the Lore root's directory, JSON Lines, first line `{"lore-reviews":1}`, records sorted by rule, file, heading, phrase, with keys in the order `rule, file, heading, phrase, reviewed, hash`.
- Exit codes: 0, 1, 2 (usage or input), 70 (internal), as the other commands use them.
- No em dashes or en dashes anywhere. The repository is public: examples use the shop and checkout names the specification uses, and nothing from `private/` is read or copied.
- Comments only where they state a constraint the code cannot show.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Before each commit, run the CI mirror for what the task touched: `bun scripts/fixtures.ts` then `git diff --exit-code -- test/fixtures` must be clean after committing the regenerated fixtures; `bunx tsc --noEmit`; `bun test`; `bun run check`. Adding a spec example renumbers `test/fixtures`; commit the regenerated files with the task.

## Review Focus

- A source `file` with a leading `/` in a Lore file whose base is not the repo root, in an external folder, and in a loose folder: each resolves from the right root (Task 2).
- A heading that appears twice, a heading inside a fenced code block, and a heading with a closing `#` run: the first real heading wins and the fenced one is ignored (Task 4).
- A lock file with a record for a rule that moved to another Lore folder under the same Lore root: the record still applies, no orphan and no `never-reviewed` (Task 6).
- `lore review` on two rules where one has a broken source: the good rule is written, the bad rule's old records are untouched, exit 1 (Task 8).
- `lore audit --no-repo` with a given folder: governed-repo sources are `source-unchecked`, file-relative ones are checked, exit 1 by default (Task 7).

---

### Task 1: `sources` on every entry

Adds the empty field everywhere so later tasks change behavior without touching 60 examples again.

**Files:**
- Modify: `packages/parser/src/types.ts`, `packages/parser/src/entries.ts`
- Modify: `spec/SPEC.md` (every `parse` example's entries, Document model, Entry fields), `spec/schemas/document-model.schema.json`
- Modify: `packages/cli/src/selection.ts`, `packages/cli/test/expected/select.md` only if JSON appears there
- Test: `packages/parser/test/entries.test.ts`, the conformance suite

**Interfaces:**
- Produces: `export interface Source { file: string; heading: string | null; phrase: string | null }` and `Entry.sources: Source[]` in `types.ts`; `SelectedRule.sources: Source[]` in the CLI's JSON (after `meta`).

- [ ] **Step 1:** In `entries.test.ts`, add `test("an entry without a source block has sources: []")` asserting `entry.sources` equals `[]` for a rule and for a context. Run `bun test packages/parser/test/entries.test.ts`; it fails on the missing property.
- [ ] **Step 2:** Add `Source` and `sources` to `types.ts`; set `sources: []` in `readEntry`.
- [ ] **Step 3:** Add `"sources": []` after `"src"` in every entry of every `parse` example in `spec/SPEC.md` (a one-off script is fine; do not commit it). Add `sources` to `document-model.schema.json` as a required array of objects with required `file` (string), `heading` and `phrase` (string or null), `additionalProperties: false`. Add the field to the Entry fields table.
- [ ] **Step 4:** Add `sources: entry.sources` to `selectedRule` in `selection.ts` and to the `SelectedRule` interface; update the CLI tests that compare whole rule objects.
- [ ] **Step 5:** `bun scripts/fixtures.ts && bunx tsc --noEmit && bun test && bun run check`. All pass.
- [ ] **Step 6:** Commit: `parser: add sources to the document model`.

### Task 2: The `<source>` block

**Files:**
- Modify: `packages/parser/src/blocks.ts`, `packages/parser/src/entries.ts`
- Modify: `spec/SPEC.md` (Children table and rules, new "Sources" section after "Checks" with "File paths", Errors and warnings, Error reach), `spec/errors.json`
- Create: `spec/schemas/source.schema.json`
- Test: `packages/parser/test/entries.test.ts`, new spec `parse` examples

**Interfaces:**
- Consumes: `Source`, `FileContext`, `resolveSrc` (entries.ts), `readBlock`.
- Produces: `checkSource(value: unknown, line: number): BlockProblem | null` in `blocks.ts` (shape only: a mapping or non-empty list of mappings; keys `file`, `heading`, `phrase`; non-empty strings; `heading` only when `file` ends `.md`, `.mdx` or `.markdown`). `resolveSourceFile(value: string, lorePath: string, file: FileContext): { path: string } | { problem: "invalid-source" }` in `entries.ts`. `FileContext` gains `repoPrefix: string` if the existing `prefix` does not already give the root a leading `/` resolves from (read `model.ts` where `FileContext` is built to decide).

- [ ] **Step 1: Failing tests** in `entries.test.ts`, one per row:

| Test | Input | Expect |
|---|---|---|
| a mapping source | `file: docs/review.md`, `heading: Money` in `apps/web/.lore/a.lore` | `sources` is `[{ file: "apps/web/docs/review.md", heading: "Money", phrase: null }]` |
| a list keeps order | two items | two sources in written order |
| leading slash is the repo root | `file: /docs/review.md` in `apps/web/.lore/a.lore` | `file: "docs/review.md"` |
| file-relative | `file: ./notes.md` in `apps/web/.lore/a.lore` | `file: "apps/web/.lore/notes.md"` |
| escapes the Lore root | `file: ../../../x.md` at a root base | error `invalid-source` |
| empty list, scalar, unknown key, missing file, empty file, non-string value | each | error `invalid-source` at the child's opening tag line |
| heading on a non-Markdown file | `file: src/a.ts`, `heading: X` | `invalid-source` |
| two items resolving to the same file, heading and phrase | `docs/x.md` and `/docs/x.md` at a root base | `invalid-source` |
| attribute on the block | `<source lang="x">` | `unknown-attribute` |
| second block | two `<source>` children | `duplicate-child` |
| on a context | `<source>` inside `<context>` | `unknown-child` |

- [ ] **Step 2:** Run them; they fail with `unknown-child`.
- [ ] **Step 3:** Implement. Add `"source"` to `RULE_CHILDREN` (not to the context's set) and treat it as single. In `readChild`, route `source` to `checkSource`. In `readEntry`, normalize the value to a list, resolve each `file` (leading `/` strips the slash and resolves from the repo root, or the external folder's `repo` root, or the loose folder; otherwise reuse the `src` rules, mapping both `src` problems to `invalid-source`), then reject duplicates by resolved file, heading and phrase.
- [ ] **Step 4:** Run the tests; they pass.
- [ ] **Step 5: Spec.** Write the "Sources" section from the design's "The `<source>` block" and "File paths", with `parse` examples covering: a mapping, a list, a leading `/` from a nested base, a file-relative path, an external folder (`external:` prefix), a loose folder, and one example per `invalid-source` cause. Add `<source>` to the Children table (`0 or 1`), `invalid-source` to Errors and warnings and `errors.json` ("A source block fails its schema."), and to Error reach as entry-level. Add `source.schema.json` (`oneOf` a mapping or `minItems: 1` array of it).
- [ ] **Step 6:** `bun scripts/fixtures.ts && bunx tsc --noEmit && bun test && bun run check`.
- [ ] **Step 7:** Commit: `spec, parser: add the source block`.

### Task 3: The `audit` config key

**Files:**
- Modify: `packages/parser/src/loreconfig.ts`, `packages/parser/src/collect.ts`
- Modify: `spec/SPEC.md` (.loreconfig table and a new "Audit settings" subsection), `spec/schemas/loreconfig.schema.json`
- Test: `packages/parser/test/loreconfig.test.ts`, `packages/parser/test/collect.test.ts`

**Interfaces:**
- Produces, exported from `packages/parser/src/index.ts`:
  - `export const FINDINGS = ["source-missing", "source-unchecked", "ambiguous-heading", "source-changed", "never-reviewed", "review-overdue", "orphan-review", "meta-source"] as const`
  - `export type FindingName = (typeof FINDINGS)[number]`, `export type Level = "error" | "warn" | "off"`
  - `export const DEFAULT_LEVELS: Readonly<Record<FindingName, Level>>` (values in Global Constraints)
  - `export interface AuditConfig { maxAgeDays?: number; levels: Partial<Record<FindingName, Level>> }`; `LoreConfig.audit: AuditConfig | null`; `ConfigFile.audit: AuditConfig | null`
  - `export interface AuditSettings { maxAgeDays: number | null; levels: Record<FindingName, Level> }`
  - `export function auditSettingsFor(collected: Collected, dir: string, repository: Repository, loreRoot: string): AuditSettings`: each of `maxAgeDays` and each finding's level comes from the nearest config that sets it, walking up from `dir` to `loreRoot`; unset means the default.

- [ ] **Step 1: Failing tests.** `readLoreconfig`: accepts `audit: { maxAgeDays: 180, levels: { source-changed: error } }`; rejects (problem at the `audit` key's line) `maxAgeDays: 0`, `maxAgeDays: 1.5`, `maxAgeDays: "180"`, an unknown key under `audit`, an unknown finding name, a level of `fatal`, and `audit: []`. `auditSettingsFor`: with a root config `{ maxAgeDays: 180, levels: { never-reviewed: off } }` and `apps/web/.loreconfig` `{ levels: { source-changed: error } }`, a rule under `apps/web` gets `maxAgeDays: 180`, `never-reviewed: off`, `source-changed: error`, and every other level at its default; a config above the Lore root is not consulted.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement the `audit` case in `readLoreconfig`, carry it through `readConfigs` into `ConfigFile`, and write `auditSettingsFor` using the existing `applying` walk.
- [ ] **Step 4:** Run; pass.
- [ ] **Step 5: Spec.** Add the `audit` row to the `.loreconfig` table, the "Audit settings" subsection with the per-setting lookup, two `parse` examples (a valid key; an invalid one giving `invalid-loreconfig`), and the schema.
- [ ] **Step 6:** CI mirror, then commit: `spec, parser: add the audit settings key`.

### Task 4: Matching and fingerprints

**Files:**
- Create: `packages/parser/src/sources.ts`
- Test: `packages/parser/test/sources.test.ts`

**Interfaces:**
- Produces, exported from the package index:
  - `export function slug(text: string): string`
  - `export function normalizeText(text: string): string`
  - `export function fingerprint(text: string | Uint8Array): string` (a string is normalized first; bytes are hashed as given)
  - `export type SourceContent = string | Uint8Array | null` (text, bytes that are not UTF-8, or no such file)
  - `export type Resolved = { ok: true; hash: string; ambiguous: boolean } | { ok: false; reason: "file" | "heading" | "phrase" }`
  - `export function resolveSource(source: Source, content: SourceContent): Resolved`

- [ ] **Step 1: Failing tests** in `sources.test.ts`:
  - `slug("Money is integer minor units")` is `"money-is-integer-minor-units"`; `slug("Display casing (names, vehicles)")` is `"display-casing-names-vehicles"`; `slug("snake_case and kebab-case")` is `"snake_case-and-kebab-case"`.
  - With `DOC = "# Review\n\nIntro.\n\n## Money is integer minor units\n\nAmounts are cents.\n\n## Dates\n\nUse UTC.\n"`:
    - `{ file, heading: "Money is integer minor units" }` resolves ok with hash `a18621abaaba`, and the same for `heading: "money-is-integer-minor-units"`.
    - `{ file }` alone gives hash `1c389287cfa9`.
    - `{ file, phrase: "Amounts are   cents." }` gives `a18621abaaba` (whitespace collapsed; nearest heading above).
    - `{ file, phrase: "Intro." }` gives the hash of the `# Review` section, which is the whole file: `1c389287cfa9`.
    - `{ file, heading: "Dates", phrase: "Amounts" }` is `{ ok: false, reason: "phrase" }`.
    - `{ file, heading: "Nope" }` is `{ ok: false, reason: "heading" }`.
  - CRLF line endings, trailing spaces and doubled blank lines in `DOC` give the same hashes.
  - A document with `## Dates` twice resolves the first and sets `ambiguous: true`.
  - A `## Dates` line inside a ``` fenced block is not a heading. `## Dates ##` matches `Dates`.
  - A section ends at the next heading of the same or a higher level: with `## A`, `### A1`, `## B`, the section of `A` includes `A1` and stops before `B`.
  - `"export function fromCents(n: number) {\n  return n;\n}\n"` with `{ file: "src/money.ts", phrase: "export function fromCents(" }` gives `5d622ccf21ca`.
  - `content: null` is `{ ok: false, reason: "file" }`. A `Uint8Array` with `{ file }` only is ok with the SHA-256 of the bytes; with a `phrase` it is `{ ok: false, reason: "phrase" }`.
  - A phrase match is case-sensitive.
- [ ] **Step 2:** Run; fail (module missing).
- [ ] **Step 3:** Implement with `node:crypto` `createHash("sha256")`. Reuse `opensFence` / `closesFence` from `scan.ts` only if their rules match Markdown fences; otherwise scan fences locally.
- [ ] **Step 4:** Run; pass. `bunx tsc --noEmit`.
- [ ] **Step 5:** Commit: `parser: match headings and phrases and fingerprint a source`.

### Task 5: The lock file format

**Files:**
- Create: `packages/parser/src/reviews.ts`
- Test: `packages/parser/test/reviews.test.ts`

**Interfaces:**
- Produces, exported from the package index:
  - `export const LOCK_NAME = "lore-reviews.lock"`
  - `export interface ReviewRecord { rule: string; file: string; heading: string | null; phrase: string | null; reviewed: string; hash: string }`
  - `export function readReviews(content: string): { records: ReviewRecord[] } | { problem: string; line: number }`
  - `export function writeReviews(records: readonly ReviewRecord[]): string`
  - `export function sameSource(record: ReviewRecord, rule: string, source: Source): boolean`

- [ ] **Step 1: Failing tests:** `writeReviews` output starts with `{"lore-reviews":1}\n`, ends with one line feed, sorts by rule then file then heading then phrase (null first, then by code point), and writes keys in the fixed order; `readReviews(writeReviews(x))` returns `x` sorted; `writeReviews([])` is the header line only. `readReviews` reports a problem with its line for: an empty file, a wrong header (`{"lore-reviews":2}`), a line that is not JSON, a record with a missing or extra key, a `reviewed` that is not `YYYY-MM-DD` or not a real date (`2026-02-30`), a `hash` that is not 12 lower-case hex characters, and two records for the same rule and source. A blank line is a problem.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; pass.
- [ ] **Step 5:** Commit: `parser: read and write the review lock file`.

### Task 6: The audit computation and the `audit` example kind

**Files:**
- Create: `packages/parser/src/audit.ts`
- Modify: `tools/check/extract.ts`, `tools/check/check.ts`, `packages/parser/test/harness.ts`, `packages/parser/test/conformance.test.ts`, `scripts/fixtures.ts`
- Modify: `spec/SPEC.md` (Conformance examples; new top-level section "Auditing sources" after "Eligibility": Matching inside the file, Fingerprints, The lock file, Findings), `spec/errors.json` only if the checker requires finding names there (it should not: findings are not parse errors)
- Create: `spec/schemas/audit.schema.json`
- Test: `packages/parser/test/audit.test.ts`

**Interfaces:**
- Consumes: `parseWithContext` and `EntryPlace` (model.ts), `auditSettingsFor`, `resolveSource`, `readReviews`, `sameSource`.
- Produces, exported from the package index:
  - `export interface Finding { name: FindingName; level: "error" | "warn"; rule: string | null; file: string; source: Source | null; reason: string | null }` (`file` is the rule's Lore file, or the lock file for `orphan-review`)
  - `export interface AuditResult { findings: Finding[]; summary: { counts: Partial<Record<FindingName, number>>; rulesWithSource: number; rulesWithoutSource: number }; excluded: Diagnostic[] }`
  - `export interface AuditOptions { today: string; readSource(place: EntryPlace, file: string): SourceContent | undefined; locks: ReadonlyMap<string, ReviewRecord[]>; maxAgeDays?: number; levels?: Partial<Record<FindingName, Level>> }` (`readSource` returns `undefined` when the files could not be looked at; `locks` is keyed by the lock file's path with its tree prefix)
  - `export function lockPathFor(place: EntryPlace, entry: Entry): string`
  - `export function audit(parsed: ParsedInput, options: AuditOptions): AuditResult`
- Findings at level `off` are not returned. Findings sort by file, rule, then the order of `FINDINGS`. Disabled rules are audited.

- [ ] **Step 1: Failing unit tests** in `audit.test.ts`, building input with the harness helpers and an in-memory `readSource`:

| Case | Expect |
|---|---|
| source resolves, record hash matches, no age limit | no findings; `rulesWithSource: 1` |
| file absent | `source-missing`, error, reason `file not found: docs/review.md` |
| heading absent | `source-missing`, reason `heading not found: "Money"` |
| phrase absent | `source-missing`, reason `phrase not found: "fromCents("` |
| `readSource` returns `undefined` | `source-unchecked`, error |
| record hash differs | `source-changed`, warn |
| no record | `never-reviewed`, warn |
| record dated 2026-01-01, `today` 2026-11-12, `maxAgeDays: 180` | `review-overdue`; with `maxAgeDays: 400`, none; with no limit, none |
| lock has a record for an id no rule has, or for a source the rule no longer has | `orphan-review` with `rule` set to the id and `file` the lock path |
| two matching headings | `ambiguous-heading` and no `source-missing` |
| rule with `meta.source` and no block | nothing by default; `meta-source` with `levels: { "meta-source": "warn" }` |
| rule moved to another Lore folder under the same Lore root, record unchanged | no findings |
| a `.loreconfig` sets `source-changed: error`; `options.levels` sets it to `off` | the option wins |
| a missing source is also unreviewed | only `source-missing` (no `never-reviewed` for a source that does not resolve) |

- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement `audit`.
- [ ] **Step 4:** Run; pass.
- [ ] **Step 5: The example kind.** Extend `ExampleKind` with `"audit"`. An `audit` example has files (the lock file is an ordinary file in the example), then `=== today` with one `YYYY-MM-DD` line, then `=== expect` holding `{ "findings": [...], "summary": {...} }`. Teach `extract.ts` the `today` part, `check.ts` to validate the kind against `audit.schema.json`, and the conformance test to run `audit(parseWithContext(input), { today, readSource, locks })`, where `readSource` and `locks` are built from the example's files (a file the example does not hold reads as `null`; the harness never returns `undefined`). In `scripts/fixtures.ts`, `errorNames` returns `[]` for the `audit` kind.
- [ ] **Step 6: Spec.** Write "Auditing sources" from the design: heading matching, sections, fingerprints (with the normalization rules and the reviewed-text table), the lock file format and its record identity, and the findings table with meanings. Give at least one `audit` example per finding, plus the moved-rule case, the heading-as-slug case and a whitespace-normalization case. Describe the `audit` kind under Conformance examples. State that levels, flags and output are tool behavior.
- [ ] **Step 7:** CI mirror, then commit: `spec, parser: audit sources and reviews`.

### Task 7: `lore audit`

**Files:**
- Modify: `packages/cli/src/args.ts`, `packages/cli/src/main.ts`, `packages/cli/src/input.ts`, `packages/cli/src/git.ts` if a byte read is needed
- Create: `packages/cli/src/audit.ts`
- Modify: `packages/cli/README.md`
- Test: `packages/cli/test/audit.test.ts`, `packages/cli/test/main.test.ts`

**Interfaces:**
- Consumes: `audit`, `lockPathFor`, `readReviews`, `LOCK_NAME`, `SourceContent`, `buildInput`, `readTracked`, `readFileAt`.
- Produces:
  - `export interface AuditCommand { name: "audit"; repo: string | null; noRepo: boolean; rulesRef: string | null; given: string[]; remotes: string[]; format: "text" | "json" | null; strict: boolean; maxAge: number | null; levels: Partial<Record<FindingName, Level>> }` in `args.ts`
  - `export function renderAudit(result: AuditResult): string` in `audit.ts`
  - `BuiltInput` gains `readSourceContent(place: EntryPlace, file: string): SourceContent | undefined` and `readLock(path: string): string | null`, both honoring `--rules-ref` and tracked-only reading; reuse them in Task 8.

- [ ] **Step 1: Failing tests.** Args: `lore audit --max-age 90 --level source-changed=error --level never-reviewed=off` parses; `--max-age 0`, `--level nope=warn`, `--level source-changed=loud`, `--diff x` and a positional argument are usage errors (exit 2). End to end in a temp git repo (follow the fixture helpers in `packages/cli/test/fixtures.ts`): a clean repo exits 0; a renamed heading gives `source-missing` and exit 1; a changed section gives `source-changed` and exit 0, and exit 1 with `--level source-changed=error`; an untracked cited file is `source-missing`; `--no-repo --remote <url> --given <folder>` reports governed-repo sources as `source-unchecked` with exit 1, exit 0 with `--level source-unchecked=off`, while a `./` source in the folder is checked; a malformed lock file exits 2 naming the file and line; `--strict` with an excluded entry exits 1; `--format json` output validates against `spec/schemas/audit.schema.json` plus an `excluded` list; `--rules-ref HEAD~1` reads rules, lock and cited files at that revision.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement. Text output: findings grouped under each file path, one line each as `<level>  <finding>  <rule id>  <file>[#<heading>][ "<phrase>"]  <reason>`, then one line per finding name with its count, then `rules with a source: N, without: M`. Excluded entries go to stderr through `excludedLines`' wording. Add `audit` to `HELP` (usage line, an "Audit" options block, and its exit code line: `lore audit     0 no finding at level error, 1 a finding at level error, or --strict and entries were excluded`).
- [ ] **Step 4:** Run; pass.
- [ ] **Step 5:** README: a `## lore audit` section (what it reads, the findings table with default levels, settings in `.loreconfig`, the flags, the unchecked case, moving `source:` out of `<meta>` with `--level meta-source=warn`), the exit code line, and the upgrade-order warning from the design's Constraints.
- [ ] **Step 6:** CI mirror, then commit: `cli: add lore audit`.

### Task 8: `lore review`

**Files:**
- Modify: `packages/cli/src/args.ts`, `packages/cli/src/main.ts`
- Create: `packages/cli/src/review.ts`
- Modify: `packages/cli/README.md`
- Test: `packages/cli/test/review.test.ts`

**Interfaces:**
- Consumes: `BuiltInput.readSourceContent`, `readLock`, `resolveSource`, `lockPathFor`, `readReviews`, `writeReviews`, `sameSource`.
- Produces: `export interface ReviewCommand { name: "review"; ids: string[]; files: string[]; prune: boolean; date: string | null; repo: string | null; given: string[] }`. Rules are read from disk with `untrackedLore: true`.

- [ ] **Step 1: Failing tests** in a temp git repo:
  - `lore review money-in-minor-units` writes the lock with today's date (inject the clock through `IO`; add `today(): string` to `IO` if it has none) and the expected hash, prints `reviewed money-in-minor-units (1 source)`, exits 0.
  - `--date 2026-01-02` is written as given; `--date 2026-02-30` is a usage error.
  - Reviewing again replaces the rule's records and leaves other rules' lines byte-identical.
  - `--file .lore/checkout.lore` reviews every rule in that file that has a source, and skips those without.
  - Two ids, one with a broken source: the good one is written, the bad one's earlier record is unchanged, stderr holds the `source-missing` line, exit 1.
  - An id that names no rule, a rule with no `<source>`, a `--file` that is not a collected Lore file, no ids with no `--file` and no `--prune`, and any of `--rules-ref`, `--remote`, `--no-repo`: usage error, exit 2, lock untouched.
  - A record for a deleted rule is gone after any successful run; `--prune` alone removes orphans and writes nothing else; when nothing changes the file is not rewritten.
  - A rule whose Lore file is untracked can be reviewed.
  - A rule in a given folder with a `./` source writes that folder's lock file.
  - An `ambiguous-heading` rule is written, with the warning on stderr.
  - A lock file that does not exist is created; a malformed one exits 2 and is not overwritten.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement. Write the lock through a temp file and rename, so an interrupted run cannot leave half a file.
- [ ] **Step 4:** Run; pass.
- [ ] **Step 5:** README: a `## lore review` section stating that the command records a person's review and does not perform one, why there is no flag for every rule, adoption file by file, and its exit codes. Add it to `HELP`.
- [ ] **Step 6:** CI mirror, then commit: `cli: add lore review`.

### Task 9: Editors, docs and version

**Files:**
- Modify: `packages/tree-sitter-lore/grammar.js` and regenerate `src/` with `bunx tree-sitter generate`; `queries/highlights.scm`, `queries/injections.scm`; `test/corpus/entries.txt`
- Modify: `packages/prettier-plugin/src/print.ts`, `packages/prettier-plugin/test/format.test.ts`
- Modify: `packages/language-server/src/docs.ts`, `completion.ts`, and their tests
- Modify: `packages/vscode/syntaxes/lore.tmLanguage.json` (the `when|scope|meta` child pattern), `packages/vscode/test/grammar.test.ts`
- Modify: `packages/zed/languages/lore/highlights.scm`, `injections.scm`; run `bun scripts/zed-grammar-rev.ts` as CI does
- Modify: `README.md`, `spec/AGENT.md`, the "Adopting Lore" section of `spec/SPEC.md`, each editor package's README where it lists children
- Modify: `packages/cli/package.json` version to `0.6.0`

**Interfaces:**
- Consumes: the block as Task 2 defines it. No package resolves a source.

- [ ] **Step 1: Failing tests.** tree-sitter corpus: a rule with a `<source>` block parses with a YAML body node like `<when>`. Prettier: a rule with `<source>` formats its YAML as `<scope>` does and is stable on a second pass. Language server: `source` is offered as a child of a rule and not of a context, is not offered twice, hover text exists for `source`, and `file`, `heading`, `phrase` are offered as keys inside it. VS Code grammar: the block's body is scoped `source.yaml`.
- [ ] **Step 2:** Run each package's tests; they fail.
- [ ] **Step 3:** Implement in each package, following how `when` is handled in that package.
- [ ] **Step 4:** Docs. Root README: a short "Where a rule came from" section with one `<source>` example in an `html` fence (it becomes a fixture, so it must parse) and a pointer to `lore audit` and `lore review`. `spec/AGENT.md` and "Adopting Lore": one line each on citing sources and on running `lore audit` in CI.
- [ ] **Step 5:** Run the whole CI mirror: `bunx tree-sitter generate` and `bunx tree-sitter test` in `packages/tree-sitter-lore`, `bun scripts/fixtures.ts`, `git diff --exit-code -- packages/tree-sitter-lore/src test/fixtures` after committing generated files, `bun run build`, `bunx tsc --noEmit`, `bun test`, `bun run check`, `bun run parse-fixtures` in `packages/tree-sitter-lore`, `bun run --filter lore-vscode package`. Skip `cargo build` for Zed only if the toolchain is absent, and say so in the report.
- [ ] **Step 6:** Commit: `editors, docs: learn the source block; cli 0.6.0`.

---

## Not in this plan

- Releasing `cli-v0.6.0`, and turning the feature on in any rule set. Both wait for the user's word.
- Moving any team's `source:` lines out of `<meta>`.
- Live editor diagnostics for a source that does not resolve.
