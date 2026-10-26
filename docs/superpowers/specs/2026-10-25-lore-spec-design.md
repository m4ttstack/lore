# Lore spec: design

Status: draft for review, 2026-10-25. Step 1 of 5.

"Lore" is a working name (see "Name").

## Why

A team's domain knowledge decides whether a change is right as often as
generic code quality does: "a value's source must come from the exact data
that derived it", "every GraphQL change ships with regenerated types". Today
that knowledge lives in long prose: agent skills, `AGENTS.md` files, review
docs, agent plugins. The prose links to more prose, the same rule is written
twice for two areas of the code, and a reviewer gets all of it or none of
it.

That has three costs:

- **Hard to maintain.** Adding, changing or retiring one rule means editing
  a long document and hoping nothing else depended on the paragraph.
- **No selection.** Nothing knows which rules matter for a given change, so
  a reviewer either reads everything or misses rules. One team in the first
  adopter's org has a whole rule set that never reaches review because the
  instructions that load it only trigger on a different directory.
- **No record.** Nobody can say which rules a review actually checked.

Lore is an open file format for that knowledge. Each rule is a separate,
named unit with a scope (which files it can be broken in), optional content
conditions, a category and a severity. Tools find the rules that apply to a
change by code, not by reading prose, and hand them to a reviewer.

It is a specification, not a product, the way GraphQL is a spec with many
implementations. Any repo can adopt it, and an agent with no tooling can
read a Lore file and know what to do with it. The first implementation is
an agent review pipeline, which will add tooling (editor support, review
integration, an editing view), but the format carries none of its terms
and needs no particular tool to be useful.

Prior art and how Lore differs:

| Project | What it has | What Lore adds |
|---|---|---|
| Aviator Verify invariants | Categories, path/language conditions, a verdict per rule, waivers | Stored as files, not in a hosted account; an open format |
| AGENTS.md | A vendor-neutral convention | Fields: scope, conditions, categories, severity |
| Copilot `.instructions.md`, Cursor rules, Claude Code `.claude/rules` | Glob-scoped context | Tool-neutral; review rules, not editor context; content conditions |
| Open Context Standards (draft, stalled 2025) | A neutral `.context/` folder, `appliesTo` globs | Categories, conditions beyond globs, review meaning |

## The build, and where this step sits

1. **The spec** for `.lore` and `.loreconfig` (this document).
2. Editor integrations: a Prettier plugin, a language server, syntax
   highlighting (a TextMate grammar embedding YAML and Markdown). They come
   with the reference parser.
3. How Lore is applied: going from files plus a diff to a verdict, and what
   an agent does and does not do. A web playground (paste Lore and a diff,
   see what applies) is its demo, using the conformance examples as
   fixtures.
4. A first integration into an agent review pipeline.
5. A team view for browsing and editing rules.

The first adopter's rules (about 100, spread across agent plugins and
in-repo skills and docs) get converted as the test bed for step 3. The full
conversion is done before the format is proposed to that team.

## Goals

- A written, versioned specification of the `.lore` file format, the
  `.lore/` folder convention and the `.loreconfig` file.
- Deterministic eligibility: given a set of Lore files and a diff, every
  conforming tool, in any language, computes the same set of eligible rules
  and context.
- A spec testable by any implementation: numbered conformance examples
  (input and expected output), JSON Schemas for every structured block, and
  a small checker that keeps the examples and schemas valid.
- Files a plain agent reads correctly with no tooling, plus a short
  paragraph a team pastes into its existing agent instructions to make that
  happen today.

## Non-goals

- **How a rule is applied to produce a verdict** (the reviewer's procedure,
  the verdict and waiver shape, fan-out). That is step 3. This spec stops at
  "these rules and context are eligible, and these check hits were found".
- Parser, formatter, language server, highlighting (step 2).
- Review pipeline integration and the team view (steps 4 and 5).
- Using Lore while code is being written (as editor context). The format
  allows it later; it is not designed for here.
- Converting any team's rules.

## Anti-goals

