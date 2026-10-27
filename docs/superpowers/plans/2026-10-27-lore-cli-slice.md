# Lore CLI slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Lore repo's half of step 3's thin slice: two spec additions, the step 2 gates a command line exposes, and a `lore` command with `select` (diff input) and `verdicts`, released as one bundled file.

**Architecture:** The spec and the reference parser (`packages/parser`) gain a rules revision and loose given folders, each with its own example section and conformance example. A new package `packages/cli` (`@lore/cli`, binary `lore`) wraps the parser: it reads rules from a working tree, a git ref or given folders, parses a unified diff into the spec's change, runs selection, and prints a selection as JSON or prompt-ready Markdown; `lore verdicts` checks a reviewer's verdict set against a selection. esbuild bundles it into one file that runs under Node 20+ and Bun.

**Tech Stack:** TypeScript, Bun workspace and `bun test`, esbuild (as `packages/language-server` uses it), `node:util` `parseArgs`, git via `node:child_process`.

**Spec:** `docs/superpowers/specs/2026-10-27-lore-applying-rules-design.md` (read it first; it is the authority). Upstream: `spec/SPEC.md`.

## Global Constraints

- The repo is public: no employer, client or product names other than Lore's own anywhere in code, tests, docs or commit messages.
- No em or en dashes in prose (docs, comments, help text, CLI output). Use parentheses, colons or a new sentence.
- Comments only for a constraint the code cannot show; match the density of the file you are in (sparse).
- The command never calls a forge, a model or the network. Git is the only external program, run only for a git input. ast-grep runs only through the parser.
- Runs under Node 20+ and Bun from one bundled file; never imports TypeScript source at run time.
- Parsing and selection stay in `@lore/parser`. Behaviour the spec defines is tested through conformance examples, not again in the CLI.
- Selection must not read every repository file's content: list tracked paths, read only `.lore` files inside a `.lore/` folder, `.loreconfig` files, and the files a context's `src` names.
- Exit codes for `lore select`: 0 when selection ran; 1 when `--strict` is given and `excluded` is not empty; 2 on a usage or input error. `lore verdicts`: 0 with no problems, 1 with problems, 2 on a usage or input error.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Inserting a spec example renumbers every later one. After inserting, update numeric example references in `packages/parser/test/collect.test.ts` and `packages/parser/test/select.test.ts` (every `example N` / `example(N` with N at or after the new number goes up by one), and run `bun scripts/fixtures.ts` so `test/fixtures` stays current (CI diffs it).
- Root checks that must pass before every commit: `bunx tsc --noEmit`, `bun test`, `bun run check`.

## Review Focus

1. A forge diff with quoted or escaped paths (`diff --git "a/caf\303\251.ts" "b/caf\303\251.ts"`, paths with spaces): the change names the real UTF-8 path. Pinned in Task 4.
2. A diff with CRLF line endings, `\ No newline at end of file`, or a binary file: added line numbers stay right, CR is not part of the text, a binary file is a changed file with no added lines. Pinned in Task 4.
3. An empty diff (no files): `lore select` prints an empty selection, exits 0, and the text form says no rules apply. Pinned in Task 6.
4. A rule whose pattern the regex engine refuses: the command exits 2 with a short message, never a stack trace or a multi-kilobyte pattern. Pinned in Tasks 3 and 6.
5. A given folder named with a trailing slash or a relative path: same selection as the clean absolute path. Pinned in Task 5.

---

### Task 1: Rules revision

**Files:**
- Modify: `packages/parser/src/types.ts` (LoreInput), `packages/parser/src/collect.ts`, `packages/parser/src/select.ts` (`srcTargetsMissing`), `packages/parser/src/model.ts` and `packages/parser/src/entries.ts` (file-relative `src` resolution)
- Modify: `tools/check/extract.ts`, `tools/check/check.ts`, `packages/parser/test/harness.ts`, `packages/parser/test/model.test.ts`, `packages/parser/test/harness.test.ts`, `tests/extract.test.ts`
- Modify: `spec/SPEC.md` (Conformance examples table, Eligibility, Collecting files, one new example)
- Test: `packages/parser/test/collect.test.ts`, `tools/check` tests if present, conformance via `packages/parser/test/conformance.test.ts`

**Interfaces:**
- Produces: `LoreInput { repo: InputFile[]; given: GivenFolder[]; remotes: string[]; rules?: InputFile[] }`. When `rules` is given, Lore files, `.loreconfig` files and `src` targets of the governed repo come from `rules` only, their `file` names carry the prefix `rules:`, and `repo` is only the change's side. An entry's `src` from a rules file is a plain governed-repo path with no prefix, for plain and file-relative (`./`, `../`) `src` alike.
- Produces: `ExampleFile { path: string; place: "repo" | "external" | "rules" | "loose"; content: string }` (replaces `external: boolean`; `path` keeps its prefix as written).

