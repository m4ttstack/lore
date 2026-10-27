# Lore editor tooling: design

Status: draft for review, 2026-10-26. Step 2 of 5.

Builds on the step 1 specification (`spec/SPEC.md`, 96 conformance
examples) and its design (`2026-10-25-lore-spec-design.md`).

## Why

Step 1 defined Lore precisely enough that two tools agree on every
example. Nobody can use it comfortably yet: `.lore` files show up as plain
text (or as Markdown, through a `.gitattributes` override), mistakes are
only found by reading the spec, and nothing in the editor tells an engineer
that a rule covers the file they are changing.

Step 2 makes Lore pleasant to write and visible while working. The first
real use is a team converting its existing review rules into Lore, with
the rules kept in a separate repository and mapped onto the code
repository through `repo`. That use shapes two requirements below: support
for external folders in the editor, and a "which rules apply here" view.

It also produces the **reference parser**. Every later step (applying
rules in step 3, the review integration in step 4, the team view in step
5) builds on it, so it has to be exact, not approximate.

## Goals

- A reference parser that implements the whole spec, parsing and
  selection, and passes all 96 conformance examples, including those
  marked `requires: regex` and `requires: ast-grep`.
- Syntax highlighting for `.lore` files in VS Code, Cursor and Zed, with
  YAML highlighted inside structured blocks and Markdown inside prose.
- A Prettier plugin that gives `.lore` files one canonical layout.
- A language server for authoring: the spec's errors and warnings as you
  type, completion, and hover documentation.
- "Which rules apply here": in any source file, the editor names the Lore
  rules whose scope covers it and jumps to them.
- External Lore folders work in the editor, so rules kept in another
  repository show up against the code they govern.

## Non-goals (this step)

- Previewing which rules a working-tree diff triggers. That is selection
  against a change, which belongs with step 3 (applying rules).
- Glob and regex helpers (hover a glob to list matching files, test a
  pattern). Useful, later.
- Highlighting on GitHub or GitLab. Linguist accepts a new language only
  once it is in wide use; the `.gitattributes` Markdown override stays.
- Publishing anything. No npm packages, no VS Code Marketplace or Open VSX
  listing, no Zed registry entry, until the format's name is settled.
- Other editors (JetBrains, Neovim, Helix). The language server is
  standard LSP and the tree-sitter grammar is reusable, so they can follow
  without new design.

## Anti-goals

- A parser that is "close enough". If the reference parser disagrees with
  a conformance example, the parser is wrong (or the spec is, and the spec
  gets fixed first, through its own review).
- Highlighting grammars that decide validity. They colour; only the parser
  reports errors.
- A formatter that changes meaning. Formatting may restyle prose the way
  Prettier restyles any Markdown, but never changes a file's structure
  (ids, attributes, scopes, conditions, checks, meta) or what its prose
  says.
- Tool-specific terms in the public repository. The editor tooling, like
  the spec, carries no product or employer names.

## Constraints

- Everything lives in this repository, MIT licensed (the spec text stays
  CC-BY-4.0, `spec/AGENT.md` CC0).
- Bun and strict TypeScript, as step 1. The packages must also run under
  Node, because VS Code extensions and Prettier plugins run there.
- No native dependencies in the parser except ast-grep, which only
  `<check lang="ast-grep">` needs. It is pinned to the release the spec
  names (0.51.0) and used only when such a check runs, so a tool without
  it still parses and selects (reporting the capability as unsupported,
  as the spec allows).
- Every package is `private: true`.
- The format's name may change. Package and extension identifiers keep
  `lore` in one obvious place each so a rename is mechanical.

## Approaches considered

| Approach | Trade-off | Outcome |
|---|---|---|
| **A. Hand-written TypeScript parser; TextMate and tree-sitter grammars for highlighting only** | Three descriptions of the syntax to keep consistent, but the highlighting ones are forgiving: drift shows as a wrong colour, never a wrong verdict. Mirrors the spec's line-by-line rules, so conformance is easiest to prove. | **Chosen.** |
| B. Tree-sitter grammar as the parser's front end (via its WebAssembly build), TypeScript applying the spec's rules on top | One grammar, but tree-sitter's error recovery differs from the spec's (first error wins, line-shaped tags, fences inside prose), so the rules would be re-checked anyway; brings WebAssembly into Prettier and the language server. | Rejected. |
| C. Parser generator (Peggy, Chevrotain) | Reads cleanly, but Lore is defined by lines and context (column-0 tags, indentation, fences, "a tag only where one can be"), a poor fit; YAML and Markdown still need their own libraries. | Rejected. |

