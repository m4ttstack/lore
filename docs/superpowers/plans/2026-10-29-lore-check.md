# `lore check` and npm publishing: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `lore check` (uncommitted work) and `lore check <commit>` to the reference CLI with author-worded output, then publish the CLI to npm as `@mattstack/lore` 0.2.0.

**Architecture:** A new `src/change.ts` asks git for one unified diff (tracked changes plus `--no-index` diffs for untracked files) and feeds it to the existing `parseUnifiedDiff`, so `check` and `select` share one notion of a diff. `buildInput` can add untracked Lore files to the governed repo's files, `renderText` gains an author preamble, and `main.ts` runs `check` through the same selection path as `select`. The package is then renamed, made public, and published by hand.

**Tech Stack:** TypeScript, Bun (tests, `bun test`), esbuild bundle (`dist/lore.js`), git CLI, npm.

**Spec:** `docs/superpowers/specs/2026-10-29-lore-check-design.md`

## Global Constraints

- Work on branch `lore-check`, cut from `spec-design` at or after commit `04ea1b7` (equal to `origin/main`). Do not change `spec-design`.
- `lore check` compares the working tree with `HEAD` (staged, unstaged, and untracked files git does not ignore). `lore check <commit>` compares the commit with its first parent; a root commit compares with the empty tree.
- Rules come from the working tree. In `lore check` without a commit, untracked `.lore` and `.loreconfig` files that git does not ignore are read too. A context's `src` stays readable only when tracked.
- Options carried over from `select`: `--repo`, `--no-repo`, `--remote`, `--rules-ref`, `--given`, `--capabilities`, `--strict`, `--format text|json`. `--diff` is not accepted.
- Exit codes: 0 the check ran; 1 `--strict` given and entries excluded; 2 usage or input error; 70 internal error. A flagged line never changes the exit code.
- JSON output is exactly `select`'s selection shape.
- All git calls go through `git()` in `src/git.ts` (it sets `LC_ALL=C` and `GIT_NO_LAZY_FETCH=1`). Diff calls pass `--no-color --no-ext-diff --no-textconv -M --src-prefix=a/ --dst-prefix=b/`.
- npm package name `@mattstack/lore`, version `0.2.0`, binary `lore`, public, no runtime dependencies.
- Pushes, tags and the npm publish wait for Matt's go-ahead. Matt publishes with `/matt:npm-publish`; CI never publishes.
- Prose in docs and help text: no em or en dashes.

## Review Focus