- [ ] **Step 1: Write the failing tests**

In `packages/parser/test/collect.test.ts`:

```ts
test("with rules given, Lore files come from rules and carry the rules: prefix", () => {
  const lore = (id: string) => `<rule id="${id}" category="documentation">\nText.\n</rule>\n`;
  const collected = collect({
    repo: [{ path: ".lore/a.lore", content: lore("from-repo") }],
    rules: [{ path: ".lore/a.lore", content: lore("from-rules") }],
    given: [], remotes: ["https://github.com/acme/shop"],
  });
  expect(collected.files.map((f) => f.file)).toEqual(["rules:.lore/a.lore"]);
  expect(collected.files[0]!.base).toBe("");
});
```

In `packages/parser/test/select.test.ts`:

```ts
test("with rules given, a src target counts only when the rules revision tracks it", async () => {
  const context = `<context id="guide" src="docs/guide.md">\nRead it.\n</context>\n`;
  const input = {
    repo: [{ path: "docs/guide.md", content: "" }],
    rules: [{ path: ".lore/a.lore", content: context }],
    given: [], remotes: ["https://github.com/acme/shop"],
  };
  const result = await select(input, { files: [{ kind: "M", path: "x.ts", added: [] }] });
  expect(result.warnings.map((w) => [w.name, w.file])).toEqual([["missing-src-target", "rules:.lore/a.lore"]]);
});

test("a file-relative src in a rules file resolves to a plain governed path", () => {
  const context = `<context id="guide" src="./guide.md">\nRead it.\n</context>\n`;
  const model = parse({
    repo: [], given: [], remotes: ["https://github.com/acme/shop"],
    rules: [{ path: "docs/.lore/a.lore", content: context }, { path: "docs/.lore/guide.md", content: "" }],
  });
  expect(model.entries[0]!.src).toBe("docs/.lore/guide.md");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test packages/parser/test/collect.test.ts packages/parser/test/select.test.ts`
Expected: the three new tests FAIL (TypeScript accepts `rules` only after Step 3; until then they fail on the file name, the missing warning and the missing entry).

- [ ] **Step 3: Implement the rules revision in the parser**

`collect`: the governed source's files are `input.rules ?? input.repo`, and its prefix is `RULES = "rules:"` when `input.rules` is given (export the constant beside `EXTERNAL`). `model.ts` builds a file's `prefix` for `resolveSrc` from `file.tree`; today `"repo"` gets `""` and external trees get `EXTERNAL`, and `entries.ts` both strips that prefix from the Lore path and prepends it to the result. Split the two: the prefix to strip is the file name's own prefix (`rules:`, `external:`, or none), and the prefix to prepend is `""` for the governed repo (rules revision or not) and `EXTERNAL` for an external tree. `srcTargetsMissing`: when `input.rules` is given, the governed set is the `rules` paths only (no changed paths added); otherwise unchanged. A one-line comment on `LoreInput.rules` states the rule from the Interfaces block.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test packages/parser`
Expected: PASS, including every conformance example.

- [ ] **Step 5: Teach the extractor, checker and harness the `rules:` section**

`extract.ts`: `ExampleFile.place` from the prefix (`external:`, `rules:`, `loose:`, else `repo`). Update every former use, both member access and object literals: `packages/parser/test/harness.ts`, `packages/parser/test/model.test.ts`, `packages/parser/test/harness.test.ts` (literals with `external: true|false`) and `tests/extract.test.ts` (same). Confirm none is left with `grep -rn "external" tools scripts tests packages/parser --include=*.ts` and `bunx tsc --noEmit`; never search `packages/zed/grammars` (a stale clone). `harness.ts` `toInput`: `rules:` files go to `input.rules` with the prefix stripped; `input.rules` is set only when the example has at least one. `check.ts`: report a `sections` problem for a `rules:` section in a parse example.

- [ ] **Step 6: Write the spec text and the example**