## Decided

### Layout

A Bun workspace in this repository:

```
packages/
  parser/              reference parser: parse, collect, select
  prettier-plugin/     Prettier plugin for .lore
  language-server/     LSP server (stdio)
  vscode/              VS Code and Cursor extension: TextMate grammar,
                       language configuration, LSP client
  tree-sitter-lore/    tree-sitter grammar and highlight queries
  zed/                 Zed extension: language config, grammar reference,
                       language server launch
spec/, tools/check/    unchanged; the spec checker stays where it is
```

The conformance examples become the parser's test suite directly: the
parser's tests read `spec/SPEC.md` through `tools/check/extract.ts` and
compare each example's output to its `=== expect` as JSON values, as the
spec's Conformance examples section describes.

### Reference parser

- Two entry points, matching the two example kinds:
  - **parse**: Lore files (plus the `.loreconfig` files that apply to
    them) to the document model of `document-model.schema.json`.
  - **select**: collected files, given folders, a remote and a change to
    the eligibility result of `eligibility.schema.json`.
- Collection (finding tracked `.lore/` folders and `.loreconfig` files,
  given folders, `repo` matching) works over an abstract file source, so
  the same code serves a real git checkout, an editor's open buffers, and
  the conformance examples' in-memory files.
- Structured blocks are read with the `yaml` library (YAML 1.2 core
  schema) plus the spec's extra checks (duplicate keys, disallowed
  features, line rules).
- Its own glob matcher and regex-dialect validator, written to the spec,
  not borrowed from a library whose syntax differs.
- Regex checks run by translating the dialect to an ECMAScript pattern,
  as the spec's translation note describes.
- ast-grep checks run the pinned ast-grep 0.51.0 command-line binary
  (from its npm package) as a subprocess, not the Node bindings: the
  bindings build in only a few languages, while the binary matches the
  spec's whole extension-to-language table (my call). Without the binary,
  the parser reports the `ast-grep` capability as unsupported.
- Diagnostics carry a source range as well as the spec's line, so the
  language server can underline the exact span. The range is extra; the
  conformance output is exactly the spec's.

### Highlighting

- **TextMate grammar** (VS Code, Cursor): scopes for top-level and child
  tags, attribute names and values, comments; YAML embedded in
  `<defaults>`, `<scope>`, `<when>`, `<meta>`; Markdown embedded in prose;
  `<check>` bodies as a regex or plain string.
- **tree-sitter grammar** (Zed): the same structure, with injections for
  YAML and Markdown and highlight queries using Zed's standard captures.
- Both are tested against a shared set of fixture files (every example
  input in the spec, plus a few hand-written ones) for "doesn't crash,
  covers the tags".

### Prettier plugin (Matt's pick: indented, like the README)

- Child elements, YAML and prose sit one level inside each top-level
  element: two spaces, or one tab when Prettier's `useTabs` is set.
- Top-level tags stay at column 0. One blank line between top-level
  elements.
- YAML is printed by Prettier's own YAML printer. (It keeps single
  quotes on a scalar holding a backslash, so regex patterns such as
  `'\.'` survive.)