- **A format tied to one tool.** No tool-specific terms, paths or behavior
  in the spec. A team that uses none of the first implementation's tooling
  loses nothing.
- **Reading a file requires running code.** No executable config (no
  `lore.config.js`), and no shell commands as checks.
- **A check that decides by itself.** A `<check>` points a reviewer at
  lines; it never passes or fails a rule. Deterministic pass/fail belongs to
  linters and CI.
- **A rule that escapes its file's scope.** A rule's own scope only ever
  narrows the scope of the file it is in.
- **Meaning hidden in machinery.** A rule's prose states the whole rule.
  Conditions and checks select and hint; they never add meaning a reader of
  the prose would miss.
- **Team internals in the spec.** This repo is public. Examples use a
  fictional app.

## Constraints

- Zero special dependencies to read. Parsing a `.lore` file needs a YAML 1.2
  parser and the spec's tokenizing rules, nothing else.
- UTF-8 text, line-oriented, friendly to diffs and code review.
- The name may change before the spec is published as stable: `lorehq/lore`
  already uses a `.lore/` folder for a different purpose.

## Approaches considered

| Question | Options | Picked, and why |
|---|---|---|
| Where rules are stored | A database behind an editing view; files | Files. Git is the source of truth and history; a page or index is built from them. |
| Prose rules vs structured rules | Rules only; context docs only; two kinds | Two kinds, as Aviator separates invariants from runtime context. Rules get verdicts; context is reference prose that is loaded when relevant but never scored. |
| File format | Markdown + frontmatter; YAML; JSON with prose in sibling files; executable JS config; a single-file format with tagged sections | Tagged sections, in the style of Svelte and Vue single-file components. YAML or JSON where tools query, Markdown where people write. Agents already read XML-tagged text natively. Markdown frontmatter has no good per-rule structure; YAML and JSON are poor at long prose with code samples; JS config must be executed. |
| Its own language, or Markdown | `.lore` (own language); `.lore.md` with loose YAML; `.lore.md` with YAML in fenced code blocks | Own language. Most concise; reviewers read rule changes as diffs, so GitHub's rendered view matters less than brevity. Until Lore has its own grammar, a one-line Linguist override highlights it as Markdown. |
| Structured blocks | JSON only; YAML only; `lang` attribute per block; YAML 1.2 (which accepts JSON) | YAML 1.2. JSON is valid YAML 1.2, so a team writes whichever it prefers with no attribute to declare. |
| Where files live | One root folder; next to the code; either | Either. A `.lore/` folder may sit anywhere; globs resolve relative to it, so a set can move with its code. A folder outside the repo maps to it with `repo`. |
| A rule's scope vs its file's scope | Replaces; narrows | Narrows. A file's scope keeps its meaning; rules that cross areas go in a file with a wider scope. |
| Code in rules | None; content conditions only; conditions and search hints | Both: `<when>` for selection, `<check>` for hints to the reviewer. "Files that change together" is a `<when>` condition, so `<check>` is only ever a line pattern. |
| Turning rules off | Only the rule's own file; also from the consumer's side | Both. `disabled` on the rule is the author's switch; `disable` in `.loreconfig` is the consumer's, as ESLint's `"off"` is. A shared Lore folder is not all-or-nothing. |
| Categories | Fixed list; free-form; fixed + custom | Aviator's nine fixed, plus categories declared in `.loreconfig`, inherited down the tree. |
| Severity | Two levels; three; RFC 2119 words; configurable | Two: `blocking` and `advisory`. Rule authors think in must versus should; tools map to their own scales. |
| How the spec is written | Prose + schemas; prose + schemas + conformance examples; grammar-first | Conformance examples, as CommonMark does. Every implementation (parser, formatter, LSP, selector) tests against one shared set. |
| Where the project lives | Inside the first implementation's repo; its own repo | Its own public repo, so it reads as a neutral format and versions on its own. |
| License | One license; spec and code split | CC-BY-4.0 for the specification text, MIT for schemas, examples and code. |

## The format

### Folders and files