In `spec/SPEC.md`:
- Conformance examples table: a row `=== rules:<path>` | "Eligibility only. A file of the governed repo as it is at the rules revision (see [Collecting files](#collecting-files)). With at least one such section, the tool is given a rules revision." Add to "What the governed repo contains" that with `rules:` sections, Lore files, `.loreconfig` files and `src` targets are read from them only, and the plain input files are still the governed repo as the change leaves it. Add to **Paths** that `rules:` files keep their prefix, as `external:` files do.
- Collecting files: after the governed repo bullet, a paragraph **Rules revision**: a tool MAY let its caller name a revision of the governed repo to read Lore files, `.loreconfig` files and `src` targets from, instead of the revision the change leaves; the change itself (its files and added lines) is unaffected; without one, a tool reads as above. Say why in one sentence: a change that is judged by its own rules can delete or loosen the rule in its way.
- Qualify Eligibility's "The entries themselves are read from the files as the change leaves them" with "unless the tool was given a rules revision (see Collecting files)", and Collecting files' "MUST NOT find them by walking a file system" is left for Task 2.
- Directly after the Eligibility example whose diff modifies `apps/web/src/checkout/.lore/checkout.lore` (it expects `lore-rules-owned`, `price-from-quote`, `quote-expiry-shown`), add one sentence and an example: the same `=== .lore/lore.lore`, `=== apps/web/src/checkout/.lore/checkout.lore` and diff, plus `=== rules:.lore/lore.lore` (same content) and `=== rules:apps/web/src/checkout/.lore/checkout.lore` holding only `price-from-quote`. Expect `{ "eligible": ["lore-rules-owned", "price-from-quote"], "hits": [], "excluded": [], "warnings": [] }`.
- Apply the renumbering procedure from Global Constraints.

- [ ] **Step 7: Run every check**

Run: `bunx tsc --noEmit && bun test && bun run check`
Expected: all pass; `bun run check` reports 99 examples.

- [ ] **Step 8: Commit**

```bash
git add spec tools packages/parser test/fixtures
git commit -m "spec: a rules revision decides which rules judge a change"
```

---

### Task 2: Loose given folders