- **A repo with no commits yet** (an agent's first files): `lore check` treats every file as added instead of failing on a missing `HEAD`. Pinned in Task 1.
- **Ignored files** (`node_modules/`, `.env` in `.gitignore`): never part of the change, never read as rules. Pinned in Task 1 and Task 2.
- **Git config that changes diff output** (`diff.noprefix`, `diff.mnemonicPrefix`, `color.ui=always`, `diff.external`): the change parses the same. Pinned in Task 1.
- **An untracked secret named as a context `src`:** untracked Lore files are read, but an untracked `src` target is not. Pinned in Task 2.
- **Running from a subdirectory:** paths stay repo-relative and untracked files outside the current directory are still included. Pinned in Task 4.

---

### Task 1: Build the change from git

**Files:**
- Create: `packages/cli/src/change.ts`
- Modify: `packages/cli/src/git.ts` (export `git`, add allowed exit codes, add `untrackedPaths`)
- Test: `packages/cli/test/change.test.ts`

**Interfaces:**
- Produces: `export function git(root: string, args: string[], okCodes: readonly number[] = [0]): string` in `git.ts`. On a nonzero exit listed in `okCodes` it returns the error's stdout; other failures throw as today.
- Produces: `export function untrackedPaths(root: string): string[]` in `git.ts`, from `ls-files -z --others --exclude-standard`, empty strings dropped.
- Produces: `export function changeDiff(root: string, commit: string | null): string` in `change.ts`, returning unified diff text that `parseUnifiedDiff` accepts.

- [ ] **Step 1: Write the failing tests** in `change.test.ts`, each building a temp repo (same helpers as `main.test.ts`: `tempDir`, `write`, a git runner with fixed user, `commit.gpgsign=false`) and asserting on `parseUnifiedDiff(changeDiff(root, ...)).files`:
  - `uncommitted: staged, unstaged and untracked files are all in the change`: kinds and added line numbers for one staged edit, one unstaged edit, one untracked file.
  - `uncommitted: an ignored untracked file is not in the change`: `.gitignore` lists `secret.env`; it is absent.
  - `uncommitted: a clean tree gives an empty change`: `files` is `[]`.
  - `uncommitted: a repo with no commits treats every file as added`: `git init`, write and `git add` one file, write one untracked file; both kind `A`.
  - `uncommitted: an untracked path git quotes is named exactly`: `src/é.ts` (git emits `"b/src/\303\251.ts"`).
  - `uncommitted: an untracked symlink to a file is added with its target as the one added line`.
  - `uncommitted: an untracked nested repository is skipped`: `nested/` holds its own `.git`; it is absent and nothing throws. (`ls-files --others` lists it as `nested/`, and `--no-index` exits 1 with empty stdout, so `okCodes [0, 1]` skips it. A symlink to a directory is skipped the same way.)
  - `uncommitted: an untracked binary file is added with no added lines`.
  - `uncommitted: diff config does not change the result`: repo config sets `diff.noprefix=true`, `diff.mnemonicPrefix=true`, `color.ui=always`, `diff.external=false`; result equals the unconfigured case.
  - `commit: compares with its first parent`: second commit changes one file; only that file.
  - `commit: a root commit compares with the empty tree`.
  - `commit: a merge commit compares with its first parent`: merge brings in a file from a side branch; that file is in the change, files changed only on the first-parent line are not.
  - `commit: an unknown commit is an input error`: throws `InputError` with message `not a commit: nope`.
  - `commit: a value starting with - is an input error`: `--help` throws `InputError` with message `not a commit: --help`.

- [ ] **Step 2: Run them to see them fail**

  Run: `bun test packages/cli/test/change.test.ts`
  Expected: FAIL, `changeDiff` not exported.

- [ ] **Step 3: Implement `git` changes, `untrackedPaths` and `changeDiff`**

  Empty tree: `git(root, ["hash-object", "-t", "tree", "--stdin"])` (stdin is ignored, so this hashes the empty tree in SHA-1 and SHA-256 repos). Uncommitted base: `rev-parse --verify --quiet HEAD` with `okCodes [0, 1]`, empty output means the empty tree. Commit: reject a leading `-`, resolve with `rev-parse --verify --quiet --end-of-options <commit>^{commit}`, first parent from `rev-list --parents -n 1 <sha>`. Tracked part: `diff <flags> <base> --` (uncommitted) or `diff <flags> <parent> <sha> --` (commit). Untracked part (uncommitted only): one `diff <flags> --no-index -- /dev/null <path>` per `untrackedPaths` entry with `okCodes [0, 1]`, concatenated after the tracked part.

- [ ] **Step 4: Run them to see them pass**

  Run: `bun test packages/cli/test/change.test.ts`
  Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/cli/src/change.ts packages/cli/src/git.ts packages/cli/test/change.test.ts
  git commit -m "cli: build a change from uncommitted work or one commit"
  ```

### Task 2: Read untracked Lore files

**Files:**
- Modify: `packages/cli/src/input.ts` (`RuleSources`, `buildInput`)
- Test: `packages/cli/test/input.test.ts`

**Interfaces:**
- Consumes: `untrackedPaths(root)` from Task 1.
- Produces: `RuleSources.untrackedLore?: boolean` (default false). When true, the governed repo is not null and `rulesRef` is null, `buildInput` appends untracked paths that are a `.lore` file inside a `.lore/` folder or a `.loreconfig` outside one (the existing `wantsContent` test) to the governed paths before reading. The set used by `readSrc` (`governedTracked`) is built before that append, so it stays tracked-only.

- [ ] **Step 1: Write the failing tests** in `input.test.ts`:
  - `untrackedLore reads an untracked Lore file`: `.lore/new.lore` untracked; its entry is in the parsed model.
  - `untrackedLore reads an untracked .loreconfig`.
  - `without untrackedLore an untracked Lore file is not read`.
  - `untrackedLore never reads an ignored Lore file`: `.lore/local.lore` in `.gitignore`.
  - `untrackedLore does not make an untracked src readable`: tracked context with `src="secret.txt"`, `secret.txt` untracked; `readSrc("secret.txt")` is `null`.
  - `untrackedLore is ignored with rulesRef`: rules come from the ref only.

- [ ] **Step 2: Run them to see them fail**

  Run: `bun test packages/cli/test/input.test.ts`
  Expected: FAIL on the two tests that read an untracked file.

- [ ] **Step 3: Implement `untrackedLore` in `buildInput`**

- [ ] **Step 4: Run them to see them pass**

  Run: `bun test packages/cli/test/input.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/cli/src/input.ts packages/cli/test/input.test.ts
  git commit -m "cli: read untracked Lore files when asked"
  ```

### Task 3: Author text output

**Files:**
- Modify: `packages/cli/src/text.ts`
- Test: `packages/cli/test/text.test.ts`

**Interfaces:**
- Produces: `export function renderText(selection: Selection, audience: "reviewer" | "author" = "reviewer"): string`. `"reviewer"` output is unchanged byte for byte. `"author"` replaces `PREAMBLE` with `AUTHOR_PREAMBLE`; every other section, cap and the "No Lore rules apply" line are shared.

- [ ] **Step 1: Write the failing tests** in `text.test.ts`, using the fixtures in `test/fixtures.ts`:
  - `author text starts with the author preamble`: output starts with `AUTHOR_PREAMBLE` exactly (copy below).
  - `author text asks for no verdicts`: output contains neither `lore-verdicts` nor `Answer every rule`.
  - `author text keeps the rule, flagged-line and context sections`: the text after the preamble equals the reviewer output after its preamble.
  - `the reviewer output is unchanged`: the existing `test/expected/select.md` comparison still passes with the default argument.

  Exact copy for `AUTHOR_PREAMBLE`:

  ```
  # Lore rules for this change

  These rules apply to your change. Fix any that your change breaks.

  A flagged line is a place to look, not a verdict. Read the context below before changing code. Judge only by these rules; never invent rules from other prose.
  ```

- [ ] **Step 2: Run them to see them fail**

  Run: `bun test packages/cli/test/text.test.ts`
  Expected: FAIL on the three author tests.

- [ ] **Step 3: Implement the `audience` parameter and `AUTHOR_PREAMBLE`**

- [ ] **Step 4: Run them to see them pass**

  Run: `bun test packages/cli/test/text.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/cli/src/text.ts packages/cli/test/text.test.ts
  git commit -m "cli: author-worded text output"
  ```

### Task 4: The `check` command

**Files:**
- Modify: `packages/cli/src/args.ts`, `packages/cli/src/main.ts` (dispatch, `HELP`, shared selection path)
- Test: `packages/cli/test/main.test.ts` (new `describe("lore check")`)

**Interfaces:**
- Consumes: `changeDiff` (Task 1), `RuleSources.untrackedLore` (Task 2), `renderText(selection, "author")` (Task 3).
- Produces: `export interface CheckCommand` in `args.ts`: `SelectCommand`'s fields without `diff`, with `name: "check"` and `commit: string | null`. `Command` gains `CheckCommand`. Usage: `lore check [<commit>] [rules] [options]`. One positional argument at most (the commit). `--diff` is a usage error with the message `lore check builds the change itself; use lore select --diff for a diff`. The missing-command message lists `select, check or verdicts`.
- `runCheck` reuses `runSelect`'s steps (governed repo, `buildInput`, parse, `selectParsed`, `toSelection`, format choice, exit code) with the change from `changeDiff(changeRoot, command.commit)`, `untrackedLore: command.commit === null`, and the author audience for text. Factor the shared steps into one function instead of copying them. `changeRoot` is the `--repo` working copy, or the git root above the current directory, also under `--no-repo`: `--no-repo` only stops rules being read from that repo (rules kept in a pack come from `--given` with `--remote`). Unlike `select`, `check` accepts `--repo` together with `--no-repo` (the repo is then only where the change comes from), so a pack's rules can check a repo from outside it. With no working copy to read the change from, `check` is an input error: `lore check needs a git working copy: run it inside one or pass --repo`. Without a git binary the message is `git is not installed; lore check needs it`.
- `HELP` gains the `lore check [<commit>] [rules] [options]` usage line, a one-line description (a `<commit>` line, if any, in the same description column as the option lines, which the alignment test checks), and the exit-code line `lore check     0 the check ran, 1 --strict was given and entries were excluded`. The `both` exit-code line becomes `all            2 usage or input error, 70 internal error`; update the existing `main.test.ts` assertion on that line.

- [ ] **Step 1: Write the failing tests** under `describe("lore check")`, using `repoWith` and `lore(...)`, with `RULE` from the file:
  - `checks uncommitted work, untracked files included`: an untracked `src/p.ts` adding `USD`; JSON `rules[0].id` is `no-usd` and its hit names `src/p.ts`.
  - `checks one commit`: commit adding `USD`, then a clean tree; `lore check HEAD` selects `no-usd`, `lore check` selects nothing.
  - `text output uses the author preamble`: `isTTY: true`; stdout starts with `# Lore rules for this change\n\nThese rules apply to your change.`
  - `an untracked rule applies to uncommitted work`: rule file itself untracked; it is selected.
  - `exits 0 when a rule has flagged lines`.
  - `--strict exits 1 when entries are excluded`.
  - `--diff is a usage error`: exit 2, stderr has the message above.
  - `two commits are a usage error`: `lore check a b`, exit 2.
  - `--no-repo reads rules only from --given and the change from the working copy`: `--repo <root> --no-repo --given <loose folder> --remote <url>`, an untracked violating file in the repo; the given rule is selected and a rule in the repo's own `.lore/` is not.
  - `outside a working copy it is an input error`: exit 2, stderr names `lore check needs a git working copy`.
  - `from a subdirectory, untracked files elsewhere in the repo are included`: run with the working directory in `src/sub/`, untracked `lib/q.ts` adding `USD` with a rule scoped to `lib/**`; selected, hit path `lib/q.ts`. (Use the existing pattern for tests that change `process.cwd()`.)
  - `--help lists lore check`.

- [ ] **Step 2: Run them to see them fail**

  Run: `bun test packages/cli/test/main.test.ts`
  Expected: FAIL in `lore check`, unknown command.

- [ ] **Step 3: Implement `CheckCommand`, its parser, `runCheck` and the shared selection path**

- [ ] **Step 4: Run the CLI tests and the type check**

  Run: `bun test packages/cli && bunx tsc --noEmit`
  Expected: all CLI tests PASS, no type errors.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/cli/src packages/cli/test
  git commit -m "cli: lore check for uncommitted work or one commit"
  ```

### Task 5: Package and docs for npm

**Files:**
- Modify: `packages/cli/package.json`, `packages/cli/README.md`, `README.md`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `bun.lock` (via `bun install`)
- Create: `packages/cli/LICENSE` (copy of the root `LICENSE`)

**Interfaces:**
- `package.json`: `name` `@mattstack/lore`, `version` `0.2.0`, no `private`, `description` `The reference command for Lore, portable domain rules for code review.`, `repository` `{ "type": "git", "url": "git+https://github.com/m4ttstack/lore.git", "directory": "packages/cli" }`, `homepage` `https://github.com/m4ttstack/lore#readme`, `keywords` `["lore", "code-review", "rules", "ai-agents"]`, `files` `["dist"]`, `publishConfig` `{ "access": "public" }`, `scripts.prepublishOnly` `bun run build`. `@lore/parser` moves from `dependencies` to `devDependencies` (the bundle inlines it and `yaml`), so `dependencies` is gone.
- Both workflows: `--filter @lore/cli` becomes `--filter @mattstack/lore`.

- [ ] **Step 1: Apply the `package.json`, `LICENSE`, workflow and lockfile changes**

- [ ] **Step 2: Verify the tarball and that it runs from it**

  Run, from `packages/cli`: `bun run build && npm pack --dry-run --json | jq -r '.[0].files[].path' | sort`
  Expected: exactly `LICENSE`, `README.md`, `dist/lore.js`, `package.json`.

  Run, from `packages/cli`: `npm pack && npx --yes ./mattstack-lore-0.2.0.tgz --version && rm mattstack-lore-0.2.0.tgz`
  Expected: prints `0.2.0`.

- [ ] **Step 3: Docs**
  - `packages/cli/README.md`: the opening says it has three commands; a `## lore check` section after `lore select` with the usage line, both modes, what is read (untracked files, untracked Lore files, `src` stays tracked-only), the author output, options carried over, and `lore check` in Exit codes; an install line `npm install --save-dev @mattstack/lore` (or `npx @mattstack/lore`); the Build section's filter name.
  - `README.md` Try it: lead with `npx @mattstack/lore check`, keep the `select` and `verdicts` examples (as `npx @mattstack/lore select ...`), keep the release-asset download as an alternative with its URL on `cli-v0.2.0`, and add the `AGENTS.md` snippet from the design doc: ``After editing files, run `lore check` and fix any rule your change breaks.`` (with a note to add `@mattstack/lore` as a dev dependency so `lore` is on the path in package scripts, or to write `npx @mattstack/lore check`).
  - `README.md` "Lore or a skill?": its last paragraph says a skill can end by running `lore check` instead of `lore select`.
  - `README.md` Roadmap item 3: the `lore` command (`select`, `check` and `verdicts`) is on npm as `@mattstack/lore`, a preview; item 5 keeps "Packages go to npm once the format's name is final" only for the other packages.

- [ ] **Step 4: Full local check**

  Run, from the repo root: `bun run build && bunx tsc --noEmit && bun test && bun run check`
  Expected: all pass.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/cli README.md .github/workflows bun.lock
  git commit -m "cli: publish as @mattstack/lore 0.2.0"
  ```

### Task 6: Ship (controller only, each step after Matt's go-ahead)

- [ ] **Step 1:** Ask Matt how `lore-check` reaches `main` (PR with CodeRabbit and CI, or a direct fast-forward push), then do that. CI on `main` must be green.
- [ ] **Step 2:** Tag `cli-v0.2.0` on the merged `main` commit and push the tag. Expected: the `release` workflow passes and the GitHub release `lore cli-v0.2.0` has `lore.js`.
- [ ] **Step 3:** From `packages/cli` at the tag, publish with `/matt:npm-publish`.
- [ ] **Step 4:** After the 3 to 5 minute registry lag: `npm view @mattstack/lore version` prints `0.2.0`, and in a scratch repo with a rule and an untracked violating file, `npx --yes @mattstack/lore@0.2.0 check --format json` selects the rule.