- Lore files have the extension `.lore` and live in a folder named `.lore/`
  (subfolders inside it are allowed, for grouping).
- A `.lore/` folder may sit in any directory. The directory that contains
  it is the folder's **base**: globs and `src` paths in its files resolve
  relative to the base.
- A set of rules can be one large file or many small ones; the split carries
  no meaning.
- Only files under version control count: a tool collects `.lore/` folders
  and `.loreconfig` files tracked by the repo, never a filesystem walk. A
  dependency's `node_modules/**/.lore/` or an ignored scratch folder can't add
  rules to a review.

```
.lore/backend.lore                       base: repo root
apps/web/src/checkout/.lore/rules.lore   base: apps/web/src/checkout/
```

### A `.lore` file

```
<!-- apps/web/src/checkout/.lore/pricing.lore -->
<defaults>
category: functional_correctness
severity: blocking
</defaults>

<scope>
files: ["**/*.{ts,tsx,graphql}"]
ignores: ["**/*.test.{ts,tsx}"]
</scope>

<rule id="price-from-quote">
<meta>
source: docs/pricing-review.md#prices
owner: checkout
</meta>
A displayed price must come from the quote that produced it.

No helper may recompute a price separately from the quote, even when the
inputs look identical: the quote carries discounts the inputs don't.
</rule>

<rule id="currency-from-settings" severity="advisory">
<when>
addedContains: ["'USD'", "'EUR'"]
</when>
<check>
'(USD|EUR)'
</check>
Display text never hard-codes a currency code; it uses the shop's `currency`
setting.
</rule>

<rule id="regen-types-after-graphql">
<scope>
files: ["**/*.graphql"]
</scope>
<when>
unchanged: ["/apps/web/src/__generated__/**"]
</when>
A `.graphql` change ships with regenerated types in
`apps/web/src/__generated__/`.
</rule>

<context id="checkout-architecture" src="ARCHITECTURE.md">
Read before judging any change to how a price is computed.
</context>
```

Top-level elements:

| Element | Contents | Count |
|---|---|---|
| `<defaults>` | YAML: `category`, `severity` defaults for every rule in the file | 0 or 1, before any entry |
| `<scope>` | YAML: `files`, `ignores` (globs). The scope of every rule and context in the file | 0 or 1, before any entry |
| `<rule>` | Child elements, then Markdown prose | any |
| `<context>` | Child elements, then optional Markdown note | any |
| `<!-- -->` | Comment, ignored | any |

Blank lines between elements are allowed. Any other text at the top level is
an error.

### Rules

Attributes:

| Attribute | Required | Meaning |
|---|---|---|
| `id` | yes | kebab-case (`^[a-z][a-z0-9-]*$`); unique across every Lore file that applies to the same repo |
| `category` | no | one of the nine fixed categories or one declared in `.loreconfig`; falls back to `<defaults>`, then to none (a warning) |
| `severity` | no | `blocking` or `advisory`; falls back to `<defaults>`, then to `advisory` |
| `disabled` | no | bare boolean attribute (`disabled`); a disabled rule is never eligible. `disabled="..."` is an error |

`severity` defaults to `advisory` so a missing value never blocks anyone.
`category` may be missing so a migration can wrap and scope rules first and
classify them later; tools warn on it.

Child elements, before the prose, in any order:

| Child | Count | Contents |
|---|---|---|
| `<meta>` | 0 or 1 | A free-form YAML mapping the spec does not interpret: where the rule came from, an owner, links. Ignored for eligibility, kept in the document model. Tools may define their own keys. |
| `<scope>` | 0 or 1 | YAML `files` / `ignores`. The rule's scope is the file's scope intersected with this one. |
| `<when>` | 0 or 1 | YAML conditions on the diff (below). |
| `<check>` | any | A search whose hits go to the reviewer (below). |

Everything after the child elements, up to `</rule>`, is the rule's prose,
in CommonMark Markdown.

- The prose MUST state the rule completely on its own. A reader who skips
  `<when>` and `<check>` still knows exactly what the rule asks.
