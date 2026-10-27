# Lore Editor Tooling (Step 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reference parser that passes all 96 conformance examples in `spec/SPEC.md`, plus a Prettier plugin, a language server, a VS Code/Cursor extension (TextMate grammar) and a Zed extension (tree-sitter grammar) built on it.

**Architecture:** A Bun workspace under `packages/`. `parser` is a hand-written TypeScript implementation of the spec, organized like the spec's own sections, tested directly against the conformance examples extracted from `spec/SPEC.md`. Every other package consumes the parser's public API; the highlighting grammars are independent and never decide validity.

**Tech Stack:** Bun (workspaces, test runner), strict TypeScript, Node >= 20 runtime for editor-hosted code, `yaml` v2, Prettier 3, `vscode-languageserver` / `vscode-languageclient`, `@ast-grep/cli` 0.51.0, tree-sitter CLI, Zed extension API (Rust), esbuild and `@vscode/vsce` for packaging.

**Spec:** `docs/superpowers/specs/2026-10-26-lore-editor-tooling-design.md` (this step's design). The normative behavior lives in `spec/SPEC.md`; where the two meet, `spec/SPEC.md` wins and the conformance examples are the test.

## Global Constraints

- Every package is `"private": true`, MIT licensed. Nothing is published.
- No product, company or internal names anywhere in the repository; examples use the fictional `acme/shop`.
- Package names: `@lore/parser`, `@lore/prettier-plugin`, `@lore/language-server`, `lore-vscode` (extension, publisher `lore`), `tree-sitter-lore`, Zed extension id `lore`. The word `lore` appears once per identifier so a rename is mechanical.
- Language id `lore`; file extension `.lore`; `.loreconfig` files are YAML and get the language server's diagnostics.
- Strict TypeScript; `bunx tsc --noEmit` clean at the workspace root.
- Parser: no runtime dependencies except `yaml`; ast-grep runs as the `@ast-grep/cli` binary pinned to exactly `0.51.0`, invoked only for `<check lang="ast-grep">`.
- Code that runs inside an editor or Prettier (parser, prettier-plugin, language-server, vscode) must run under Node >= 20, not only Bun: no `Bun.*` APIs outside tests and scripts.
- `spec/`, `tools/check/` and the existing `tests/` are not modified by this plan, except Task 1's workspace wiring in the root `package.json`. A disagreement between the parser and a conformance example is reported, never "fixed" by editing the example.
- Comments only where they state a constraint the code cannot show. No em or en dashes in prose.
- Commit after each task, ending with the `Co-Authored-By` attribution line given in the session's system reminder.

## Review Focus

1. **CRLF and BOM input in real files.** A `.lore` file saved on Windows (CRLF) or with a BOM must parse exactly like its LF, no-BOM twin (the spec says so; conformance examples cannot show it). Pinned in Task 2 (`CRLF file parses like its LF twin`).
2. **Half-typed files in the editor.** An unclosed `<rule` at the end of a buffer, or a `<when>` with nothing after it, must yield diagnostics, never a thrown exception, and the formatter must return such a file unchanged. Pinned in Task 4 (`never throws on any prefix of an example input`), Task 9 (`returns a file with a file-level error unchanged`), Task 11 (`half-typed buffer publishes diagnostics`).
3. **Large files.** The language server re-parses on change; a 2,000-entry `.lore` file must parse in under 200 ms. Pinned in Task 11 (`parses a 2,000-entry file in under 200 ms`).
4. **No git, or a folder outside any repository.** Opening a `.lore` file where `git` is missing or the folder isn't a repository must still give parse diagnostics from the buffer alone. Pinned in Task 11 (`works without a git repository`).
5. **ast-grep binary missing.** A tool without the binary must still select, reporting the capability as unsupported as the spec allows. Pinned in Task 8 (`without the binary, ast-grep checks are skipped and warned`).

---

## File Structure

```
package.json                      workspaces: ["packages/*"]; scripts test, check, build
packages/parser/
  package.json, tsconfig.json
  src/index.ts                    public API (types + parse, select, parseFile, coveringEntries)
  src/types.ts                    shared types (below)
  src/text.ts                     decode: BOM, CRLF, UTF-8 checks, line table, offset<->position
  src/scan.ts                     Lines and tags, Top level, Entries, comments, fences -> LoreFile CST
  src/indent.ts                   Indentation removal and inconsistent-indentation
  src/yaml.ts                     Structured blocks: yaml lib + duplicate keys, features, lines
  src/blocks.ts                   <defaults>, <scope>, <when>, <meta> shape checks
  src/entries.ts                  Attributes, Children, Prose and summary, Context, defaults applied
  src/glob.ts                     Glob syntax, matching, base resolution, head/tail disjointness
  src/regex.ts                    Regex dialect validation and translation to RegExp
  src/loreconfig.ts               .loreconfig reading, Lore root, Categories, Disable lists
  src/collect.ts                  Files and folders, Collecting files, External folders, repo matching
  src/model.ts                    parse(): files -> DocumentModel, Error reach, duplicate-id, Order
  src/select.ts                   select(): Eligibility, counted files, Conditions, Disable, Checks
  src/astgrep.ts                  ast-grep CLI runner
  test/conformance.test.ts        runs every example from spec/SPEC.md
  test/pending.json               example numbers still allowed to fail, with a reason
  test/*.test.ts                  unit tests per module
packages/prettier-plugin/         src/index.ts, src/print.ts, test/
packages/language-server/         src/server.ts, src/files.ts, src/completion.ts, src/hover.ts,
                                  src/lens.ts, bin/lore-language-server.js, test/
packages/vscode/                  package.json (extension manifest), syntaxes/lore.tmLanguage.json,
                                  language-configuration.json, src/extension.ts, scripts/package.ts, test/
packages/tree-sitter-lore/        grammar.js, src/scanner.c, queries/highlights.scm,
                                  queries/injections.scm, test/corpus/, package.json
packages/zed/                     extension.toml.in (extension.toml is generated, gitignored), Cargo.toml, src/lib.rs,
                                  languages/lore/{config.toml,highlights.scm,injections.scm}
test/fixtures/                    shared grammar fixtures (generated, see Task 10)
```

## Parser public types (Task 1 defines them; every later task uses these names)

```ts
// packages/parser/src/types.ts
export interface InputFile { path: string; content: string }          // path relative to its repository root
export interface GivenFolder { folder: string; files: InputFile[] }   // tracked files of the repository holding the given folder, paths from that repository's root; folder = the given folder's path within it ("" for the root)
export interface LoreInput { repo: InputFile[]; given: GivenFolder[]; remotes: string[] }
export interface Position { line: number; character: number }          // 0-based, UTF-16 units (LSP)
export interface Range { start: Position; end: Position }
export interface Diagnostic { name: string; file: string; entry: string | null; line: number; range?: Range }
export interface Scope { files: string[]; ignores: string[] }
export interface Check { lang: string; body: string }
export interface Entry {
  kind: "rule" | "context"; id: string; file: string;
  category: string | null; severity: "blocking" | "advisory" | null; disabled: boolean;
  scopes: Scope[]; when: Record<string, string[]> | null; checks: Check[];
  meta: Record<string, unknown> | null; summary: string; prose: string; src: string | null;
}
export interface DocumentModel { entries: Entry[]; errors: Diagnostic[]; warnings: Diagnostic[] }
export interface AddedLine { line: number; text: string }
export type ChangedFile =
  | { kind: "A" | "M" | "D"; path: string; added: AddedLine[] }
  | { kind: "R"; oldPath: string; path: string; added: AddedLine[] };
export interface Change { files: ChangedFile[] }
export interface Hit { rule: string; file: string; line: number; text: string }
export interface EligibilityResult { eligible: string[]; hits: Hit[]; excluded: Diagnostic[]; warnings: Diagnostic[] }
export type Capability = "regex" | "ast-grep";
export interface SelectOptions { capabilities?: Capability[]; astGrepBinary?: string | null } // astGrepBinary: string = that binary; undefined = `ast-grep` on PATH; null = no binary (capability unsupported)
```

Paths in `Diagnostic.file` and `Entry.file` follow the spec: repository files as written, given-folder files prefixed `external:`. `range` is extra (for editors) and is stripped before comparing to an expect.

---

### Task 1: Workspace, parser package and conformance harness

**Files:**
- Modify: `package.json` (add `"workspaces": ["packages/*"]`, script `"build": "bun run --filter '*' build"`; keep `test` and `check`). Every package later tasks create gets a `build` script, a no-op (`true`) where nothing is built, so the fan-out never stops on a missing script.
- Create: `packages/parser/package.json`, `packages/parser/tsconfig.json`, `packages/parser/src/types.ts`, `packages/parser/src/index.ts`
- Create: `packages/parser/test/conformance.test.ts`, `packages/parser/test/pending.json`
- Modify: `tsconfig.json` (include `packages/*/src`, `packages/*/test`)

**Interfaces:**
- Consumes: `extractExamples` from `tools/check/extract.ts` (tests only).
- Produces: the types above; `parse(input: LoreInput): DocumentModel` and `select(input: LoreInput, change: Change, options?: SelectOptions): Promise<EligibilityResult>` exported from `@lore/parser`, both throwing `new Error("not implemented")` for now; `toInput(example: Example): LoreInput` and `toChange(diff: string): Change` in `test/conformance.test.ts` (exported from a sibling `test/harness.ts` so later unit tests reuse them).

- [ ] **Step 1: Write the harness tests** in `packages/parser/test/harness.test.ts`:
  - `toInput puts external: files in one given folder with the prefix stripped and folder ""`
  - `toInput uses https://github.com/acme/shop when the example has no remote`
  - `toChange reads A, M, D and R lines and their + lines` (for `R a -> b` with `+3 x`: `{kind:"R", oldPath:"a", path:"b", added:[{line:3,text:"x"}]}`)
- [ ] **Step 2: Run** `bun test packages/parser/test/harness.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `harness.ts` and `conformance.test.ts`: one `test` per example named `example <n> (<section>)`. Parse examples call `parse`, eligibility examples `await select(..., { capabilities: ["regex", "ast-grep"] })`; the result (with every `range` deleted) must `toEqual` the parsed expect. Examples whose number is a key in `pending.json` run as `test.skip`. `pending.json` starts with all 96 numbers, each `"not implemented"`. A separate test asserts every key in `pending.json` is a real example number.
- [ ] **Step 4: Run** `bun test packages/parser`. Expected: harness tests PASS; 96 conformance tests skipped; `bunx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `parser: workspace, types and conformance harness`.

Every later parser task follows one rule for `pending.json`: remove the numbers of the examples in its target sections; an example that still needs a later task's feature stays, with the reason changed to name that task (`"needs Task 7: .loreconfig categories"`). A removed example must pass.

### Task 2: Text, lines and tags, top level, entries, indentation

**Files:** Create `src/text.ts`, `src/scan.ts`, `src/indent.ts`; tests `test/text.test.ts`, `test/scan.test.ts`.

**Interfaces:**
- Produces: `parseFile(path: string, content: string): LoreFile` exported from `@lore/parser`, where `LoreFile = { path; text: DecodedText; nodes: TopNode[]; diagnostics: Diagnostic[] }`, `TopNode` is `CommentNode | BlockNode (name "defaults" | "scope") | EntryNode (name "rule" | "context") | TextNode`, each with `range: Range`, `openLine` and `closeLine` (1-based) where applicable; `EntryNode` has `attributes: RawAttributes` (the raw text between name and `>`), `children: ChildNode[]` (name, raw attributes, body lines, range) and `prose: string[]` (raw lines). `DecodedText = { lines: string[]; lineStarts: number[]; hadBom: boolean }` with `positionAt(offset)` and `offsetAt(position)`. `dedent(lines: string[]): { lines: string[]; error: "inconsistent-indentation" | null }` in `indent.ts`.
- Target sections: Parsing, Lines and tags, Top level, Entries, Indentation (and Files and folders examples that only need these).

- [ ] **Step 1: Write failing unit tests:** `CRLF file parses like its LF twin` (same `nodes` shapes and diagnostics for `"<rule id=\"a\">\r\nx\r\n</rule>\r\n"` and its LF form); `a BOM is ignored`; `positionAt and offsetAt round-trip over a file with a BOM and non-ASCII text`; plus one test per structural error this task owns, taken from the spec text of its target sections.
- [ ] **Step 2: Run** `bun test packages/parser/test/scan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `text.ts`, `scan.ts`, `indent.ts` following the target sections line by line. `parse` may assemble a minimal model from `parseFile` results so target-section examples can pass (fixed categories only; scopes default `["**"]` resolved to the base; full assembly lands in Task 4).
- [ ] **Step 4: Update `pending.json`** per the rule and run `bun test packages/parser`. Expected: all non-pending examples PASS.
- [ ] **Step 5: Commit** `parser: text, tags, top level, entries, indentation`.

### Task 3: Structured blocks and block shapes

**Files:** Create `src/yaml.ts`, `src/blocks.ts`; tests `test/yaml.test.ts`, `test/blocks.test.ts`.

**Interfaces:**
- Consumes: `LoreFile`, `dedent` (Task 2).
- Produces: `readBlock(lines: string[], firstLine: number, incompleteLine: number): { value: unknown; diagnostic: { name: string; line: number } | null }` (`incompleteLine` is where an incomplete document is reported: the block's closing tag line for a block, the file's last line for a `.loreconfig` in Task 7) in `yaml.ts` (YAML 1.2 core schema via `yaml`'s `parseDocument`; duplicate keys, anchors, aliases, every tag, non-string keys, `.inf`/`.nan` rejected with the spec's names and lines; trailing commas accepted). `checkDefaults`, `checkScope`, `checkWhen`, `checkMeta` in `blocks.ts`, each `(value: unknown, line: number) => { name: string; line: number } | null`, using the spec's specific names before the generic `invalid-*` (see the spec's Structured blocks and the error-name rules). Glob and regex validity are NOT checked here (Tasks 5 and 6 add them through hooks `checkGlob` and `checkRegex` that default to "valid").
- Target sections: Structured blocks.

- [ ] **Step 1: Write failing tests** for each YAML trap the spec lists (unquoted `**/*.ts`, `"\d"` in double quotes, `#` in a plain scalar, `[[A-Z]+_PRICE]`, a trailing comma accepted, `!!str` rejected), asserting name and line.
- [ ] **Step 2: Run** `bun test packages/parser/test/yaml.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `yaml.ts` and `blocks.ts`.
- [ ] **Step 4: Update `pending.json`**; run `bun test packages/parser`. Expected: non-pending PASS.
- [ ] **Step 5: Commit** `parser: structured blocks`.

### Task 4: Entries, defaults, context and model assembly

**Files:** Create `src/entries.ts`, `src/model.ts`; tests `test/entries.test.ts`, `test/model.test.ts`.

**Interfaces:**
- Consumes: Tasks 2-3.
- Produces: `parse(input)` now builds the full model for files it is given as Lore files (collection lands in Task 7; until then every `.lore` input inside a `.lore/` folder is a Lore file and the base is that folder's parent): attributes (left-to-right reading, readable id), children, prose and summary, `<defaults>` applied, context `src` resolution (Lore root = repository root until Task 7), fixed categories, severity default, `duplicate-id`, Error reach, Order.
- Target sections: Defaults, Rules (Attributes, Children, Prose and summary), Context, Categories and severity, Error reach (parse-time parts).

- [ ] **Step 1: Write failing tests:** `never throws on any prefix of an example input` (for every input file of every example, `parse` on each line-prefix of it returns a model and does not throw); plus one test per attribute check order rule in the spec's Attributes section.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `entries.ts` and `model.ts`.
- [ ] **Step 4: Update `pending.json`**; run `bun test packages/parser`. Expected: non-pending PASS.
- [ ] **Step 5: Commit** `parser: entries, defaults, context, model`.

### Task 5: Globs and scope

**Files:** Create `src/glob.ts`; test `test/glob.test.ts`.

**Interfaces:**
- Produces: `validateGlob(glob: string, where: "files" | "ignores" | "changed" | "unchanged"): string | null` (error name or null); `matchGlob(glob: string, path: string): boolean`; `resolveGlob(base: string, glob: string): string` (literal base prefix, leading `/` in `changed`/`unchanged` means the repo root); `disjoint(a: string, b: string): boolean` (the spec's head/tail test). Wire `checkGlob` into `blocks.ts`; `empty-scope` into `model.ts`.
- Target sections: Scope and globs, Glob syntax.

- [ ] **Step 1: Write failing tests** covering each glob rule in the spec's Glob syntax section: `**` zero segments, `[!...]`, `{a,b}`, `*` matching a dotfile, `[{]` accepted, `\` rejected, `[^` rejected, leading `!` rejected, `**` inside a segment rejected, ranges read left to right; `disjoint` on the spec's two cases.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `glob.ts` (segment-wise matcher; no glob library).
- [ ] **Step 4: Update `pending.json`**; run. Expected: non-pending PASS.
- [ ] **Step 5: Commit** `parser: globs and scope`.

### Task 6: Regex dialect and conditions (parse time)

**Files:** Create `src/regex.ts`; test `test/regex.test.ts`.

**Interfaces:**
- Produces: `validateRegex(pattern: string): string | null` (`regex-outside-dialect`, `regex-not-one-line` or null) and `toRegExp(pattern: string): RegExp` per the spec's translation note (SPEC.md Regex dialect): flags `us` (code points; `.` matches every character); `\s` and `\S` rewritten as explicit ASCII sets; `\d`, `\w`, `\b` kept (already ASCII in ECMAScript); identity escapes that `u` rejects (such as `\'`) rewritten as the bare character. Wire `checkRegex` into `blocks.ts` for `addedMatches` and into `entries.ts` for `<check lang="regex">` bodies.
- Target sections: Conditions (parse-time examples), Regex dialect, Checks (parse-time).

- [ ] **Step 1: Write failing tests** for each dialect rule: lookahead, backreference, named group, inline `(?i)`, `a{` rejected and `a\{` accepted, leading-zero quantifier rejected, nested-bound product over 1000 rejected (`{0}` counted as 1), empty alternatives accepted, `[\b]` rejected, `\d` not matching U+0663, `\s` not matching U+00A0, `$` at end of text.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `regex.ts` as a small recursive-descent validator over the dialect's grammar, then emit the RegExp source.
- [ ] **Step 4: Update `pending.json`**; run. Expected: non-pending PASS.
- [ ] **Step 5: Commit** `parser: regex dialect and condition checks`.

### Task 7: .loreconfig, collection and external folders

**Files:** Create `src/loreconfig.ts`, `src/collect.ts`; tests `test/loreconfig.test.ts`, `test/collect.test.ts`.

**Interfaces:**
- Produces (exported from `@lore/parser`): `collect(input: LoreInput): Collected` where `Collected = { files: CollectedFile[]; configs: ConfigFile[]; diagnostics: Diagnostic[] }` and `CollectedFile = { file: string /* as in the model */; base: string; loreRoot: string; categories: string[]; tree: "repo" | number /* given-folder tree index */ }`. `normalizeRemote(url: string): string` (spec's algorithm). `disabledFor(collected, entryId: string, path: string): boolean`. `parse` now uses `collect`: only collected files are parsed; `.loreconfig` cascade, Lore root, categories adding down the tree, `invalid-loreconfig` ignored whole, `unknown-disabled-id`, `repo-inside-repo`, `nested-repo`, given folders and `repo` matching against every remote.
- Target sections: Files and folders, .loreconfig (Lore root, Categories, Disable), External folders (Matching the governed repo, Trees, Where repo may appear), Collecting files. After this task every **parse** example passes.

- [ ] **Step 1: Write failing tests:** `normalizeRemote` on `git@github.com:Acme/shop.git`, `https://github.com/acme/shop`, `ssh://git@host:2222/a/b.git`; a `.lore` file outside `.lore/` is not collected; a file reached through two given folders is collected once.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Update `pending.json`**; run. Expected: every parse example PASS.
- [ ] **Step 5: Commit** `parser: loreconfig, collection, external folders`.

