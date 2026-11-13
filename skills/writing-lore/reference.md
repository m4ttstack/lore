# Lore reference

Every feature an author of `.lore` and `.loreconfig` files uses, for Lore
version 1 and the reference CLI 0.6.x. Every example parses without errors.
Each section links [SPEC.md](../../spec/SPEC.md) for edge cases.

1. [Files and folders](#1-files-and-folders)
2. [File structure](#2-file-structure)
3. [Scope](#3-scope)
4. [Rule attributes](#4-rule-attributes)
5. [Children, meta and prose](#5-children-meta-and-prose)
6. [Conditions: `<when>`](#6-conditions-when)
7. [Checks: `<check>`](#7-checks-check)
8. [Context: `<context>`](#8-context-context)
9. [Sources: `<source>`](#9-sources-source)
10. [Defaults: `<defaults>`](#10-defaults-defaults)
11. [`.loreconfig`](#11-loreconfig)
12. [External rules folders](#12-external-rules-folders)
13. [Eligibility](#13-eligibility)
14. [Checking your work](#14-checking-your-work)
15. [Errors and warnings](#15-errors-and-warnings)

## 1. Files and folders

A Lore file ends in `.lore` and sits inside a `.lore/` folder, at any depth
of the repo. The directory holding the `.lore/` folder is the file's
**base**: its globs and plain `src` paths resolve from there. Subfolders
inside `.lore/` only group files.

```
.lore/
  repo.lore              base: the repo root
src/checkout/
  .lore/
    checkout.lore        base: src/checkout/
    pricing/quotes.lore  base: still src/checkout/
```

Watch out: tools collect only files git tracks, so a `.lore` file you have not `git add`ed is ignored with no
warning. A `.lore` file outside a `.lore/` folder, and any other file inside
one (a `.loreconfig` included), is not read.
[Spec: Files and folders](../../spec/SPEC.md#files-and-folders),
[Collecting files](../../spec/SPEC.md#collecting-files).

## 2. File structure

At the top level a file holds at most one `<defaults>` and at most one
`<scope>`, before any entry, then any number of `<rule>` and `<context>`
entries. `<!-- -->` comments and blank lines may sit between elements.
`<defaults>`, `<scope>`, `<when>` and `<meta>` hold YAML 1.2, or JSON. Rule
text is Markdown.

```html
<!-- Checkout rules. Owned by the checkout team. -->
<scope>
  files: ["**/*.{ts,tsx}"]
</scope>

<rule id="price-from-quote" category="functional_correctness" severity="blocking">
  A displayed price must come from the quote that produced it.
</rule>
```

Top-level tags and comments start at column 0. Indentation inside an
element is optional and stripped; never mix tabs and spaces in one element.
Contents are raw text: `&amp;` stays `&amp;`.

Watch out:

- Any stray text at the top level is `top-level-text` and excludes the whole
  file. So does an undefined element (`<notes>`), a second `<scope>`, or a
  file block after an entry.
- Quote globs: unquoted `**/*.ts` is a YAML alias, and `[src/*.{ts,tsx}]`
  breaks a flow list. Single-quote regexes: `'\d+'`, since `"\d"` is an
  invalid escape.
- ` #` starts a YAML comment, even mid-value. `//` comments, anchors,
  aliases, tags (`!!str`) and repeated keys are errors.

[Spec: Parsing](../../spec/SPEC.md#parsing),
[Structured blocks](../../spec/SPEC.md#structured-blocks).

## 3. Scope

`<scope>` says which files an entry can be broken in: `files` (a non-empty
list of globs, default `["**"]`) and `ignores` (default `[]`). A file's
`<scope>` covers every entry in it. An entry's own `<scope>` intersects with
it: a rule narrows its file's scope, never widens it.

```html
<scope>
  files: ["**/*.{ts,tsx}"]
  ignores: ["**/*.test.{ts,tsx}"]
</scope>

<rule id="cart-totals-from-quote" category="functional_correctness">
  <scope>
    files: ["cart/**"]
  </scope>
  Cart totals come from the quote, never from summing line items.
</rule>
```

In `src/checkout/.lore/`, the rule covers `.ts` and `.tsx` files under
`src/checkout/cart/`, minus tests.

| Glob | Matches |
|---|---|
| `**` (a whole segment) | zero or more segments |
| `*` | any characters within one segment, dotfiles included |
| `?` | one character |
| `[a-z]`, `[!a-z]` | one character in, or not in, the set |
| `{ts,tsx}` | any one alternative |

Watch out:

- A scope glob never starts with `/` (`leading-slash`) or holds a `..`
  segment (`glob-escapes-base`). A rule cannot reach outside its base: rules
  for `apps/web` and `apps/api` go in a Lore folder above both, or one file
  in each.
- No negation (`!**/*.test.ts` is `invalid-glob`): use `ignores`. No escape
  character: match a literal `[` with `[[]`. Write `**/*.ts`, not `**.ts`.
- A rule scope disjoint from its file scope (`**/*.md` under `**/*.ts`)
  gets the warning `empty-scope` and never applies.

[Spec: Scope and globs](../../spec/SPEC.md#scope-and-globs),
[Glob syntax](../../spec/SPEC.md#glob-syntax).

## 4. Rule attributes

| Attribute | Required | Value |
|---|---|---|
| `id` | yes | kebab-case: `^[a-z][a-z0-9-]*$` |
| `category` | no | a fixed category, or one a `.loreconfig` declares |
| `severity` | no | `blocking` or `advisory`; default `advisory` |
| `disabled` | no | bare, no value: turns the entry off |

The nine fixed categories, verbatim: `functional_correctness`,
`test_coverage`, `security`, `performance`, `accessibility`, `observability`,
`backwards_compatibility`, `documentation`, `code_style`.

```html
<rule id="logs-carry-no-card-data" category="security" severity="blocking">
  Logs never hold a card number, even masked.
</rule>
```

- Ids are shared by rules and contexts, and unique across every collected
  file, external folders included. A repeated id is `duplicate-id` on every
  entry using it: nothing overrides anything.
- Verdicts and `disable` lists name rules by id, so keep an id stable.
- A rule with no category anywhere still applies, with the warning
  `missing-category`.
- `blocking`: fixed or waived before merge. `advisory`: the author decides.

Watch out: values need double quotes. Any other attribute, such as
`owner="checkout"`, is `unknown-attribute`: put it in `<meta>`.
`severity="high"`, `disabled="false"` and `category="Data_Provenance"` are
errors. A well-formed but undeclared category is `unknown-category`.
[Spec: Attributes](../../spec/SPEC.md#attributes),
[Categories and severity](../../spec/SPEC.md#categories-and-severity).

## 5. Children, meta and prose

A rule's children come first, in any order: `<meta>`, `<scope>`,
`<when>` and `<source>` (at most one each) and any number of `<check>`. The first line that
is neither blank nor tag-shaped starts the **prose**, which runs to
`</rule>` at column 0.

```html
<rule id="price-from-quote" category="functional_correctness" severity="blocking">
  <meta>
    owner: checkout
  </meta>
  <source>
    file: docs/review-guide.md
    heading: Prices
  </source>
  A displayed price must come from the quote that produced it.

  Recomputing a price from its inputs drops quote-level discounts, so the
  customer sees one total and is charged another.
</rule>
```

- `<meta>` is a free-form YAML mapping. No key has a meaning and it never
  affects selection. Where a rule came from goes in `<source>`
  ([section 9](#9-sources-source)), not in a `source:` key here.
- The **summary** is the prose's first paragraph, its lines joined. Tools
  list rules by it, so make it one or two sentences stating the requirement.
- The prose states the whole rule; `<when>` and `<check>` add no meaning.

Watch out:

- A `<when>` after the first prose line is prose, not a condition, and no
  error says so. A `<!-- -->` comment inside an entry also starts the prose.
- A list directly under the first sentence joins the summary. Leave a blank
  line before it.
- Show Lore syntax in prose inside a fenced code block: a `</rule>` at
  column 0 outside a fence ends the rule.
- `<meta>` must be a mapping (`invalid-meta`). `<check>` and `<source>`
  are for rules only; any other child is `unknown-child`.

[Spec: Children](../../spec/SPEC.md#children),
[Prose and summary](../../spec/SPEC.md#prose-and-summary),
[Entries](../../spec/SPEC.md#entries).

## 6. Conditions: `<when>`

`<when>` holds conditions on the change. The entry applies only when every
condition holds.

| Key | Value | Holds when |
|---|---|---|
| `addedContains` | strings | an added line of a counted file contains one |
| `addedMatches` | regexes ([dialect](#7-checks-check)) | an added line of a counted file matches one |
| `removedContains` | strings | a removed line of a counted file contains one |
| `removedMatches` | regexes ([dialect](#7-checks-check)) | a removed line of a counted file matches one |
| `droppedContains` | strings | a removed line of a counted file contains one, and no added line of the same edit contains it |
| `droppedMatches` | regexes ([dialect](#7-checks-check)) | a removed line of a counted file matches one, and no added line of the same edit matches it |
| `changed` | globs | any file in the whole change matches one |
| `unchanged` | globs | no file in the whole change matches any |

**Counted files** are the changed files in the entry's scope that no
`disable` list switches it off for.

An **edit** is a run of changed lines (removed and added) in one file with
no unchanged line between them; a diff hunk can hold several. A renamed
file is one file: its removed lines under the old path and its added lines
under the new path pair up in the same edits.

```html
<rule id="money-in-minor-units" category="functional_correctness">
  <when>
    addedContains: ["parseFloat(", "toFixed("]
  </when>
  Amounts are integers in minor units (cents). Floating point never touches
  money.
</rule>

<rule id="migration-with-schema" category="backwards_compatibility" severity="blocking">
  <scope>
    files: ["db/migrations/**"]
  </scope>
  <when>
    unchanged: ["/db/schema.sql"]
  </when>
  A new migration ships with the regenerated `db/schema.sql`.
</rule>
```

- Each added line `addedContains` or `addedMatches` finds is a **hit**, a
  line flagged for the reviewer, and each removed line the removed pair or
  the dropped pair finds is a hit on the old side, by the file's old path.
  Contexts get no hits.
- The dropped pair is for a construct whose deletion is the slip, when an
  edit that keeps it is fine. With `droppedContains: ["?? 0"]` scoped to
  `src/checkout/`, this change selects the rule with one hit, line 7 of
  `Total.ts`; the edit in `Tax.ts` keeps `?? 0`, so its removed line is
  not found:

  ```diff
  diff --git a/src/checkout/Tax.ts b/src/checkout/Tax.ts
  --- a/src/checkout/Tax.ts
  +++ b/src/checkout/Tax.ts
  @@ -4 +4 @@
  -  const tax = quote.tax ?? 0
  +  const tax = quote.salesTax ?? 0
  diff --git a/src/checkout/Total.ts b/src/checkout/Total.ts
  --- a/src/checkout/Total.ts
  +++ b/src/checkout/Total.ts
  @@ -7 +7 @@
  -  const discount = line.discount ?? 0
  +  const discount = line.discount
  ```

  Two limits. An edit that adds the item for another reason hides the
  removal. Pairing is by edit, not line by line: had `Total.ts`'s lines
  sat directly below `Tax.ts`'s in one file, with no unchanged line
  between, the added `?? 0` of the tax line would keep the removed
  discount line from being found. When an edit that keeps the item can
  still be the slip (a call whose argument changes), use the removed pair.
- `addedContains` and `removedContains` are case-sensitive substring
  tests. `addedMatches` and `removedMatches` search one line at a time;
  `^` is its start, indentation included. The dropped pair compares and
  searches the same way.
- `changed` and `unchanged` see every path in the change, in scope or not.
  A leading `/` resolves from the repo root, otherwise from the base. A
  renamed file counts by both paths.
- `unchanged: []` always holds. An empty list never holds for the others.

Watch out:

- The added-line conditions see added lines only, the removed-line
  conditions removed lines only; unchanged lines count for neither. The
  dropped pair sees removed lines, and added lines only to decide whether
  the edit added the item back.
- An unknown key (`addedContain`, `contains`) is
  `unknown-condition`, never ignored. An empty `<when>` is `empty-when`; a
  value that is not a list, or an empty string, is `invalid-when`.
- No flags: for any case, write `'[Uu][Ss][Dd]'`.

[Spec: Conditions](../../spec/SPEC.md#conditions).

## 7. Checks: `<check>`

A `<check>` searches an applicable rule's counted files, and its hits go to
the reviewer. It never decides whether the rule applies, and a hit is not a
verdict. The language is `regex` unless `lang` says otherwise.

```html
<rule id="cart-totals-from-quote" category="functional_correctness">
  <scope>
    files: ["src/checkout/cart/**"]
  </scope>
  <check>
    \.reduce\(
  </check>
  <check lang="ast-grep">
    $ITEMS.reduce($$$)
  </check>
  Cart totals come from the quote, never from summing line items.
</rule>
```

**Regex dialect** (also used by `addedMatches`, `removedMatches` and
`droppedMatches`):
literals, `.`, `[...]`, `[^...]`, `^`, `$`, `\b`, `(x)`, `(?:x)`, `|`, `*`,
`+`, `?`, `{n}`, `{n,}`, `{n,m}` (at most 1000), ASCII-only `\d \w \s`,
`\t`, `\x41`, and `\` before ASCII punctuation. Case-sensitive, one line at
a time.

Watch out:

- A check body is raw text, not YAML: write `\.reduce\(` with no quotes, or
  the quotes become part of the pattern.
- A `regex` body is one line (`regex-not-one-line`). These are
  `regex-outside-dialect`: lookaround `(?=`, `\1`, named groups, `(?i)`,
  `\p{L}`, `\u` escapes, and a bare `{` (write `style=\{`).
- An `ast-grep` body may span lines (ast-grep 0.51.0; use only `$NAME`,
  `$$$` and `$$$NAME`). The reference CLI 0.6.x skips every ast-grep check
  with the warning `check-needs-file` (`unsupported-check-language` when
  the ast-grep binary is missing); the rule still applies. Prefer a regex.
- An unknown `lang` is skipped with `unsupported-check-language`.

[Spec: Checks](../../spec/SPEC.md#checks),
[Regex dialect](../../spec/SPEC.md#regex-dialect),
[ast-grep checks](../../spec/SPEC.md#ast-grep-checks).

## 8. Context: `<context>`

A `<context>` points the reviewer at background reading and says when it is
relevant. It takes `<scope>`, `<when>` and `<meta>` like a rule, but no
`<check>`, category or severity, and gets no verdict. Attributes: `id`,
`src`, `disabled`.

```html
<context id="checkout-architecture" src="docs/architecture.md">
  Read before judging any change to how a price is computed.
</context>

<context id="pricing-glossary" src="./glossary.md">
</context>

<context id="quote-lifecycle">
  A quote expires 30 minutes after the cart is priced. Any price shown after
  that comes from a new quote.
</context>
```

- A plain `src` resolves from the base, in the governed repo.
- A `src` starting `./` or `../` resolves from the folder holding the
  `.lore` file (`./glossary.md` is beside it) and must not climb above the
  Lore root (`src-escapes-root`).
- Without `src`, the body is the context. With it, the body is an optional
  note on when to read the file.

Watch out: `src` names one file: no globs, no leading or trailing `/`, `..`
only at the start. A target that is not a tracked file gives
`missing-src-target`; the context still applies. Under `--no-repo`, the CLI
cannot see the governed repo, so a plain `src` always gives that warning and
the reviewer gets only the body. In an external rules folder, keep documents
beside the rules and use `./`.
[Spec: Context](../../spec/SPEC.md#context).

## 9. Sources: `<source>`

A rule's `<source>` names the file the rule was written from: a review
guide, a decision record, the skill it was converted from, or the code that
sets a convention. It is a structured block holding one mapping, or a list
of mappings for several sources. `lore audit` reads it to report a source
that has moved or changed. It never affects selection.

| Key | Required | Value |
|---|---|---|
| `file` | yes | one file, never a glob |
| `heading` | no | a heading in the file, as written or as its slug; only when `file` ends in `.md`, `.mdx` or `.markdown` |
| `phrase` | no | text that appears in the file; with `heading`, inside that heading's section |

In an external folder, beside a copy of the converted skill kept in the
same `.lore/` folder:

```html
<rule id="money-in-minor-units" category="functional_correctness" severity="blocking">
  <source>
    file: ./checkout-review.md
    heading: "2. Money is integer minor units `[BLOCKING]`"
  </source>
  Amounts are integers in minor units (cents).
</rule>

<rule id="price-from-quote" category="functional_correctness" severity="blocking">
  <source>
    - file: ./checkout-review.md
      heading: 1-displayed-prices-come-from-the-quote-blocking
    - file: ./checkout-review.md
      phrase: quote-level discounts
  </source>
  A displayed price must come from the quote that produced it.
</rule>
```

The first heading is copied as the file writes it, backticks included, and
quoted for YAML. The second is the slug of
``## 1. Displayed prices come from the quote `[BLOCKING]` ``: lower-cased,
every character but letters, numbers, `_`, `-` and spaces dropped, each
space turned into `-`.

| `file` written | Resolves from |
|---|---|
| `./x`, `../x` | the folder holding the `.lore` file, never above the Lore root. In an external folder, a file of that folder. |
| `x` | the base, in the governed repo |
| `/x` | the governed repo's root; in a loose folder, the loose folder |

- A heading matches only its own text or its slug. `Money is integer minor
  units` matches no heading of a file whose heading is
  ``2. Money is integer minor units `[BLOCKING]` ``: give the whole
  heading, its number and tags included.
- A source with only `file` is flagged by any edit to that file. Give a
  `heading` or a `phrase` wherever the file has one.
- Several items are one block: `- file: ...` per item. A second
  `<source>` is `duplicate-child`.

Watch out:

- `source:` in `<meta>` is free text that no tool checks. `lore audit
  --level meta-source=warn` lists the rules that still carry one; move each
  to a `<source>` block.
- `invalid-source` excludes the rule: a bare path (`docs/review.md` on its
  own line), an unknown key (`section:`), an empty or non-string value, a
  `heading` on a file that is not Markdown (the extension compared
  case-sensitively, so `NOTES.MD` is not Markdown), a path that climbs
  above the Lore root, or two items naming the same file, heading and
  phrase. An attribute on `<source>` is `unknown-attribute`; a `<source>`
  in a context is `unknown-child`.
- Cite only a file every reader of the rules can open, and that stays:
  never a path on your machine, a URL, or a document in another
  repository. In an external folder, write `./` or `../`: a leading `/`
  names the loose folder while it is loose and the governed repo once it
  is committed. When the source will lose the cited text (a skill trimmed
  to its steps after a conversion), keep one copy of it as converted in
  the rules folder and cite that one from every rule, with `../` where
  needed: a copy per `.lore` folder drifts.
- Parsing never reads the cited file, so a wrong path or heading passes
  `lore select --strict`. Only `lore audit` finds it.
- An older tool reads `<source>` as `unknown-child` and excludes the rule.
  Every tool that reads the rules needs lore 0.6.0 or later first.

Checking sources, and recording a review:

```
lore audit --no-repo --remote https://github.com/acme/shop.git --given team-rules
lore audit --level meta-source=warn
lore review --file .lore/checkout.lore
```

| Finding | Meaning | Default |
|---|---|---|
| `source-missing` | the file is not a tracked file, or the heading or phrase is not in it | error |
| `source-unchecked` | the file was not there to read (under `--no-repo`, any source in the governed repo) | error |
| `source-changed` | the cited text changed since the last review | warn |
| `never-reviewed` | no review recorded yet: expected for a new rule | warn |
| `review-overdue`, `ambiguous-heading`, `orphan-review` | old record, two matching headings, a record of a rule or source that is gone | warn |

- `lore audit` reads cited files as `lore select` reads rules: in a git
  checkout, tracked files only, so `git add` a cited copy. Under
  `--no-repo`, a plain path or a leading `/` in an external folder is
  `source-unchecked`; `./` and `../` sources are still checked. It exits 1
  on any finding at level `error`, so CI can run it.
- `lore review` records, in `lore-reviews.lock`, that a person compared
  the named rules with their sources today. It does not perform the review,
  and it is that person's statement: an agent never runs it for rules it
  wrote. The reviewer runs it from a git checkout after reading, then
  `git add`s the lock file.

[Spec: Sources](../../spec/SPEC.md#sources),
[Auditing sources](../../spec/SPEC.md#auditing-sources),
[CLI README: lore audit](../../packages/cli/README.md#lore-audit).

## 10. Defaults: `<defaults>`

A file block giving every rule in its file a fallback `category` and
`severity`. It holds only those two keys, comes before the first entry, and
never applies to contexts. A rule's own attributes win.

```html
<defaults>
  category: backwards_compatibility
  severity: blocking
</defaults>

<rule id="api-follows-schema">
  <when>
    changed: ["/src/schema.graphql"]
  </when>
  An API change made alongside a schema change still works with the schema
  that is deployed now.
</rule>
```

Watch out: any problem in `<defaults>` (an unknown key, `severity:
critical`, an undeclared category) excludes the whole file.
[Spec: Defaults](../../spec/SPEC.md#defaults).

## 11. `.loreconfig`

A YAML file named `.loreconfig` that applies to its directory and below,
like `.gitignore`. It may sit anywhere except inside a `.lore/` folder.
Every key is optional.

| Key | Value | Meaning |
|---|---|---|
| `lore` | `1` | the spec version |
| `root` | `true` or `false` | this directory is a **Lore root**: lookup stops here |
| `categories` | list | custom categories, matching `^[a-z][a-z0-9_]*$` |
| `disable` | list of ids | entries switched off for changed files here and below |
| `repo` | `<host>/<path>` | external rules folders only ([section 12](#12-external-rules-folders)) |

```yaml
lore: 1
categories: [data_retention]
disable: [money-in-minor-units]
```

- Lookup runs upward to the nearest `root: true`, or the repo root.
- `categories` and `disable` add down the tree: a lower `.loreconfig` cannot
  remove a category or switch an entry back on. A category declared beside
  or below a Lore file is unknown to it.
- `disable` is the consumer's switch (`disabled` is the author's). `changed`
  and `unchanged` still see switched-off paths. An unknown id warns
  `unknown-disabled-id`.

Watch out: any problem (an unknown key, `lore: 2`, `root: yes`, a
non-list `disable`) is `invalid-loreconfig`, and the whole file is ignored,
so rules using its categories fail with `unknown-category`. A `repo` key in
the governed repo is `repo-inside-repo`.
[Spec: .loreconfig](../../spec/SPEC.md#loreconfig),
[Lore root](../../spec/SPEC.md#lore-root),
[Disable](../../spec/SPEC.md#disable).

## 12. External rules folders

Rules can live outside the repo they govern, such as in a team repo. A
`.loreconfig` with a `repo` key **marks** its directory as the governed
repo's root, and the directories below it mirror the governed repo.

```
team-rules/
  .loreconfig            root: true
                         categories: [data_retention]
  shop/
    .loreconfig          repo: github.com/acme/shop
    .lore/repo.lore      base: the shop's root
    src/checkout/.lore/
      checkout.lore      base: src/checkout/ in the shop
      glossary.md        src="./glossary.md"
      checkout-review.md <source> file: ./checkout-review.md
```

- `repo` is `<host>/<path>` with no scheme, `.git` or trailing `/`. It
  matches a remote after normalizing, case-insensitively:
  `https://github.com/acme/shop.git`, `git@github.com:Acme/shop.git` and
  `ssh://git@github.com/acme/shop` all match `github.com/acme/shop`.
- Pass the folder as a **given folder** (`--given team-rules`): one that
  holds the marked directory, never one inside it. Directories marked for
  other repos are skipped.
- Each tree resolves its own `.loreconfig` files, so the governed repo's
  categories are unknown in the external folder and the other way round.
  Put shared categories, with `root: true`, above the marked directories.
  Without one, the marked directory is the Lore root.
- The governed repo's `disable` can switch off external rules; an external
  `disable` never touches the governed repo's rules. Ids must be unique
  across both.

Watch out:

- In a git checkout only tracked files count. `lore select` exits 2 ("git
  tracks none of its files") when the given folder has no tracked files,
  and silently skips untracked files otherwise. `git add` every rule file,
  and commit to share them.
- A folder in no git checkout (a **loose folder**, such as a download) is
  read whole, skipping dot-directories other than `.lore`, with the warning
  `untracked-given-folder`. That warning is expected; do not work around it.
- A marked directory below another is `nested-repo`.

[Spec: External folders](../../spec/SPEC.md#external-folders),
[Matching the governed repo](../../spec/SPEC.md#matching-the-governed-repo),
[Trees](../../spec/SPEC.md#trees).

## 13. Eligibility

An entry applies to a change (is **eligible**) when it has no error, is not
`disabled`, its scope holds at least one changed file that no `disable` list
switches it off for, and every `<when>` condition holds. A deleted file
counts by its old path, a renamed one by both. An entry with no scope and no
`<when>` in the root `.lore/` folder applies to every change. By default,
rules are read as the change leaves them, so a change can loosen a rule and
be judged by the looser one. With a **rules revision** (`--rules-ref main`),
the rules come from that revision: the target branch's rules judge the
change.
[Spec: Eligibility](../../spec/SPEC.md#eligibility).

## 14. Checking your work

`lore select` selects the rules that apply to a diff. `lore verdicts`
checks a reviewer's answers against that selection. `lore audit` checks
every rule's `<source>` ([section 9](#9-sources-source)). None calls a
model or the network.

```
git diff main... | lore select --diff - --format text
git diff main... | lore select --diff - --format json --strict > selection.json
lore select --no-repo --remote https://github.com/acme/shop.git \
  --given team-rules --diff change.diff --format json
lore verdicts --selection selection.json verdicts.json
lore audit --no-repo --remote https://github.com/acme/shop.git --given team-rules
```

| Flag | Use |
|---|---|
| `--diff <file>` | a unified diff with `a/` and `b/` prefixes, or `-` for stdin (required) |
| `--repo <dir>` | the governed repo (default: the git root above the current directory) |
| `--no-repo` | the governed repo holds no Lore files; needs `--remote` |
| `--remote <url>` | the governed repo's remote, to match `repo` keys (repeatable) |
| `--given <dir>` | an external rules folder (repeatable) |
| `--rules-ref <ref>` | read the repo's Lore files at this git ref |
| `--format text` or `json` | text is the reviewer's prompt; json feeds `lore verdicts` |
| `--strict` | exit 1 when any error excluded a file, entry or `.loreconfig` |

The json has `rules` (each with its `hits`), `context`, `change`,
`excluded` and `warnings`. Text output prints excluded entries to stderr.

A **verdict set** answers every selected rule, and no context, exactly once:

```json
{
  "lore": "1",
  "verdicts": [
    { "rule": "money-in-minor-units", "verdict": "fail",
      "evidence": [{ "file": "src/checkout/Price.tsx", "line": 2 }],
      "note": "The total is parsed into a float." },
    { "rule": "price-from-quote", "verdict": "pass" },
    { "rule": "migration-with-schema", "verdict": "not-applicable",
      "note": "The change adds no migration." }
  ]
}
```

- `lore` is the string `"1"`; `verdict` is `pass`, `fail` or
  `not-applicable`.
- An evidence item is `{ "file", "line", "side" }`. `side` is `new` (the
  default: a line as the change leaves it) or `old` (a removed line, by its
  old path). The file must be in the change.
- A `fail` needs evidence. Anything but `pass` needs a non-empty `note`.
- `lore verdicts` prints `{ "problems": [...] }`, named `missing-verdict`,
  `duplicate-verdict`, `unselected-verdict` (a context id included),
  `fail-without-evidence`, `missing-note`, `evidence-outside-change` or
  `invalid-verdict-set`.

Exit codes: `lore select` 0 when it ran, 1 with `--strict` and something
excluded. `lore verdicts` 0 with no problems, 1 with problems. Both: 2 for a
usage or input error, 70 for an internal error.
[CLI README](../../packages/cli/README.md).

## 15. Errors and warnings

An error excludes the file, entry or `.loreconfig` it is in; a warning
excludes nothing. The ones authors meet most:

| Name | Cause | Fix |
|---|---|---|
| `top-level-text` | text outside any element, or after a comment's `-->` | wrap it in `<!-- -->` or move it into prose |
| `unreadable-structure` | an unclosed element or comment, or a stray closing tag | close it at column 0 |
| `invalid-yaml` | unquoted `**` glob, `"\d"`, a `//` comment | quote globs; single-quote regexes; use `#` |
| `unknown-attribute` | `owner=` on a rule, `category=` on a context | move it to `<meta>` |
| `invalid-attribute-value` | unquoted value, `severity="high"` | double quotes; `blocking` or `advisory` |
| `duplicate-id` | one id on two entries, in any collected files | rename one |
| `unknown-category` | category neither fixed nor declared above | add it to a `.loreconfig` `categories` |
| `unknown-condition` | `addedContain`, `contains` | use the eight condition keys |
| `invalid-when`, `empty-when` | a value that is not a list; no keys | `key: ["..."]` |
| `leading-slash`, `glob-escapes-base` | `/` or `..` in a scope glob | glob from the base; move the file up |
| `invalid-glob` | `!` prefix, `**.ts`, unclosed `[` or `{`, a `\` | `ignores`; `**/*.ts` |
| `regex-outside-dialect` | lookaround, `\1`, `(?i)`, bare `{` | stay in the dialect; `\{` |
| `unknown-child`, `duplicate-child` | `<example>`, `<check>` or `<source>` in a context, two `<when>` | one of each; examples in prose |
| `invalid-source` | a bare path, `section:`, `heading` on a non-Markdown file, an empty value | `file:` plus `heading` or `phrase` ([section 9](#9-sources-source)) |
| `invalid-loreconfig` | unknown key, `root: yes`, a non-list value | fix it; the whole file was ignored |
| `src-escapes-root` | `./../..` climbs above the Lore root | keep the target inside the Lore root |
| `missing-category` (warning) | no category anywhere | add one, or a `<defaults>` |
| `empty-scope` (warning) | rule scope disjoint from file scope | fix the glob or move the rule |
| `missing-src-target` (warning) | `src` names no tracked file | fix the path; under `--no-repo`, use `./` |
| `untracked-given-folder` (warning) | a given folder in no git checkout | expected for a loose folder |
| `check-needs-file` (CLI warning) | an ast-grep check, skipped by CLI 0.6.x | a regex check, `addedContains` or `removedContains` |

The full list: [Spec: Errors and warnings](../../spec/SPEC.md#errors-and-warnings).
What each excludes: [Error reach](../../spec/SPEC.md#error-reach).
