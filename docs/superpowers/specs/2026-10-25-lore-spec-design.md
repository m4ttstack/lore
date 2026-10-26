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
named unit with a category, a severity, a scope (which files it can be
broken in) and optional content conditions. Tools find the rules that apply
to a change by code, not by reading prose, and hand them to a reviewer.

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
   highlighting. They come with the reference parser.
3. How Lore is applied: going from files plus a diff to a verdict, and what
   an agent does and does not do.
4. A first integration into an agent review pipeline.
5. A team view for browsing and editing rules.

The first adopter's rules (about 100, spread across agent plugins and
in-repo skills and docs) get converted as the test bed for step 3. The full
conversion is done before the format is proposed to that team.

## Goals

- A written, versioned specification of the `.lore` file format, the
  `.lore/` folder convention and the `.loreconfig` file.
- Deterministic eligibility: given a set of Lore files and a diff, every
  conforming tool computes the same set of eligible rules and context.
- A spec testable by any implementation: numbered conformance examples
  (input and expected output) and JSON Schemas for every JSON block.
- Files a plain agent reads correctly with no tooling.

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
- **Team internals in the spec.** This repo is public. Examples use a
  fictional app.

## Constraints

- Zero dependencies to read. Parsing a `.lore` file needs a JSON parser and
  the spec's tokenizing rules, nothing else.
- UTF-8 text, line-oriented, friendly to diffs and code review.
- The name may change before the spec is published as stable: `lorehq/lore`
  already uses a `.lore/` folder for a different purpose.

## Approaches considered

| Question | Options | Picked, and why |
|---|---|---|
| Where rules are stored | A database behind an editing view; files | Files. Git is the source of truth and history; a page or index is built from them. |
| Prose rules vs structured rules | Rules only; context docs only; two kinds | Two kinds, as Aviator separates invariants from runtime context. Rules get verdicts; context is reference prose that is loaded when relevant but never scored. |
| File format | Markdown + frontmatter; YAML; JSON with prose in sibling files; executable JS config; a single-file format with tagged sections | Tagged sections, in the style of Svelte and Vue single-file components. JSON where tools query (scope, conditions), Markdown where people write. Agents already read XML-tagged text natively. Markdown frontmatter has no good per-rule structure; YAML and JSON are poor at long prose with code samples; JS config must be executed. |
| Where files live | One root folder; next to the code; either | Either. A `.lore/` folder may sit anywhere; globs resolve relative to it, so a set can move with its code. A folder outside the repo maps to it with `repo`. |
| A rule's scope vs its file's scope | Replaces; narrows | Narrows. A file's scope keeps its meaning; rules that cross areas go in a file with a wider scope. |
| Code in rules | None; content conditions only; conditions and search hints | Both: `<when>` for selection, `<check>` for hints to the reviewer. |
| Categories | Fixed list; free-form; fixed + custom | Aviator's nine fixed, plus categories declared in `.loreconfig`, inherited down the tree. |
| Severity | Two levels; three; RFC 2119 words; configurable | Two: `blocking` and `advisory`. Rule authors think in must versus should; tools map to their own scales. |
| How the spec is written | Prose + schemas; prose + schemas + conformance examples; grammar-first | Conformance examples, as CommonMark does. Every implementation (parser, formatter, LSP, selector) tests against one shared set. A grammar for highlighting can come out of step 2, tested against the same examples. |
| Where the project lives | Inside the first implementation's repo; its own repo | Its own public repo, so it reads as a neutral format and versions on its own. |

## The format

### Folders and files

- Lore files have the extension `.lore` and live in a folder named `.lore/`
  (subfolders inside it are allowed, for grouping).
- A `.lore/` folder may sit in any directory. The directory that contains
  it is the folder's **base**: globs and `src` paths in its files resolve
  relative to the base.
- A set of rules can be one large file or many small ones; the split carries
  no meaning.

```
.lore/backend.lore                       base: repo root
apps/web/src/checkout/.lore/rules.lore   base: apps/web/src/checkout/
```

### A `.lore` file