### Task 8: Selection, checks and ast-grep

**Files:** Create `src/select.ts`, `src/astgrep.ts`; tests `test/select.test.ts`, `test/astgrep.test.ts`. Add `@ast-grep/cli` `0.51.0` (exact) to `packages/parser` devDependencies and resolve its binary path in tests.

**Interfaces:**
- Produces: `select(input, change, options)`: counted files (deleted by old path, renamed by both), scope matching, `<when>` conditions, `disable`, eligibility-time warnings, regex checks (when `"regex"` is in `capabilities`), ast-grep checks (when `"ast-grep"` is in `capabilities` and `astGrepBinary` resolves; the runner calls the binary per changed file with the spec's language for its extension and default options). A match covers the lines from its first character's line to its last character's line; every added line it covers is a hit, deduplicated per rule, file and line (SPEC.md ast-grep checks). `coveringEntries(input: LoreInput, model: DocumentModel, path: string): Entry[]` (exported from `@lore/parser`) for the editor lens (scope and `disable` only; `<when>` ignored; disabled entries omitted).
- Target sections: Conditions, Running checks, ast-grep checks, Eligibility, Error reach, Disable, and every remaining eligibility example.

- [ ] **Step 1: Write failing tests:** `without the binary, ast-grep checks are skipped and warned` (with `astGrepBinary: null`, example 76's rule is still eligible, no hits, and the warning the spec defines for an unsupported check language is reported); `coveringEntries omits a rule switched off by disable for that path`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement,** and update `test/conformance.test.ts` to pass `astGrepBinary` = the `@ast-grep/cli` devDependency's bin (`node_modules/.bin/ast-grep`).
- [ ] **Step 4: Empty `pending.json`** to `{}` and add a test asserting it is empty. Run `bun test packages/parser`. Expected: 96 conformance examples PASS.
- [ ] **Step 5: Commit** `parser: selection and checks; all conformance examples pass`.

### Task 9: Prettier plugin

**Files:** Create `packages/prettier-plugin/{package.json,src/index.ts,src/print.ts,test/format.test.ts}`.

**Interfaces:**
- Consumes: `parseFile`, `parse` (round-trip test).
- Produces: a Prettier 3 plugin (tested through Bun; using it from a `prettier` run under Node needs a built `dist/`, which `build` produces with esbuild and the package README explains) exporting `languages` (`name: "Lore"`, `parsers: ["lore"]`, `extensions: [".lore"]`), `parsers.lore` (`astFormat: "lore"`, `locStart`, `locEnd`) and `printers.lore` with `embed` for YAML blocks (`textToDoc(text, { parser: "yaml" })`) and the Markdown part of prose (`{ parser: "markdown", proseWrap: "preserve" }`).
- Behavior is exactly the design's "Prettier plugin" section: indentation one level (2 spaces or a tab with `useTabs`), top-level tags at column 0, one blank line between top-level elements, attribute order `id`, `category`, `severity`, `src`, `lang`, `disabled`, prose split at its first blank line outside a fence with the first part only re-indented, Markdown printer then re-indent, `<check>` bodies only re-indented, comments byte for byte, file with a file-level error returned unchanged, an entry with an entry-level error left as written.

- [ ] **Step 1: Write failing tests:** `formats the README sample to the README layout` (input: the README's first `.lore` sample flush-left; expected: the README's indented text); `round-trips every conformance input` (the design's comparison: every model field equal except `prose` after the first blank line, compared after the Markdown printer, and diagnostic lines; and formatting twice equals formatting once); `keeps every top-level comment byte for byte`; `returns a file with a file-level error unchanged`; `keeps a list directly under the first sentence in the summary`; `uses a tab with useTabs`.
- [ ] **Step 2: Run** `bun test packages/prettier-plugin`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `prettier-plugin: format .lore files`.

### Task 10: TextMate grammar and shared fixtures

**Files:** Create `packages/vscode/syntaxes/lore.tmLanguage.json`, `packages/vscode/language-configuration.json`, `scripts/fixtures.ts` (root), `test/fixtures/` (generated, committed, with `test/fixtures/index.json`), `packages/vscode/test/grammar.test.ts`. Dev dependencies `vscode-textmate`, `vscode-oniguruma`.

**Interfaces:**
- Produces: scope name `source.lore`; scopes `entity.name.tag.lore` (tags), `entity.other.attribute-name.lore`, `string.quoted.double.lore`, `comment.block.lore`; embedded `source.yaml` inside `<defaults>`, `<scope>`, `<when>`, `<meta>` and `text.html.markdown` for prose, `string.regexp.lore` for `<check>` bodies. `bun scripts/fixtures.ts` writes every conformance example input `.lore` file to `test/fixtures/example-<n>-<i>.lore` plus the README samples, and `test/fixtures/index.json` mapping each fixture to its example number, kind and the error names its expect lists for that file.
- [ ] **Step 1: Write failing tests** with `vscode-textmate`: `every fixture tokenizes without throwing`; `every tag line in every fixture gets entity.name.tag.lore` (tag lines are the open and close lines `parseFile` reports for top-level nodes and children, so tag-shaped prose lines are excluded); `YAML inside <scope> gets source.yaml`; `prose gets text.html.markdown`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the grammar (YAML and Markdown grammars for the test loaded from small vendored copies or the `vscode-textmate` test setup; the extension itself relies on the editor's built-in YAML and Markdown grammars).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `vscode: TextMate grammar and fixtures`.

### Task 11: Language server core: files and diagnostics

**Files:** Create `packages/language-server/{package.json,src/server.ts,src/files.ts,src/diagnostics.ts,bin/lore-language-server.js,test/server.test.ts,test/files.test.ts}`.

**Interfaces:**
- Consumes: `parse`, `parseFile`, `collect`.
- Produces: a stdio LSP server (`vscode-languageserver/node`). `files.ts`: `listFiles(root: string): Promise<string[] | null>` (`git ls-files -co --exclude-standard -z`; null when git is missing or `root` is not a repository) and `buildInput(workspace, openDocuments, externalFolders): Promise<LoreInput>` (tracked plus untracked-not-ignored files, open buffer contents over disk, each `lore.externalFolders` entry a given folder). Diagnostics for every open `.lore` and `.loreconfig`, with `range` from the parser, `code` = registry name, message = registry description (read from `spec/errors.json` at build time, bundled). Settings: `lore.externalFolders: string[]`; for each, `buildInput` lists files from its enclosing repository root (`git rev-parse --show-toplevel`) and sets `folder` to the setting's path relative to that root.
- Build: `build` bundles `src/server.ts` (with `spec/errors.json` inlined) into `dist/server.js` with esbuild (platform node, target node20); `bin/lore-language-server.js` is a Node shim that requires `../dist/server.js`. The stdio tests run against the built output.
- [ ] **Step 1: Write failing tests** (drive the server in-process through `vscode-languageserver`'s test connection or spawn the bin over stdio): `publishes diagnostics with the registry name and description`; `half-typed buffer publishes diagnostics` (an unclosed `<rule` at the end); `works without a git repository`; `an untracked new .lore file counts`; `an unsaved buffer wins over disk`; `parses a 2,000-entry file in under 200 ms`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Debounce re-parses at 150 ms.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `language-server: files and diagnostics`.

### Task 12: Language server: completion, hover and the "could apply" lens

**Files:** Create `src/completion.ts`, `src/hover.ts`, `src/lens.ts`, `src/docs.ts`; tests `test/completion.test.ts`, `test/hover.test.ts`, `test/lens.test.ts`.

**Interfaces:**
- Consumes: Task 11's input building; `coveringEntries`.
- Produces: completion (tags at column 0 and inside entries, attribute names per element, categories in effect for the file, `blocking`/`advisory`, `regex`/`ast-grep`, `<when>` keys, known ids inside `disable` lists of `.loreconfig`); hover (registry description on a diagnostic range; a one-sentence text per tag, attribute and `<when>` key in `docs.ts`; an entry's resolved scopes on its opening tag); code lens on line 0 of any non-Lore file in a governed repository: `Lore: could apply: <id>, <id>` with one command per entry that opens the entry's file at its opening tag. Files with no covering entries get no lens.
- [ ] **Step 1: Write failing tests:** `completes custom categories from .loreconfig`; `completes known ids in a disable list`; `hover on an error shows its description`; `lens lists covering rules for a source file`; `lens includes rules from an external folder matched by repo`; `lens omits a rule disabled for that path`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `language-server: completion, hover, could-apply lens`.

### Task 13: VS Code and Cursor extension

**Files:** Create `packages/vscode/package.json` (manifest), `src/extension.ts`, `scripts/package.ts`, `README.md`, `test/manifest.test.ts`.

**Interfaces:**
- Consumes: the grammar (Task 10), the server bin (Task 11).
- Produces: manifest contributing language `lore` (`.lore`), the grammar with `embeddedLanguages` `{ "source.yaml": "yaml", "text.html.markdown": "markdown" }`, configuration `lore.externalFolders`; `extension.ts` starts `vscode-languageclient/node` with the bundled server for `{ language: "lore" }`, `{ pattern: "**/.loreconfig" }` and `{ scheme: "file" }` (for the lens). `bun run --filter lore-vscode package` bundles with esbuild and writes `packages/vscode/dist/lore-vscode.vsix` via `@vscode/vsce package --no-dependencies`. The extension README states the editor's relaxed file list (tracked plus untracked, buffers over disk) versus review-time collection, and how to install the `.vsix` in VS Code and Cursor.
- [ ] **Step 1: Write failing tests:** `manifest contributes the lore language and grammar`; `package script produces a .vsix containing the server and grammar` (unzip listing).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then install the `.vsix` into VS Code or Cursor, open `test/fixtures/` and confirm highlighting, a diagnostic on a broken file, completion and hover; record what was seen in the report.
- [ ] **Step 5: Commit** `vscode: extension and packaging`.

### Task 14: tree-sitter grammar and Zed extension

**Files:** Create `packages/tree-sitter-lore/{grammar.js,tree-sitter.json,src/scanner.c,queries/highlights.scm,queries/injections.scm,test/corpus/*.txt,package.json}` plus the generated and committed `src/parser.c`, `src/grammar.json`, `src/node-types.json`, `src/tree_sitter/*.h`; `packages/zed/{extension.toml.in,Cargo.toml,src/lib.rs,languages/lore/config.toml,languages/lore/highlights.scm,languages/lore/injections.scm,README.md}`, `scripts/zed-grammar-rev.ts`.

**Interfaces:**
- Consumes: shared fixtures (Task 10), the server bin (Task 11).
- Produces: a tree-sitter grammar with an external scanner for the line rules (column-0 tags, prose to the column-0 closing tag, fences in prose); node types `source_file`, `comment`, `defaults_block`, `scope_block`, `rule`, `context`, `child` (with `tag_name`, `attribute`, `attribute_name`, `attribute_value`), `yaml_body`, `check_body`, `prose`; injections `yaml_body` -> `yaml`, `prose` -> `markdown`. Zed extension: `bun scripts/zed-grammar-rev.ts` writes `packages/zed/extension.toml` (gitignored, machine-specific) from the committed `extension.toml.in`, with grammar `repository = "file://<this checkout's root>"`, `path = "packages/tree-sitter-lore"` and `rev` = the latest commit touching `packages/tree-sitter-lore`; `language_server_command` returns `lsp.lore-language-server.binary.path` from Zed settings when set, else `lore-language-server` found on the worktree's PATH. The README says how to install it as a dev extension and how to put `lore-language-server` on PATH.
- [ ] **Step 1: Write failing tests:** a `test/corpus/` case per top-level form and one for a `</rule>` inside a fenced block in prose; a script test `every fixture parses without ERROR nodes` (`tree-sitter parse --quiet` over `test/fixtures/`, excluding fixtures from examples that expect `unreadable-structure` or `top-level-text`).
- [ ] **Step 2: Run** `bunx tree-sitter test` in the grammar package (it compiles `src/parser.c` with the system C compiler: Xcode command line tools on macOS, present on ubuntu-latest; the package pins `tree-sitter-cli` 0.27.x as a devDependency so `bunx tree-sitter` is the CLI). Expected: FAIL.
- [ ] **Step 3: Implement** the grammar, scanner and queries; run `tree-sitter generate` and keep the generated `src/` files (Zed compiles from them without generating).
- [ ] **Step 4: Run** the corpus tests and the fixture script. Expected: PASS. **Commit** `tree-sitter: lore grammar` (the Zed `rev` must name an existing commit).
- [ ] **Step 5: Implement** the Zed extension, run `bun scripts/zed-grammar-rev.ts`, and check `cargo build --target wasm32-wasip1` succeeds. Install the dev extension in Zed and confirm highlighting and diagnostics on `test/fixtures/`; record what was seen in the report.
- [ ] **Step 6: Commit** `zed: lore extension`.

### Task 15: CI and docs

**Files:** Modify `.github/workflows/ci.yml`, `README.md` (Roadmap item 2 and a short "Editor support" section linking the two extension READMEs).

- [ ] **Step 1: Extend CI:** add `bun run build` right after `bun install --frozen-lockfile` (the server tests and the vsix need built output); install Rust (`dtolnay/rust-toolchain` with target `wasm32-wasip1`) and run, after the existing steps: `bun test` (now covering all packages), `bunx tree-sitter test` in `packages/tree-sitter-lore`, the fixture parse script, `bun scripts/zed-grammar-rev.ts` then `cargo build --target wasm32-wasip1` in `packages/zed`, and `bun run --filter lore-vscode package`.
- [ ] **Step 2: Update README** Roadmap item 2 to "done: reference parser, Prettier plugin, language server, VS Code/Cursor and Zed extensions (not yet published)", and add the Editor support section.
- [ ] **Step 3: Commit** `ci and docs: editor tooling`.
- [ ] **Step 4: Push** and confirm CI is green with `gh run list -R m4ttstack/lore -L 1`.