- Prose is split at its first blank line outside a fenced code block
  (using the spec's fence rule for entries). The first part holds the
  summary, which the spec finds by lines (a list directly under the
  first sentence belongs to it), so it is only re-indented, otherwise
  kept exactly as written (trailing spaces included, since two of them
  are a Markdown hard break), and never passed to the Markdown printer:
  the printer
  would insert a blank line before such a list and change the summary.
  The rest of the prose goes through Prettier's Markdown printer with
  `proseWrap: preserve`, which restyles it as it does in `.md` files
  (`*em*` to `_em_`, `*` bullets to `-`, list numbering, table padding,
  `~~~` fences to backticks); that is accepted.
- Order of operations: the Markdown printer runs on the dedented prose,
  and the result is then re-indented. Prose is never emitted flush-left,
  which matters because the printer dedents a ` </rule>` line inside
  prose to column 0, where it would close the entry.
- A `<check>` body is never reformatted: its text is a pattern, so it is
  only re-indented.
- Top-level `<!-- -->` comments are kept where they are, at column 0,
  byte for byte. The round-trip test cannot see comments (the model drops
  them), so a separate test checks that every comment survives.
- Attributes in a fixed order: `id`, `category`, `severity`, `src`,
  `lang`, `disabled` (my call).
- A file with a file-level error is returned unchanged; an entry with an
  entry-level error is left as written, the rest of the file formatted.
- Formatting is idempotent and never changes meaning. Test: for every
  conformance input that parses without file-level errors, the formatted
  text parses to the same model, comparing every field exactly (the
  `summary` included) except `prose`, whose part after the first blank
  line is compared after running both through Prettier's Markdown
  printer, and diagnostic lines, which formatting may move; and
  formatting it again changes nothing.

### Language server

Authoring (Matt's pick):

- Diagnostics: every error and warning the parser reports for the open
  `.lore` or `.loreconfig` file, on the exact span, named by its registry
  name, with the registry description. `missing-src-target` appears only
  when the governed repository's files are known.
- Completion: tag and child names, attributes, the categories in effect
  for the file (fixed plus `.loreconfig`), severity values, check
  languages, `<when>` keys, and known ids in `disable` lists.
- Hover: the description of an error or warning; what a tag, attribute
  or `<when>` key means, from short texts derived from the spec; the
  resolved scope of an entry.

Which rules apply here (Matt's pick):

- In any non-Lore file under a governed repository, a code lens at the
  top lists the rules and context whose scope covers the file, each
  jumping to its entry. Disabled entries and entries switched off for
  that path by a `disable` list are left out.
- Scope only: `<when>` conditions depend on a change and are not
  evaluated, so the lens reads "could apply" (my call on wording).

Which files the editor sees (my call):

- The spec's collection rule (tracked files only, as the change leaves
  them) governs review results. The editor is an authoring aid, so the
  language server counts tracked files plus untracked files git does not
  ignore, and reads open buffers over the files on disk. A new or unsaved
  `.lore` or `.loreconfig` file therefore takes effect at once. The
  parser's collection takes the file list and contents from its abstract
  file source, so the editor and step 3's strict tools differ only in the
  source they pass in. Diagnostics, completion and the "could apply" lens
  all use this same relaxed file list. This difference is stated in the
  extension's README.

External folders (Matt's pick: an editor setting):

- A `lore.externalFolders` setting (user or workspace) lists given folders
  on disk. The server matches them to each open repository through
  `repo` and the repository's remotes, exactly as the spec's External
  folders section describes.
- A `.lore` file opened inside the rules repository gets the full
  authoring diagnostics; anything that needs the governed repository's
  files is reported only when that repository is also known.

### Editor packaging (Matt's pick: repo-only)

- VS Code and Cursor: one extension, built into a `.vsix` by a repo
  script and installed by hand. It bundles the TextMate grammar and starts
  the language server.
- Zed: a dev extension installed from `packages/zed`, pointing at the
  tree-sitter grammar in this repository and launching the same language
  server.
- The language server is one Node program both editors start over stdio.

## Done means

1. The parser passes all 96 conformance examples, read straight from
   `spec/SPEC.md`, in CI.
2. The formatter's round-trip test passes in CI.
3. The grammars' fixture tests pass in CI.
4. In VS Code or Cursor (one extension serves both; checking one is
   enough) and in Zed, a `.lore` file shows highlighting, live
   diagnostics, completion and hover.
5. With `lore.externalFolders` pointing at a rules repository, opening a
   source file in the governed repository shows the "could apply" lens
   with the rules from that external folder, and jumping works.

## Left to the builder

- Package-internal structure, module names and the parser's public API
  shape, as long as the two entry points and the abstract file source
  exist.
- How the TextMate and tree-sitter grammars are tested beyond the fixture
  check.
- Hover and completion texts, written plainly and kept consistent with
  the spec.
- Whether the language server re-parses on every keystroke or debounces.
- The `.vsix` build tooling.
- How the Zed extension reaches the grammar. Zed's `extension.toml`
  names a grammar by git repository URL and commit, with an optional
  path inside it, so a local dev setup means a `file://` URL to this
  repository, `path = "packages/tree-sitter-lore"`, and a commit that is
  bumped after each grammar change. A helper script for the bump is
  welcome.