```
<!-- apps/web/src/checkout/.lore/pricing.lore -->
<defaults>
{ "category": "functional_correctness", "severity": "blocking" }
</defaults>

<scope>
{
  "files": ["**/*.{ts,tsx,graphql}"],
  "ignores": ["**/*.test.ts"]
}
</scope>

<rule id="price-from-quote">
A displayed price must come from the quote that produced it. No helper that
recomputes a price separately from the quote.
</rule>

<rule id="currency-from-locale" severity="advisory">
<when>
{ "diffContains": ["'USD'", "'EUR'"] }
</when>
<check lang="regex">
'(USD|EUR)'
</check>
Hard-coded currency codes in display text are wrong; use the shop's
`currency` setting.
</rule>

<rule id="regen-types-after-graphql">
<scope>
{ "files": ["**/*.graphql"] }
</scope>
<check lang="cochange">
{ "when": ["**/*.graphql"], "expect": ["**/__generated__/**"] }
</check>
A `.graphql` change ships with regenerated types.
</rule>

<context id="checkout-architecture" src="ARCHITECTURE.md">
Read before judging any change to how a price is computed.
</context>
```

Top-level elements:

| Element | Contents | Count |
|---|---|---|
| `<defaults>` | JSON: `category`, `severity` defaults for every rule in the file | 0 or 1 |
| `<scope>` | JSON: `files`, `ignores` (globs). The default scope of every rule and context in the file | 0 or 1 |
| `<rule>` | Optional child elements, then Markdown prose | any |
| `<context>` | Optional child elements, then optional Markdown note | any |
| `<!-- -->` | Comment, ignored | any |

Blank lines between elements are allowed. Any other text at the top level is
an error.

### Rules

Attributes:

| Attribute | Required | Meaning |
|---|---|---|
| `id` | yes | kebab-case; unique across every Lore file that applies to the same repo |
| `category` | yes, unless `<defaults>` sets it | one of the nine fixed categories or one declared in `.loreconfig` |
| `severity` | yes, unless `<defaults>` sets it | `blocking` or `advisory` |
| `disabled` | no | boolean attribute; a disabled rule is never eligible |

Child elements, each optional and at most once, before the prose:

- **`<scope>`**: JSON `files` / `ignores`. The rule's scope is the file's
  scope intersected with this one.
- **`<when>`**: JSON content conditions (below).
- **`<check>`**: a search whose hits go to the reviewer (below). A rule may
  have several `<check>` elements.

Everything after the child elements, up to `</rule>`, is the rule's prose,
in CommonMark Markdown.

The nine fixed categories: `functional_correctness`, `test_coverage`,
`security`, `performance`, `accessibility`, `observability`,
`backwards_compatibility`, `documentation`, `code_style`.

Severity: `blocking` means a violation must be fixed or explicitly waived
before merge. `advisory` means raise it and the author decides.

### Context

`<context id src>` points at a prose document a reviewer should read when it
is eligible. It takes `<scope>` and `<when>` like a rule, never `<check>`,
and gets no verdict. The optional body is a short note on when or why to
read it. Context documents stay where they already live; Lore only points at
them.

- `src` is one path, not a glob.
- A plain path resolves against the governed repo: relative to the base, or
  through `repo` for an external folder.
- A path starting with `./` or `../` resolves relative to the `.lore` file
  itself, so a document kept beside the rules (for example in a team's own
  repo) can be pointed at. It may not leave the folder tree the tool was
  given.
- `src` may be omitted; the body is then the context itself.
- A missing target is a warning, not an error: parsing never needs the
  governed repo's files to be present.

### Scope and globs

- `files` defaults to `["**"]`; `ignores` defaults to `[]`.
- A path is in scope when it matches at least one `files` glob and no
  `ignores` glob, after both are resolved against the base.
- Rule scope = file scope ∩ rule `<scope>`. A file with no `<scope>` covers
  everything under its base.
- Globs: `**`, `*`, `?`, `[...]`, `{a,b}`; `/`-separated paths; case-
  sensitive; `*` matches dotfiles; no leading `/`; no negation (use
  `ignores`). A glob may not reach above its base (`..` is an error).

### `<when>`: content conditions

A JSON object. Each key is a condition; all keys must hold. v1 conditions:

| Key | Value | Holds when |
|---|---|---|
| `diffContains` | string[] | any added line in an in-scope changed file contains any of the strings |
| `diffMatches` | regex string[] | any added line in an in-scope changed file matches any of the patterns |

Regexes, here and in `regex` checks, use a portable subset: ECMAScript
syntax limited to what RE2-style engines support (no lookaround, no
backreferences), so Go, Rust, Python and JavaScript implementations agree.
The spec lists the subset and its conformance examples test its edges.
Unknown keys are an error, so a file never silently means less than its
author wrote.

### `<check>`: hints for the reviewer

A check is a deterministic search run only over the rule's in-scope changed
files. Its hits (file, line, matched text) go to the reviewer with the
rule. A hit is a pointer, never a verdict; no hits does not mean the rule
passed.

| `lang` | Contents | Hit |
|---|---|---|
| `regex` | one ECMAScript pattern; optional `flags` attribute | an added line that matches |
| `ast-grep` | one ast-grep pattern; language from the file extension | a match that overlaps an added line |
| `cochange` | JSON `{ "when": glob[], "expect": glob[] }` | an in-scope changed file matches `when` and no changed file anywhere matches `expect` |

`cochange` is the one check that looks past the rule's scope: `when` is
matched against in-scope changed files, `expect` against every changed file
in the diff. `expect` globs resolve against the base, or against the repo
root when they start with `/`, since generated output often sits outside a
nested folder's base. Its hit names the triggering file with no line, and
the expected globs that nothing matched.

Supporting `<check>` is optional for a conforming tool, per language. A tool
that does not support a check's language skips it and says so; the rule is
still eligible. A plain agent may read a check as a hint about what to look
for.

### Eligibility

Given a diff (a list of changed files and their added lines), a rule or
context is **eligible** when:

1. it is not `disabled`, and
2. at least one changed file is in its scope, and
3. its `<when>`, if present, holds.

An entry with no `<scope>` anywhere above it and no `<when>` is eligible for
every change. A changed file counts by its new path if added, modified or
renamed, and by its old path if deleted.

### Parsing rules

- Element tags start at column 0. Opening tags are alone on their line
  (attributes included); closing tags are alone on their line.
- Attributes are `name="value"` in double quotes, or a bare name for a
  boolean.
- Element contents are raw text: no entities, no escaping. A line inside
  prose that would read as a closing tag at column 0 must be indented.
- JSON blocks are JSONC (comments and trailing commas allowed).
- Errors have names (for example `unknown-category`, `duplicate-id`,
  `glob-escapes-base`, `unknown-condition`) that the conformance examples
  refer to. The spec enumerates them.
- An error reaches as far as it must and no further. An error inside an
  entry (a bad attribute, invalid JSON in its `<when>`, a duplicate id)
  excludes that entry only; every entry that shares the duplicate id is
  excluded. An error in a file's structure, `<defaults>` or `<scope>`
  excludes the whole file, since every entry in it depends on them. Other
  files are unaffected.