- The prose's first paragraph is the rule's **summary**. Tools use it in
  listings, verdict output and hover text. Keep it to one or two sentences.

The nine fixed categories: `functional_correctness`, `test_coverage`,
`security`, `performance`, `accessibility`, `observability`,
`backwards_compatibility`, `documentation`, `code_style`. Custom categories
use the same snake_case (`^[a-z][a-z0-9_]*$`).

Severity: `blocking` means a violation must be fixed or explicitly waived
before merge. `advisory` means raise it and the author decides.

### Context

`<context id src>` points at a prose document a reviewer should read when it
is eligible. It takes `<meta>`, `<scope>` and `<when>` like a rule, never
`<check>`, and gets no verdict. The optional body is a short note on when or
why to read it. Context documents stay where they already live; Lore only
points at them.

- `src` is one path, not a glob.
- A plain path resolves against the governed repo: relative to the base, or
  through `repo` for an external folder.
- A path starting with `./` or `../` resolves relative to the `.lore` file
  itself, so a document kept beside the rules (for example in a team's own
  repo) can be pointed at. It may not leave the Lore root (see
  `.loreconfig`).
- `src` may be omitted; the body is then the context itself.
- A missing target is a warning, not an error: parsing never needs the
  governed repo's files to be present.

### Scope and globs

- `files` defaults to `["**"]`; `ignores` defaults to `[]`. An empty `files`
  list is an error.
- A path is in scope when it matches at least one `files` glob and no
  `ignores` glob, after both are resolved against the base.
- Rule scope = file scope ∩ rule `<scope>`. A file with no `<scope>` covers
  everything under its base. A rule whose intersected scope can match
  nothing (for example `files: ["**/*.md"]` under a file scope of
  `**/*.ts`) gets an `empty-scope` warning.
- Glob syntax: `**` (zero or more path segments), `*`, `?`, `[...]` and
  `[!...]`, `{a,b}`; `/`-separated paths; case-sensitive; `*` matches
  dotfiles; no negation (use `ignores`). A glob may not reach above its base
  (`..` is an error).
- A leading `/` is allowed only in the `changed` and `unchanged` conditions
  of `<when>`, where it means the repo root (for an external folder, the
  directory marked with `repo`). Everywhere else it is an error.

### `<when>`: conditions on the diff

A YAML mapping. Each key is a condition; all keys must hold. v1 conditions:

| Key | Value | Holds when |
|---|---|---|
| `addedContains` | string[] | an added line in an in-scope changed file contains any of the strings |
| `addedMatches` | regex string[] | an added line in an in-scope changed file matches any of the patterns |
| `changed` | glob[] | some changed file anywhere in the diff matches any of the globs |
| `unchanged` | glob[] | no changed file anywhere in the diff matches any of the globs |

`changed` and `unchanged` are the only conditions that look past the rule's
scope, because "files that should change together" is about the whole diff.
A rule like `regen-types-after-graphql` is eligible only when the generated
files were left out, so a diff that did regenerate them reports the rule as
not applicable rather than passed.

Unknown keys are an error, so a file never silently means less than its
author wrote. A removed-lines variant is reserved for a later version.

### Regexes

`addedMatches` and regex checks share one portable dialect, so Go, Rust,
Python and JavaScript implementations agree on every match. The spec pins
semantics, not just syntax:

- ECMAScript syntax, limited to what RE2-style engines support: no
  lookaround, no backreferences, no named groups (use `(?:...)`).
- `\d`, `\w`, `\s` and `\b` are ASCII-only.
- `{` is always a quantifier; a literal brace is written `\{`.
- No flags, inline or otherwise. Case-insensitive matching is written out
  (`[Uu][Ss][Dd]`).
- A pattern is one line, matched as an unanchored search against one added
  line at a time (no trailing newline).

Each point has conformance examples.

### `<check>`: hints for the reviewer

A check is a deterministic search run only over the rule's in-scope changed
files. Its hits (file, line, matched text) go to the reviewer with the rule.
A hit is a pointer, never a verdict; no hits does not mean the rule passed.