**Files:**
- Modify: `packages/parser/src/types.ts` (GivenFolder), `packages/parser/src/collect.ts` (Collected gains `warnings`), `packages/parser/src/model.ts` (carry collection warnings into the model's warnings; a file-relative `src` in a loose folder resolves with the `loose:` prefix, the way `external:` does today)
- Modify: `packages/parser/test/harness.ts`, `tools/check/check.ts` (`CAPABILITIES`), `spec/errors.json`, `spec/SPEC.md`
- Test: `packages/parser/test/collect.test.ts`, conformance

**Interfaces:**
- Consumes: `ExampleFile.place` (Task 1).
- Produces: `GivenFolder { folder: string; files: InputFile[]; repository?: string; loose?: boolean }`. A loose folder is its own repository rooted at the folder (`folder` is `""`), its files are prefixed `loose:`, files inside a directory whose name starts with `.` (other than `.lore`) are dropped, and it adds one warning `{ name: "untracked-given-folder", file: "loose:.", entry: null, line: 1 }`.
- Produces: `Collected.warnings: Diagnostic[]`, merged into `DocumentModel.warnings`.

- [ ] **Step 1: Write the failing test**

```ts
test("a loose given folder is collected whole, except dot-folders, with a warning", () => {
  const lore = (id: string) => `<rule id="${id}" category="documentation">\nText.\n</rule>\n`;
  const collected = collect({
    repo: [], remotes: ["https://github.com/acme/shop"],
    given: [{ folder: "", loose: true, files: [
      { path: ".loreconfig", content: "repo: github.com/acme/shop\n" },
      { path: ".lore/a.lore", content: lore("kept") },
      { path: ".cache/.lore/b.lore", content: lore("dropped") },
    ] }],
  });
  expect(collected.files.map((f) => f.file)).toEqual(["loose:.lore/a.lore"]);
  expect(collected.warnings).toEqual([{ name: "untracked-given-folder", file: "loose:.", entry: null, line: 1 }]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/parser/test/collect.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement loose folders in `collect` and `model`**

`repositories()` keeps each loose folder as its own repository with prefix `LOOSE = "loose:"`; the dot-folder filter applies to directory segments only (a file named `.loreconfig` stays). A loose folder's `files` paths are relative to the folder itself, unlike a tracked given folder's, which are relative to its repository's root. A file-relative `src` in a loose file strips `loose:` and prepends `loose:`, the way external files do with `external:` (Task 1 split the two prefixes).

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/parser`
Expected: PASS.

- [ ] **Step 5: Spec, registry, checker and example**

- `spec/errors.json`: `untracked-given-folder`, kind `warning`, description "A given folder in no working copy was collected whole."
- `tools/check/check.ts`: `CAPABILITIES` gains `loose-given-folder`; `checkReferences` accepts the file `loose:.` in a diagnostic when the example has at least one `loose:` section (it is neither an input nor a diff path, and the design fixes it). `harness.ts`: `loose:` files become one given folder `{ folder: "", loose: true, files }` with the prefix stripped, so their paths are relative to the folder.
- `spec/SPEC.md` `## Errors and warnings` table: a row for `untracked-given-folder` at the same position it has in `errors.json` (`checkRegistryTable` compares them row by row).
- `spec/SPEC.md`:
  - Conformance examples: the `requires:` paragraph defines `loose-given-folder` (run only by a tool that collects loose folders); the table gains `=== loose:<path>` ("A file of one given folder that is in no working copy, `<path>` relative to that folder"); **Paths** says `loose:` files keep their prefix.
  - Collecting files: qualify "MUST NOT find them by walking a file system" with "except in a given folder that is in no working copy (see External folders)".
  - External folders: a bullet. A tool MAY collect a given folder that is in no working copy, counting every file under it except those inside a directory whose name starts with `.` other than `.lore`; when it does, it MUST report `untracked-given-folder` once for that folder. A tool MAY instead refuse such a folder and collect nothing from it. State the trade-off: the team, not version control, then decides what is in the folder, so a stray copy of a Lore folder can add rules.
  - After the External folders eligibility example (the one expecting `price-source-recorded`), one sentence and an example with `requires: loose-given-folder`: `=== loose:.loreconfig` (`repo: github.com/acme/shop`), `=== loose:.lore/checkout.lore` (rule `price-from-quote`, `functional_correctness`, "A displayed price must come from the quote that produced it."), `=== loose:.cache/.lore/stale.lore` (rule `stale-copy`, `documentation`, "A copy a tool left behind."), diff `M apps/web/src/checkout/Price.tsx` / `+12 const total = quote.total`. Expect eligible `["price-from-quote"]`, no hits, no excluded, warnings `[{ "name": "untracked-given-folder", "file": "loose:.", "entry": null, "line": 1 }]`.
  - Apply the renumbering procedure from Global Constraints.

- [ ] **Step 6: Run every check**

Run: `bunx tsc --noEmit && bun test && bun run check`
Expected: all pass; 100 examples.

- [ ] **Step 7: Commit**

```bash
git add spec tools packages/parser test/fixtures
git commit -m "spec: a given folder in no working copy MAY be collected whole, with a warning"
```

---

### Task 3: Parser gates for a command line

**Files:**
- Modify: `packages/parser/src/regex.ts`, `packages/parser/src/astgrep.ts`, `packages/parser/src/select.ts`, `packages/parser/src/types.ts` (SelectOptions)
- Test: `packages/parser/test/regex.test.ts`, `packages/parser/test/astgrep.test.ts`, `packages/parser/test/select.test.ts`

**Interfaces:**
- Produces: `SelectOptions { capabilities?; astGrepBinary?; fileContent?: (path: string) => string | null }`. When `fileContent` is given, ast-grep checks read a changed file's new content from it instead of `input.repo`; `null` means "not available".
- Produces: warning `check-needs-file`: once per ast-grep check of an eligible rule that met a searched file whose content is `null`, as `place.diagnostic("check-needs-file", place.checkLines[n])` (the Lore file and the check's line). The check is skipped for those files.
- Produces: warning `ast-grep-failed` `{ file: <changed file's new path>, entry: <rule id>, line: 1 }` when ast-grep times out, crashes or exits with an error for that file. `astGrepSpans` returns `LineSpan[] | null` (null on failure).
- Neither warning goes in `spec/errors.json`: they are the reference tool's, not the spec's. If a test asserts every warning name the parser emits is registered, give it an explicit list of these two tool-only names.

- [ ] **Step 1: Write the failing tests**

```ts
// regex.test.ts
test("a RegexLimitError message shows at most 100 characters of the pattern", () => {
  const pattern = "(".repeat(5000) + "a" + ")".repeat(5000);
  let message = "";
  try { toRegExp(pattern); } catch (error) { message = (error as Error).message; }
  expect(message).toContain("...");
  expect(message.length).toBeLessThan(300);
});

// astgrep.test.ts
test("a binary that fails yields null, not an empty match list", async () => {
  const stub = stubAstGrep("ast-grep 0.51.0"); // answers --version only; `run` exits 0 with no JSON
  try { expect(await astGrepSpans(stub.binary, "$A", "typescript", "x")).toBeNull(); } finally { stub.remove(); }
});

// select.test.ts
test("an ast-grep check over a file with no content reports check-needs-file once and skips", async () => {
  const lore = `<rule id="no-any" category="code_style">\n<check lang="ast-grep">\n$A as any\n</check>\nNo casts to any.\n</rule>\n`;
  const input = { repo: [{ path: ".lore/a.lore", content: lore }], given: [], remotes: ["https://github.com/acme/shop"] };
  const change = { files: [
    { kind: "M" as const, path: "a.ts", added: [{ line: 1, text: "x as any" }] },
    { kind: "M" as const, path: "b.ts", added: [{ line: 1, text: "y as any" }] },
  ] };
  const result = await select(input, change, { capabilities: ["ast-grep"], astGrepBinary: astGrepBinary(), fileContent: () => null });
  expect(result.hits).toEqual([]);
  expect(result.warnings.map((w) => [w.name, w.file, w.line])).toEqual([["check-needs-file", ".lore/a.lore", 2]]);
});
```

Adjust the stub so `run` exits 0 with empty stdout if it does not already (the stub prints the version line for every call; JSON parsing then fails, which must now be `null`).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test packages/parser/test/regex.test.ts packages/parser/test/astgrep.test.ts packages/parser/test/select.test.ts`
Expected: the three new tests FAIL.

- [ ] **Step 3: Implement**

- `regex.ts`: both `RegexLimitError` messages, and the plain `Error` for a pattern outside the dialect, show the pattern through one helper that keeps the first 100 code points and appends `...` when longer.
- `astgrep.ts`: spawn failure, timeout, a signal, an error exit or unparseable JSON return `null`; exit codes 0 and 1 with valid JSON return spans. The existing `astgrep.test.ts` cases for an invalid pattern (`(((`), an unknown language, a missing binary and `a\0b` assert `[]` today and change to `null`: the code is right, update those tests. Update the timeout comment, which now says a timeout looks like no match.
- `select.ts` `runChecks`: content comes from `options.fileContent` when given, else from the `input.repo` map as today (undefined there still skips silently, which conformance examples rely on). `null` from `astGrepSpans` adds `ast-grep-failed`.

- [ ] **Step 4: Run the parser suite**

Run: `bun test packages/parser`
Expected: PASS, conformance included.

- [ ] **Step 5: Commit**

```bash
git add packages/parser
git commit -m "parser: short regex limit messages; ast-grep failures and missing file content are warnings"
```

---

### Task 4: CLI package and unified diff parsing

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json` (copy `packages/parser/tsconfig.json`), `packages/cli/src/errors.ts`, `packages/cli/src/diff.ts`
- Test: `packages/cli/test/diff.test.ts`

**Interfaces:**
- Produces: `parseUnifiedDiff(text: string): Change` in `packages/cli/src/diff.ts`, and `class InputError extends Error` in `packages/cli/src/errors.ts` (thrown for any unreadable input; the command maps it to exit 2).
- `package.json`: name `@lore/cli`, version `0.1.0`, `private: true`, no `type` field (like the language server: with `type: "module"`, Node would load the CommonJS bundle as ESM and fail on `require`), `bin: { "lore": "dist/lore.js" }`, `engines.node >= 20`, dependency `@lore/parser: workspace:*`, devDependency `esbuild` (same range as the language server), script `build`: `esbuild src/main.ts --bundle --platform=node --target=node20 --format=cjs --banner:js="#!/usr/bin/env node" --outfile=dist/lore.js`. `dist/` is gitignored.

- [ ] **Step 1: Write the failing tests**

One test per case, each asserting the whole `Change`:

- a modified file with two hunks: added lines numbered from each hunk's `+start`, context and removed lines skipped;
- `new file mode` gives `kind: "A"`; `deleted file mode` gives `kind: "D"` with no added lines;
- `rename from`/`rename to` (with and without edits) gives `{ kind: "R", oldPath, path }`;
- `Binary files a/x.png and b/x.png differ` gives a changed file with no added lines;
- `\ No newline at end of file` is not a line;
- CRLF input: no `\r` in any `text`, numbering unchanged;
- a quoted path `"b/caf\303\251.ts"` gives `café.ts`, and a path with a space (`b/my file.ts`) survives;
- an empty string gives `{ files: [] }`;
- text that is not a diff (`hello`) throws `InputError`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun install && bun test packages/cli`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `parseUnifiedDiff`**

Read `diff --git` headers for paths (unquote C-style octal escapes as UTF-8), prefer `rename from/to`, `new file mode`, `deleted file mode`; strip the `a/`/`b/` prefixes; `+++ /dev/null` and `--- /dev/null` confirm deletion and addition. Accept diffs without `diff --git` lines (plain `---`/`+++` pairs, as `diff -u` writes). Strip one trailing `\r` per line.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test packages/cli && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli bun.lock .gitignore
git commit -m "cli: package and unified diff parsing"
```

---

### Task 5: Reading rules from a repo, a ref and given folders

**Files:**
- Create: `packages/cli/src/git.ts`, `packages/cli/src/input.ts`
- Test: `packages/cli/test/input.test.ts` (builds temporary git repositories with `git init` in `os.tmpdir()`)

**Interfaces:**
- Consumes: `LoreInput.rules`, `GivenFolder.loose` (Tasks 1, 2).
- Produces in `input.ts`:

```ts
export interface RuleSources {
  repo: string | null;        // absolute path of the governed repo's root; null for --no-repo
  rulesRef: string | null;
  given: string[];            // as typed; resolved to absolute paths here
  remotes: string[];          // from --remote; when empty and repo is set, read from git
}
export interface BuiltInput { input: LoreInput; readSrc(file: string): string | null }
export async function buildInput(sources: RuleSources): Promise<BuiltInput>;
export function findRepoRoot(dir: string): string | null;
```

- `git.ts`: `gitRoot(dir): string | null`, `trackedPaths(root, ref: string | null): string[]` (`git ls-files -z` for the working tree, `git ls-tree -r -z --name-only <ref>` for a ref), `readFileAt(root, ref: string | null, path): string` (disk or `git show <ref>:<path>`), `remoteUrls(root): string[]` (unique fetch URLs from `git remote -v`). A failing git command throws `InputError` naming the command, not git's whole stderr past its first line.

Behaviour:
- Working tree, no `rulesRef`: `input.repo` lists every tracked path; content is read for `.lore` files inside a `.lore/` folder and for `.loreconfig` files, and is `""` for every other path (selection reads no other content; Task 6 passes `fileContent`). No `input.rules`.
- With `rulesRef`: `input.repo = []` and `input.rules` holds the ref's tracked paths, contents read the same way, at the ref.
- `repo: null`: `input.repo = []`, no `rules`; `remotes` must be non-empty, else `InputError("--no-repo needs --remote")`.
- Each given folder: resolve to an absolute real path. Note the two path conventions: a tracked given folder's `files` are relative to its repository's root, a loose folder's to the folder itself. Inside a working copy: `{ folder: <path from that root, no trailing slash>, files: <that repository's tracked paths, contents read as above>, repository: <root> }`. In none: `{ folder: "", loose: true, files: <every file under it, skipping directories whose name starts with "." other than ".lore">, contents read as above }`.
- `readSrc(file)` returns the content of a context's `src` target: a plain path from the governed repo (at `rulesRef` when given; null with `--no-repo`); an `external:` path from that given folder's repository working tree; a `loose:` path from the loose folder on disk; null when unreadable.

- [ ] **Step 1: Write the failing tests**

- a temp repo with a tracked `.lore/a.lore` and an untracked `.lore/b.lore`: only `a.lore` is in `input.repo` with content, and a tracked `src/x.ts` is present with content `""`;
- the same repo with `rulesRef: "HEAD~1"` after a commit that adds a rule: `input.rules` is the older file, `input.repo` is empty;
- a given folder inside a second temp repo with a `.loreconfig` (`repo: github.com/acme/shop`) and a tracked Lore file: one `GivenFolder` with `repository` set and the right `folder`; passing it as `<abs>/`, as a relative path and as the clean absolute path gives equal inputs (Review Focus 5);
- a given folder in no repo (plain temp dir) with `.cache/.lore/x.lore`: `loose: true`, the dot-folder file absent;
- `{ repo: null, remotes: [] }` throws `InputError` with message `--no-repo needs --remote`;
- `remotes: []` with a repo whose origin is `https://github.com/acme/shop.git` reads that URL.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test packages/cli/test/input.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `git.ts` and `input.ts`**

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test packages/cli && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "cli: read rules from a working tree, a git ref and given folders"
```

---

### Task 6: `lore select`

**Files:**
- Create: `packages/cli/src/selection.ts`, `packages/cli/src/text.ts`, `packages/cli/src/args.ts`, `packages/cli/src/main.ts`
- Test: `packages/cli/test/selection.test.ts`, `packages/cli/test/text.test.ts`, `packages/cli/test/main.test.ts`

**Interfaces:**
- Consumes: `parseUnifiedDiff`, `InputError` (Task 4); `buildInput`, `findRepoRoot` (Task 5); `parse`, `select` from `@lore/parser`; `SelectOptions.fileContent` (Task 3).
- Produces in `selection.ts`:

```ts
export interface Selection {
  lore: "1";
  rules: { id: string; file: string; category: string | null; severity: "blocking" | "advisory"; summary: string; prose: string; meta: Record<string, unknown> | null; hits: { file: string; line: number; text: string }[] }[];
  context: { id: string; file: string; summary: string; prose: string; src: string | null; srcText: string | null }[];
  conditional: string[];      // always [] in this slice (paths mode is later)
  change: { kind: "A" | "M" | "D" | "R"; path: string; oldPath: string | null; added: number[] }[];
  excluded: Diagnostic[];
  warnings: Diagnostic[];
}
export function toSelection(model: DocumentModel, result: EligibilityResult, change: Change, readSrc: (file: string) => string | null): Selection;
```

  `rules` and `context` follow the order of `result.eligible`, split by `entry.kind`; a rule's `hits` are its hits from `result.hits` without the `rule` field. A rule whose `severity` is null in the model reports `advisory` (the spec's default). `srcText` reads `entry.src` through `readSrc`.
- Produces in `text.ts`: `renderText(selection: Selection): string`.
- Produces in `args.ts`: `parseCommand(argv: string[]): Command`, a union `{ name: "select"; ... } | { name: "verdicts"; selection: string; verdicts: string } | { name: "help" } | { name: "version" }`, throwing `UsageError` (exit 2) for an unknown flag, a missing change input, two change inputs, `--paths`/`--change`/`--base`/`--head` (named in the message as "not available yet"), or `--rules-ref` with `--no-repo`.
- Produces in `main.ts`: `run(argv: string[], io: { stdin: () => Promise<string>; stdout: (s: string) => void; stderr: (s: string) => void; isTTY: boolean }): Promise<number>`, and the module's top level calls it with `process` and exits with its result.

Flags in this slice: `--repo <dir>`, `--no-repo`, `--remote <url>` (repeatable), `--rules-ref <ref>`, `--given <dir>` (repeatable), `--diff <file|->`, `--format text|json` (default json when stdout is not a terminal, text when it is), `--capabilities <list>` (default `regex,ast-grep`), `--strict`, `--help`, `--version`. Without `--repo` and `--no-repo`, the repo is `findRepoRoot(cwd)`; none found exits 2 with `pass --repo or --no-repo`. `select` is always called with `fileContent: () => null` and `astGrepBinary: "ast-grep"` in this slice.

Text output, exact wording (rules section repeated per rule, context section per context, warnings only when any):

~~~markdown
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

## Rule `<id>` (<severity>, <category or "no category">)

<prose>

Flagged lines:

- `<file>:<line>` `<text>`

## Context `<id>`

<prose>

From `<src>`:

````
<srcText>
````

## Warnings

- `<name>` in `<file>` line <line> (entry `<entry>`)
~~~

"Flagged lines" is left out for a rule with no hits; "From" is left out when `srcText` is null. With no rules and no context, the whole output is `No Lore rules apply to this change.` followed by the warnings section if any.

- [ ] **Step 1: Write the failing tests**

- `selection.test.ts`: from a hand-built model and eligibility result (one rule with two hits, one context with `src`, one entry not eligible), `toSelection` gives the rules and context in order, hits without `rule`, `srcText` from a stub, `change` with `added` as line numbers, and `severity: "advisory"` for a null severity.
- `text.test.ts`: `renderText` of that selection equals a checked-in expected string `packages/cli/test/expected/select.md`; an empty selection renders exactly `No Lore rules apply to this change.\n` (Review Focus 3).
- `main.test.ts` (each in a temp git repo with one rule and a diff file):
  - `select --diff <file> --format json` prints a `Selection` whose `rules[0].id` is the rule, exit 0;
  - `--diff -` reads stdin;
  - an empty diff gives `rules: []`, exit 0 (Review Focus 3);
  - `--strict` with a broken Lore file exits 1, and without `--strict` exits 0 with the error in `excluded`;
  - a rule whose `addedMatches` pattern nests 1500 groups (past `MAX_GROUP_NESTING`, 1000): exit 2, stderr under 300 characters, no stack trace (Review Focus 4);
  - `--no-repo` without `--remote`, `--rules-ref` with `--no-repo`, `--paths x`, and two change inputs each exit 2 with a one-line message;
  - `--version` prints `0.1.0`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test packages/cli`
Expected: FAIL.

- [ ] **Step 3: Implement `selection.ts`, `text.ts`, `args.ts`, `main.ts`**

`main` catches `UsageError`, `InputError` and `RegexLimitError` (exit 2, message only); any other error is a bug and keeps its stack.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test packages/cli && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Look at the text output**

Run `bun packages/cli/src/main.ts select --no-repo --remote https://github.com/acme/shop --given <a temp loose folder with two rules and a context> --diff <a small diff> --format text` and read the output as a reviewer would. Fix anything that reads wrong (headings, spacing, a stray empty section) and update the expected file.

- [ ] **Step 6: Commit**

```bash
git add packages/cli
git commit -m "cli: lore select prints the selection as JSON or reviewer-ready text"
```

---

### Task 7: `lore verdicts`

**Files:**
- Create: `packages/cli/src/verdicts.ts`
- Modify: `packages/cli/src/main.ts`
- Test: `packages/cli/test/verdicts.test.ts`, `packages/cli/test/main.test.ts`

**Interfaces:**
- Consumes: `Selection` (Task 6).
- Produces:

```ts
export interface VerdictProblem { name: string; rule: string | null; detail: string }
export function checkVerdicts(selection: Selection, verdictSet: unknown): VerdictProblem[];
```

Names and when each applies (design, Verdicts):
- `invalid-verdict-set` (rule null): not an object with `lore: "1"` and a `verdicts` array; or a verdict that is not an object with a string `rule` and `verdict` in `pass`/`fail`/`not-applicable`, or with malformed `evidence` (each needs a string `file` and a positive integer `line`; `side` is `new` or `old` when present). One problem per malformed verdict; checking continues with the well-formed ones.
- `missing-verdict`: a rule in `selection.rules` with no verdict.
- `duplicate-verdict`: a second verdict for one rule (reported once per extra verdict).
- `unselected-verdict`: a verdict for an id not in `selection.rules` (a context id included).
- `fail-without-evidence`: a `fail` with no evidence.
- `evidence-outside-change`: a `new` location whose file is not the new path of a non-deleted file in `selection.change`, or an `old` location whose file is not a deleted or modified file's path or a renamed file's `oldPath`.
- `missing-note`: a `fail` or `not-applicable` without a non-empty `note`.

Problems are sorted by `rule` (null first), then `name`. Unknown extra fields are allowed.

`lore verdicts --selection <file> [<verdicts-file> | -]` prints `{ "problems": [...] }` as JSON; exit 0 with none, 1 with some, 2 when either file is unreadable or not JSON.

- [ ] **Step 1: Write the failing tests**

One test per problem name, each from a two-rule selection with a change of one modified file, one renamed file and one deleted file; plus: a complete, valid set gives `[]`; an `old`-side location on the deleted file's path passes; extra fields pass; the CLI test runs `verdicts` end to end with stdin and checks the exit codes 0, 1 and 2.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test packages/cli/test/verdicts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `checkVerdicts` and wire the command**

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test packages/cli && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "cli: lore verdicts checks a verdict set against a selection"
```

---

### Task 8: Bundle, CI and release

**Files:**
- Create: `.github/workflows/release.yml`, `packages/cli/test/smoke/` (a tracked given folder: `.loreconfig` with `repo: github.com/acme/shop`, `.lore/shop.lore` with one rule, and `change.diff`)
- Modify: `.github/workflows/ci.yml`, `packages/cli/README.md` (create: what the command does, the two commands with every slice flag, exit codes, how to build; no roadmap)

**Interfaces:**
- Consumes: the whole CLI.

- [ ] **Step 1: Build and run the bundle under both runtimes**

Run: `bun run --filter @lore/cli build && node packages/cli/dist/lore.js select --no-repo --remote https://github.com/acme/shop --given packages/cli/test/smoke --diff packages/cli/test/smoke/change.diff --format json && bun packages/cli/dist/lore.js --version`
Expected: JSON whose `rules[0].id` is the smoke rule; `0.1.0`. If the bundle pulls in a module Node cannot load, fix the build, not the call.

- [ ] **Step 2: CI**

In `ci.yml`, after `bun test`: the two commands from Step 1, plus the same `select` under `bun`, each checked with `jq -e '.rules[0].id == "<smoke rule id>"'`. Use `actions/setup-node@v4` with Node 20 for the Node run.

- [ ] **Step 3: Release workflow**

`release.yml` on push of tags `cli-v*`: checkout, setup-bun 1.4.3 (as CI), `bun install --frozen-lockfile`, `bun run --filter @lore/cli build`, then `gh release create "$GITHUB_REF_NAME" packages/cli/dist/lore.js --title "lore $GITHUB_REF_NAME" --notes "Single-file build of the lore command. Run with node or bun."` with `permissions: contents: write` and `GH_TOKEN: ${{ github.token }}`. A step first fails the run when the tag's version differs from `packages/cli/package.json`'s.

- [ ] **Step 4: Run every check**

Run: `bunx tsc --noEmit && bun test && bun run check`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add .github packages/cli
git commit -m "cli: bundle runs under node and bun in CI; tagged releases attach it"
```

Do not push a tag. Releasing is Matt's call once the branch is on main.