- A conforming tool must report every excluded entry and file, with the
  error name, wherever it reports eligibility (for example "38 rules
  applied, 2 skipped: unknown-category"). An exclusion is never silent.

### `.loreconfig`

A JSONC file that may sit in any directory and applies to that directory and
everything below it, inherited the way `.gitignore` is.

```jsonc
{
  "lore": 1,                                   // spec version
  "repo": "github.com/acme/shop",              // only for folders outside the repo
  "categories": ["data-provenance"]            // added to the fixed nine
}
```

- **`categories`**: added to the nine fixed ones for this directory and
  below. Inheritance only adds; a child cannot remove a parent's category.
  A rule using a category not declared at or above it is an error.
- **`repo`**: marks this directory as standing for the root of that repo.
  Directories below it mirror the repo's paths, so a `.lore/` folder at
  `<this dir>/apps/web/` has the base `apps/web/` in the repo. A
  `.loreconfig` below it may not name a different repo. The value is
  `<host>/<path>`.
- **`lore`**: the spec version these files follow. Defaults to 1.

Where inheritance stops, so results never depend on the machine:

- Inside a repo, lookup stops at the repo root. Files above it never count.
- For an external folder, lookup stops at the root of the folder the tool
  was given. A `.loreconfig` there, above the directory marked with `repo`,
  applies to everything below it, so an org can declare shared categories
  once.
- The two trees resolve independently: external files don't see the repo's
  `.loreconfig` files, and the other way round.

A team can keep its Lore outside the repo it governs:

```
team-repo/lore/shop/
  .loreconfig        { "repo": "github.com/acme/shop" }
  .lore/
    checkout.lore    globs resolve from the shop repo's root
    backend.lore
```

A tool reviewing a repo collects every `.lore/` folder in it, plus any
external folder it has been given whose `repo` names that repo.

## The specification document

Written in RFC 2119 language. It carries:

- the format above, as normative text;
- a normative **document model**: the JSON shape of a parsed set of Lore
  files (rules and context with resolved scope, defaults applied, errors),
  which examples compare against and which tools may emit;
- JSON Schemas for `<defaults>`, `<scope>`, `<when>`, the `cochange` check
  and `.loreconfig`;
- the enumerated error names;
- numbered conformance examples, CommonMark style, inline in the spec. Each
  example gives inputs (one or more `.lore` and `.loreconfig` files, and for
  eligibility examples a diff) and the expected output (a document model, an
  error, or an eligible set);
- a short non-normative "for agents" section: what a plain agent should do
  when it finds a `.lore/` folder with no tooling.

## Decided in this design (as decided)

- Two kinds of entry, rules and context; only rules get verdicts.
- `.lore` single-file format with tagged sections; JSON metadata, Markdown
  prose.
- `.lore/` folders anywhere; globs relative to the folder's base; one file or
  many.
- File scope with rule scope narrowing it.
- `<when>` for selection and `<check>` for reviewer hints; no shell; checks
  never decide.
- Eligibility is computed by code; no conditions means always eligible.
- Nine fixed categories plus `.loreconfig` categories, inherited like
  `.gitignore`.
- `blocking` / `advisory`.
- `repo` in `.loreconfig` for folders outside the repo.
- Conformance-example spec style; own public repo.

## My calls (for review)

These were not settled in conversation; each is my default:

- `<defaults>` as a top-level element for a file's category and severity.
- `<context>` element shape: `id`, `src`, optional note, takes scope and
  when.
- `disabled` as a boolean rule attribute (an editing view needs a switch).
- Ids unique per repo across all Lore files, since verdicts key on them.
  Rules and context share one namespace. Uniqueness is checked over the
  files the tool collected (the repo's own plus any external folders it was
  given). No overriding: a repo can't replace or disable a rule from an
  external folder by reusing its id; a duplicate is an error.
- `src` is one path; `./` paths resolve beside the `.lore` file; a missing
  target warns.
- `cochange` looks past the rule's scope for `expect`; `/`-prefixed `expect`
  globs are repo-rooted.
- Regexes are an RE2-compatible subset of ECMAScript syntax.
- `.loreconfig` lookup stops at the repo root, or at the root of a given
  external folder; the two trees don't mix.
- v1 `<when>` keys limited to `diffContains` and `diffMatches`, on added
  lines only.
- Strict column-0, own-line tags; JSONC for every JSON block and
  `.loreconfig`.
- Deleted files count for eligibility by their old path.
- A tool may skip unsupported check languages; the rule stays eligible.
- Spec version lives in `.loreconfig` (`lore: 1`), not in each file.

## Left to the builder

- The exact syntax for writing conformance examples in the spec, and the
  script that extracts them.
- The precise document model fields, within the shape above.
- The full error list, beyond the examples named here.
- Repo layout (for example `spec/SPEC.md`, `spec/schemas/`), license file,
  and README.
- How many examples, as long as every normative statement has at least one.
- Whether this step ships a tiny example checker (schemas valid, examples
  well-formed) before the reference parser arrives in step 2.

## Name

`lore` is the working name for the format, the folder, the extension and
`.loreconfig`. `lorehq/lore` (a tool that projects rules into agent
platforms, apparently inactive) already uses `.lore/`. The name is
re-checked before the spec is published as stable.