| `lang` | Contents | Hit |
|---|---|---|
| `regex` (the default) | exactly one line: a pattern in the dialect above | an added line that matches |
| `ast-grep` | one ast-grep pattern, possibly several lines; language from the file extension | a match that overlaps an added line |

- A check's body is the lines strictly between its tags, joined with `\n`,
  with nothing trimmed. A `regex` body of more than one line is an error
  (`regex-not-one-line`).
- `ast-grep` patterns follow the pattern syntax of a named ast-grep release
  (the spec states which) and rely only on the `$NAME` and `$$$`
  metavariables. A changed file whose extension maps to no ast-grep language
  is skipped and reported.
- Supporting `<check>` is optional for a conforming tool, per language. A
  tool that does not support a check's language skips it and says so; the
  rule is still eligible. A plain agent may read a check as a hint about
  what to look for.

### Eligibility

Given a diff (a list of changed files and their added lines), a rule or
context is **eligible** when:

1. it is not `disabled`, and
2. at least one changed file is in its scope and the rule is not switched
   off for that file by a `.loreconfig` `disable` list, and
3. its `<when>`, if present, holds.

How changed files count:

- An added or modified file counts by its path; a deleted file by its old
  path.
- A renamed file counts by both paths, for scope and for `changed` /
  `unchanged`. Its added lines belong to the new path.
- A change to a `.lore` file or `.loreconfig` counts like any other file.

An entry with no `<scope>` and no `<when>` is eligible for every change
that touches a file under its base. In a `.lore/` folder at the repo root,
that is every change.

### Parsing rules

- Element tags start at column 0. Opening tags are alone on their line
  (attributes included); closing tags are alone on their line.
- Attributes are `name="value"` in double quotes, or a bare name for a
  boolean.
- Element contents are raw text: no entities, no escaping.
- Child elements are recognized only before the prose starts. Once the first
  line of prose appears, the only line with meaning is the entry's closing
  tag (`</rule>` or `</context>`) at column 0; every other line, tag-shaped
  or not, is prose.
- Inside a fenced code block in the prose (a CommonMark fence of three or
  more backticks or tildes), a closing tag is not recognized either. That
  lets a rule show Lore syntax in an example. A closing tag line in prose
  outside a fence must be indented.
- Structured blocks (`<defaults>`, `<scope>`, `<when>`, `<meta>`) and
  `.loreconfig` are YAML 1.2, core schema. JSON is valid YAML 1.2, so a team
  writes either, and may mix them across files.
  - Anchors, aliases and custom tags are not allowed, so every
    implementation reads the same values and no reader has to guard against
    alias expansion.
  - A duplicate key in a mapping is an error (`duplicate-key`). JSON parsers
    disagree on duplicates, so Lore refuses them.
  - Comments use YAML's `#`. JSONC's `//` comments and trailing commas are
    not accepted.
  - The spec carries conformance examples for the YAML traps authors will
    hit: an unquoted `**/*.ts` (read as an alias), `"\d"` in double quotes
    (an escape error; use single quotes for regexes), `#` inside a plain
    scalar, and unquoted `[A-Z]+` inside a flow sequence.
- Errors and warnings have names that the conformance examples refer to. The
  spec enumerates them.

### What an error reaches

An error reaches as far as it must and no further, and is never silent.

**File-level errors** exclude the whole file, since every entry in it
depends on what's broken:

- the tag structure can't be read: an unclosed element, a closing tag with
  no opening, a malformed tag line;
- text at the top level, or an unknown top-level element;
- a second `<defaults>` or `<scope>`, or either one after the first entry;
- invalid content in `<defaults>` or `<scope>`, including an unknown
  category in `<defaults>` (which excludes rules that set their own category
  too, since the file as written is wrong).

**Entry-level errors** exclude only that rule or context:

- an unknown, malformed or duplicated attribute; a missing `id`;
- an unknown child element, or a second `<meta>`, `<scope>` or `<when>`;
- invalid YAML in a child, an unknown `<when>` key, a bad glob, a regex
  outside the dialect, a `regex` check of more than one line;
- an unknown category;
- a duplicate id: every entry sharing it is excluded.

**Warnings** exclude nothing: `missing-category`, `empty-scope`, a missing
`src` target, an unsupported check language, a file skipped by `ast-grep`.

A conforming tool reports every excluded entry and file, with the error
name, wherever it reports eligibility (for example "38 rules applied, 2
skipped: unknown-category").

### `.loreconfig`

A YAML (or JSON) file that may sit in any directory and applies to that
directory and everything below it, inherited the way `.gitignore` is.

```yaml
lore: 1                          # spec version
root: true                       # stop looking further up
repo: github.com/acme/shop       # only for folders outside the repo
categories: [data_provenance]    # added to the fixed nine
disable: [currency-from-settings]   # switched off for changes below here
```

- **`categories`**: added to the nine fixed ones for this directory and
  below. Inheritance only adds; a child cannot remove a parent's category.
  A rule using a category not declared at or above it is an error.
- **`disable`**: rule ids switched off for changed files at or below this
  directory. A rule doesn't count those files towards its eligibility; if
  no other in-scope file changed, it isn't eligible. Lists inherit by
  adding. A `disable` list in the governed repo also switches off rules that
  come from an external folder, so a repo can opt out of a shared rule
  without editing another team's file. An id that matches no collected rule
  is a warning.
- **`root`**: `true` stops the upward lookup here, as in EditorConfig.
- **`repo`**: marks this directory as standing for the root of that repo
  (see "Keeping Lore outside the repo").
- **`lore`**: the spec version these files follow. Defaults to 1.

Where lookup stops (the **Lore root**), so results never depend on where a
tool was pointed:

- Inside a repo: at the nearest `.loreconfig` with `root: true`, and never
  above the repo root.
- In an external folder: at the nearest `.loreconfig` with `root: true` at
  or above the directory marked with `repo`; with none, at the marked
  directory itself. An org that wants shared categories puts `root: true`
  in a `.loreconfig` above all its `repo` folders.
- The two trees resolve categories independently: external files don't see
  the repo's categories, and the other way round. `disable` is the one
  thing that crosses, as described above.

### Keeping Lore outside the repo

A team can keep its Lore outside the repo it governs:

```
team-repo/lore/
  .loreconfig          root: true
                       categories: [data_provenance]
  shop/
    .loreconfig        repo: github.com/acme/shop
    .lore/
      checkout.lore    globs resolve from the shop repo's root
    apps/web/.lore/
      web.lore         base: apps/web/ in the shop repo
```

- `repo` makes its directory stand for the governed repo's root.
  Directories below it mirror the repo's paths.
- The value is `<host>/<path>`. A tool matches it against a repo's remote
  after normalizing both: lowercase host; scheme, user info and trailing
  `.git` and `/` removed; `git@host:path` read as `host/path`; path compared
  case-insensitively. A tool may also match by an explicit mapping its user
  configures.
- A `repo` key inside the governed repo itself is an error, and so is a
  `.loreconfig` with `repo` below another one with `repo`.
- A tool reviewing a repo collects the repo's own Lore, plus any external
  folder it has been given whose `repo` names that repo. Ids must be unique
  across everything collected; reusing an id is an error, not an override.

### Adopting it

- **Highlighting.** Until Lore has its own grammar (step 2), one line in
  `.gitattributes` highlights `.lore` files as Markdown on GitHub, and the
  GitLab equivalent does the same there:

  ```
  *.lore linguist-language=Markdown gitlab-language=markdown
  ```

- **Agents with no tooling.** The spec ships a short, versioned paragraph
  that a team pastes into `AGENTS.md`, `CLAUDE.md`, Cursor rules or Copilot
  instructions. It tells any agent how to find the `.lore/` folders for a
  change, apply the rules whose scope and conditions match, treat checks as
  hints, and report each rule by id.

## The specification document

Written in RFC 2119 language. It carries:

- the format above, as normative text;
- a normative **document model**: the JSON shape of a parsed set of Lore
  files (rules and context with resolved scope, defaults applied, `<meta>`
  kept, errors and warnings), which examples compare against and which tools
  may emit;
- JSON Schemas (applied to the parsed YAML) for `<defaults>`, `<scope>`,
  `<when>` and `.loreconfig`;
- the enumerated error and warning names;
- numbered conformance examples, CommonMark style, inline in the spec. Each
  example gives inputs (one or more `.lore` and `.loreconfig` files, and for
  eligibility examples a diff) and the expected output (a document model,
  errors, or an eligible set);
- a small checker, shipped in this step, that validates the schemas and
  checks every example is well-formed, so the suite is run from day one;
- the agent paragraph above, and a short non-normative "for agents" section
  on what a plain agent should do when it finds a `.lore/` folder.

## Decided in this design (as decided)

- Two kinds of entry, rules and context; only rules get verdicts.
- `.lore` is its own language: tagged sections, YAML 1.2 (JSON accepted)
  metadata, Markdown prose. A Linguist override highlights it until step 2.
- `.lore/` folders anywhere; globs relative to the folder's base; one file
  or many.
- File scope with rule scope narrowing it.
- `<when>` for selection, including files that change together;
  `<check>` for line-pattern hints; no shell; checks never decide.
- Eligibility is computed by code.
- `disabled` on the rule, plus a consumer-side `disable` list in
  `.loreconfig`.
- Nine fixed categories plus `.loreconfig` categories, inherited like
  `.gitignore`.
- `blocking` / `advisory`.
- `repo` in `.loreconfig` for folders outside the repo.
- Errors drop only what depends on them, and are always reported.
- Conformance-example spec style; own public repo; CC-BY-4.0 for the spec
  text and MIT for schemas, examples and code.

## My calls (for review)

These were not settled in conversation; each is my default:

- `<defaults>` as a top-level element for a file's category and severity.
- `<context>` element shape: `id`, `src`, optional note, takes `<meta>`,
  scope and when.
- `<meta>` as a free-form, uninterpreted YAML block on rules and context.
- `severity` defaults to `advisory`; `category` is optional with a warning.
- The prose states the whole rule; its first paragraph is the summary.
- Ids are kebab-case and unique across everything collected for a repo;
  rules and context share one namespace; no override by id.
- Categories are snake_case, fixed and custom alike.
- `src` is one path; `./` paths resolve beside the `.lore` file; a missing
  target warns.
- `addedContains` / `addedMatches` / `changed` / `unchanged` as the v1
  `<when>` keys; added lines only for content.
- The regex dialect: RE2-compatible ECMAScript syntax, ASCII classes, no
  flags, no named groups, one line, matched per added line.
- `<check>` defaults to `regex`; bodies are taken verbatim between the tags.
- After prose starts, only the closing tag has meaning, and not inside a
  fenced code block.
- `root: true` sets the Lore root; lookup never crosses the repo root;
  repo and external trees keep separate categories.
- Only version-controlled Lore files are collected.
- Renamed files count by both paths; deleted files by their old path.
- `repo` matching normalizes host, scheme, `.git` and path case.
- A tool may skip unsupported check languages; the rule stays eligible.
- The spec version lives in `.loreconfig` (`lore: 1`), not in each file.

## Left to the builder

- The exact syntax for writing conformance examples in the spec, and the
  script that extracts them.
- The precise document model fields, within the shape above.
- The full error and warning list, within the file-level and entry-level
  split above.
- Repo layout (for example `spec/SPEC.md`, `spec/schemas/`).
- How many examples, as long as every normative statement has at least one.
- Which ast-grep release the spec targets.
- The wording of the agent paragraph.

## Name

`lore` is the working name for the format, the folder, the extension and
`.loreconfig`. `lorehq/lore` (a tool that projects rules into agent
platforms, apparently inactive) already uses `.lore/`. The name is
re-checked before the spec is published as stable.
