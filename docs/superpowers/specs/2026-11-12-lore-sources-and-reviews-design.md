# Checked rule sources and review records: design

Date: 2026-11-12. Status: for approval. Tracker: LORE-13.

## Intent

A rule usually comes from somewhere: a section of a review guide, an
architecture note, a decision record. Teams write that down today as a
`source:` line in `<meta>`, which no tool reads. When the document is
edited, the pointer goes stale and nothing says so. In one docs cleanup
on a governed repo, 9 of the 20 pointers into the edited files named a
heading that had been renamed, moved or removed, and it was found only
because someone went looking.

Rules also carry no record of when a person last confirmed they still
match their source. A date in `<meta>` would only record a claim.

This change makes both first-class. A rule names its sources in a
structured block that tools resolve. A review is recorded, by a
command, as a date plus a fingerprint of the source text that was
reviewed, so a rule comes due when its source changes and not only when
time passes.

## Goals

- A rule can cite one or more sources: a file in the governed repo, and
  optionally a heading or a quoted phrase inside it.
- A command reports every source that no longer resolves.
- A command records that a rule was reviewed against its sources as
  they stand now.
- The same report lists rules whose source text changed since their
  last review, rules never reviewed, and rules whose review is older
  than an age the team sets.
- By default a source that does not resolve fails the command, and the
  other findings are warnings. Each level, and the age, can be changed
  by the team.
- A review record never appears in what a reviewer is handed by
  `lore select` or `lore check`.

## Non-goals

- Any change to eligibility. A source and its review state never decide
  whether a rule is selected.
- Sources on `<context>` entries. A context with `src` already points at
  its document. Rules only, in this release.
- Sources that are not files in the governed repo: URLs, ticket ids,
  labels. Those stay in `<meta>`, which remains free-form.
- Line numbers as pointers. They move with every edit above them and a
  tool cannot tell a stale one from a good one.
- Fetching anything over the network.
- Editor diagnostics for a source that does not resolve. The editors
  accept, complete and format the new block; live checking is a
  follow-up.
- The other reports LORE-7 describes for `lore audit` (dead triggers,
  rules never selected). This change creates the command with the source
  and review reports only.
- A migration command in the CLI. See Migration.
- A way to record a review for every rule, or every changed rule, in one
  command. See `lore review`.

## Anti-goals

- A tool that gives meaning to keys inside `<meta>`. The specification
  says it gives no meta key a meaning, and a team already using
  `source:` for a link must not get errors from an upgrade.
- A tool that rewrites hand-written Lore files. Review records are tool
  data and live in a file only tools write.
- A check that passes silently when it could not look. If the governed
  repo's files are not available, the report says the sources were not
  checked, and by default that fails.
- A record that can be written without the source being present and
  resolving.
- A record that is cheap to write for rules nobody read. A review
  record is only worth having if writing one is a deliberate act.

## Constraints

- The format stays at `lore: 1`. Conditions were added within version 1
  before (`removedContains`, `droppedContains`), and this follows that
  precedent.
- A tool older than this change reads `<source>` as `unknown-child` and
  excludes that rule only, and reads an unknown `.loreconfig` key as
  `invalid-loreconfig` and ignores the whole file. Tools must be
  upgraded before files use either. The README and the release notes
  say so.
- No new syntax. `<source>` is a structured block like `<scope>`,
  `<when>` and `<meta>`: a paired element whose content is YAML.
- The repository is public. Examples use the shop and checkout names the
  specification already uses.

## Approaches

1. **Reserved keys in `<meta>`** (`source`, `reviewed`, `sourceHash`).
   No new element and no migration. Rejected: it contradicts the
   specification's promise that no meta key has meaning, breaks teams
   that use those keys freely, and puts a tool-written hash in a
   hand-written file.
2. **A `<source>` block that also carries the date and hash.** One
   place to look. Rejected: the tool would rewrite hand-written files on
   every review, and a hash in the file can be edited by hand to quiet a
   warning.
3. **A `<source>` block for the pointer, and a lock file for review
   records.** Chosen. The pointer is something a person writes and a
   tool acts on, which is what Lore calls structure. The review record
   is state about an event, written by a tool, and is kept apart the way
   a package manager keeps a lock file apart from its manifest. Costs: a
   new child across the parser, grammar, formatter and editor packages,
   a one-time move for teams with `source:` lines, and a reader of a raw
   rule file cannot see when it was last reviewed.

Two forms of the element were also weighed. An empty element with
attributes (`<source file="..." />`) is not expressible: the format has
no self-closing tags, and an older tool would reject the whole file. A
YAML block needs no new syntax, holds any string, validates by schema as
the other blocks do, and costs an older tool only the one rule.

Reading git history instead of storing anything was considered too: a
rule is due when its source changed in a later commit than the rule.
Rejected: a review that concludes no change is needed leaves no trace,
an unrelated edit to the rule counts as a review, and history is absent
in shallow clones and external folders.

## Design

### The `<source>` block

A rule may have one `<source>` child. It is a structured block whose
value is a mapping, or a list of one or more mappings.

```html
<rule id="money-in-minor-units" category="functional_correctness" severity="blocking">
  <source>
    file: docs/checkout-review.md
    heading: Money is integer minor units
  </source>
  <when>
    addedContains: ["parseFloat(", "toFixed("]
  </when>
  Amounts are integers in minor units (cents).
</rule>
```

```html
<source>
  - file: /docs/decisions/0042-quote-prices.md
  - file: ./money.ts
    phrase: 'export function fromCents('
</source>
```

| Key | Required | Value |
|---|---|---|
| `file` | yes | One file, as a non-empty string. See File paths. |
| `heading` | no | A non-empty string: a heading in the file, given as its text or its slug. Only when `file` ends in `.md`, `.mdx` or `.markdown`. |
| `phrase` | no | A non-empty string that must appear in the file. With `heading`, it must appear inside that heading's section. |

- `<source>` takes no attributes (`unknown-attribute`) and may appear
  once (`duplicate-child`), as `<scope>` and `<when>` do.
- Any other shape is `invalid-source`, entry-level, at the line the
  other block errors use: a value that is not a mapping or a non-empty
  list of mappings, a key the table does not name, a missing or empty
  `file`, a value that is not a string, a `heading` on a file that is
  not Markdown, a `file` that breaks the path rules, and two items that
  resolve to the same file with the same `heading` and `phrase`.
- On a `<context>`, `<source>` is `unknown-child`.
- The document model gains `sources` on every entry: a list, in the
  order written, of `{ "file", "heading", "phrase" }`, with `file`
  resolved and the other two null when absent. A rule without the block,
  and every context, has `sources: []`. Every existing parse example
  and the document model schema gain the field.
- Parsing never reads the cited file. Whether a source resolves is
  found by `lore audit`, so `lore select` costs what it did and works
  without the cited files.
- `lore select` and `lore check` text output is unchanged. In JSON, a
  rule carries its `sources`. No review data appears in either.

### File paths

`file` names one file, not a glob.

- A path starting `./` or `../` is relative to the Lore file, exactly as
  a context's `src` is, and must stay inside the Lore root.
- A path starting `/` is from the governed repo's root. In an external
  folder it is from the root its `repo` mapping stands for. In a loose
  folder it is from the loose folder.
- Any other path resolves from the base, or through the `repo` mapping
  in an external folder, as a plain `src` does.
- Apart from the one leading `/`, the segment rules are those of `src`:
  no empty segments, `.` and `..` only at the start.
- In the document model, `file` is the resolved path, with the
  `external:` and `loose:` prefixes `src` uses.

### Matching inside the file

- **Headings** are ATX headings (`#` to `######`) outside fenced code
  blocks. A heading's text is the line without its `#` markers, a
  closing run of `#`, and surrounding spaces, with inline markup left as
  written.
- A heading matches when its text equals the value, or when the slug of
  its text equals the slug of the value. The slug is lower case, with
  characters other than letters, digits, `-`, `_` and spaces removed,
  and spaces turned to `-`.
- When more than one heading matches, the first is used and the audit
  reports `ambiguous-heading`.
- A **section** is the text from a heading's line up to, and not
  including, the next heading of the same or a higher level, or the end
  of the file.
- A **phrase** matches case-sensitively after every run of whitespace,
  in both the phrase and the file, is collapsed to one space.

### Fingerprints

The fingerprint of a source is the first 12 hex characters of the
SHA-256 of its **reviewed text** as UTF-8, after normalizing: line
endings to LF, trailing whitespace on each line removed, runs of blank
lines collapsed to one, leading and trailing blank lines removed.

| Source has | Reviewed text |
|---|---|
| `file` only | the whole file |
| `heading` (with or without `phrase`) | that heading's section |
| `phrase` only, Markdown file | the section of the nearest heading above the first match, or the whole file when the match is above the first heading |
| `phrase` only, other file | the whole file |

A file that is not valid UTF-8 is hashed as its raw bytes, and a
`heading` or `phrase` on it does not resolve.

### The lock file

One file, `lore-reviews.lock`, in the directory of each Lore root: the
governed repo's root, a directory with `root: true`, or the root of an
external or loose folder. It holds the records for every rule collected
under that root, so moving a rule between Lore folders keeps its
record. It is not inside a Lore folder and is not a Lore file. Only
`lore review` writes it.

It is JSON Lines: a header line, then one record per line, sorted by
rule id, then file, heading and phrase. A record is one line, so two
branches that review different rules merge without a conflict.

```json
{"lore-reviews":1}
{"rule":"money-in-minor-units","file":"docs/checkout-review.md","heading":"Money is integer minor units","phrase":null,"reviewed":"2026-11-12","hash":"3fa9c1d2e7b4"}
```

- A record is tied to a source by the rule id, the resolved `file`, and
  `heading` and `phrase` as written. Changing any of them makes it a
  different source, which has no record until it is reviewed. Correcting
  a pointer therefore calls for a fresh review of that rule.
- `reviewed` is the date of the review (`YYYY-MM-DD`, from the local
  clock, or from `--date`). Nothing records who reviewed: the lock
  file's git history does.
- A lock file that cannot be read as this format, or whose header is
  not `{"lore-reviews":1}`, is an input error (exit 2). It is never
  repaired silently.

### `lore review`

```
lore review (<id>... | --file <lore-file>... | --prune) [--date <YYYY-MM-DD>] [--repo <dir>] [--given <dir>]...
```

Records a review. For each rule named by id, or each rule in a named
Lore file, it resolves every source, computes the fingerprints and
writes the rule's records, replacing those it had.

- There is no way to name every rule, or every changed rule, at once.
  A record is a person's statement that they compared the rule with its
  source, and the command is kept deliberate so the record keeps that
  meaning. A large rule set is adopted file by file.
- A rule with a source that does not resolve is refused: its records
  are left as they were, the problem is printed as the audit prints it,
  and the exit code is 1. Other rules in the same run are still
  written. A rule with an `ambiguous-heading` is written, with the
  warning.
- An id that names no rule, a rule with no `<source>`, or a `--file`
  that is not a collected Lore file, is a usage error and nothing is
  written.
- Every run also removes records whose rule or source no longer
  exists. `--prune` does only that.
- It writes to the working tree, so it reads rules from disk,
  untracked Lore files included as `lore check` does. `--rules-ref`,
  `--remote` and `--no-repo` are usage errors.
- It prints one line per rule written or refused.

### `lore audit`

```
lore audit [--format text|json] [--max-age <days>] [--level <finding>=<level>]... [--strict] [rules options]
```

Reads every rule the tool collects for the governed repo and the given
folders, with no change involved, disabled rules included, and reports:

| Finding | Meaning | Default level |
|---|---|---|
| `source-missing` | The file is not a tracked file, or the heading or phrase is not found. | error |
| `source-unchecked` | The files this source needs were not available to look at. | error |
| `ambiguous-heading` | More than one heading matched. | warn |
| `source-changed` | The fingerprint differs from the record. | warn |
| `never-reviewed` | A source has no record. | warn |
| `review-overdue` | The record is older than the age limit. Not reported when no limit is set. | warn |
| `orphan-review` | The lock file has a record for a rule or source that no longer exists. | warn |
| `meta-source` | A rule has a `source` key in `<meta>` and no `<source>` block. | off |

- A level is `error`, `warn` or `off`. Exit codes: 1 when a finding at
  level `error` is reported, or when `--strict` is given and entries
  were excluded; otherwise 0; 2 and 70 as the other commands use them.
- Cited files are tracked files read from the working tree, as a
  context's `src` target is read. With `--rules-ref`, rules, the lock
  file and cited files are all read at that revision.
- Sources that resolve into the governed repo need it: with `--no-repo`
  they are `source-unchecked`. File-relative sources in a given folder
  resolve inside that folder and are always checked.
- Text output groups findings by Lore file, one line each: level,
  finding, rule id, the source and a short reason (`heading not found:
  "Money is integer minor units"`). It ends with a count per finding
  and the number of rules with and without a source. JSON output is
  `{ "findings": [...], "summary": {...} }`.
- Excluded entries are listed as the other commands list them and are
  not audited.

### Settings

Levels and the age limit are set in `.loreconfig` under one new key,
and can be overridden on the command line.

```yaml
audit:
  maxAgeDays: 180
  levels:
    source-changed: error
    never-reviewed: off
```

- `audit` is a mapping with optional `maxAgeDays` (a positive integer)
  and `levels` (a mapping from a finding name in the table to a level).
  Anything else is `invalid-loreconfig`.
- Each setting is looked up on its own: `maxAgeDays`, and each finding's
  level, takes its value from the nearest `.loreconfig` that sets it, on
  the way up from the rule's Lore file to its Lore root. A setting
  nobody sets has the default above.
- A finding with no rule (`orphan-review`) takes the settings of the
  `.loreconfig` in the Lore root's directory.
- `--max-age` and `--level` override the files for the whole run.

### Specified and tested

The block, the path rules, the document model field, `invalid-source`
and the `audit` config key go in the specification with `parse`
examples, schemas and fixtures. So do heading matching, sections,
fingerprints, the lock file format and the meaning of each finding,
because two tools must agree on them. The specification gains a third
example kind, `audit`: a set of files, a lock file and the date, with
the expected findings. The two commands' flags, output wording and exit
codes are tool behavior and are described in the CLI README, as those
of `select` are.

### Packages touched

- `spec/`: as above, plus `errors.json`, the schemas and the fixture
  generator, which learns the `audit` example kind.
- `packages/parser`: the block, `sources`, the config key, the
  conformance harness for `audit` examples, and the heading, section and
  fingerprint functions, so the CLI and later the language server share
  them.
- `packages/cli`: `audit`, `review`, `sources` in selection JSON.
- `packages/tree-sitter-lore`, `packages/prettier-plugin`,
  `packages/language-server`, `packages/vscode`, `packages/zed`: accept,
  highlight, format, complete and document the block as they do
  `<scope>`. No resolving.

### Migration

A team with `source:` lines in `<meta>` moves them by hand or with its
own script. `lore audit --level meta-source=warn` lists the rules still
to move. A `source` key in `<meta>` keeps working as free-form meta and
is never an error. There is no migration command, because a value in
`<meta>` has no defined shape to convert from.

## Decisions made with the user

- Checked sources and review records are one feature.
- A source is always a file in the governed repo. Other provenance
  stays in `<meta>`.
- A pointer inside a file is a heading or a quoted phrase, not a line
  number.
- A rule comes due when its source text changes, and also when a set
  age passes.
- A source that does not resolve fails by default; changed and overdue
  warn by default; all of it is configurable.
- The pointer is structure in the rule, and review records live in a
  tool-written lock file.
- The pointer is a YAML block, like the other structured children, not
  an element with attributes.

## Calls made in this document

- Reviews are recorded for named rules or one Lore file at a time, with
  no flag for everything. Chosen because adding such a flag later breaks
  nobody, and removing one would.
- The check lives in a new `lore audit` command, shared with LORE-7.
- `lore review` is the only writer of the lock file, refuses a rule
  whose source does not resolve, still writes the other rules in the
  run, and prunes orphan records.
- One lock file per Lore root, named `lore-reviews.lock`, as JSON
  Lines.
- A changed pointer is a new source and needs a fresh review.
- One `<source>` block per rule, holding a mapping or a list.
- Rules only; contexts cannot carry a source in this release.
- `file` follows the `src` path rules, plus a leading `/` for the repo
  root.
- A heading may be given as text or slug. Fingerprints are 12 hex
  characters of SHA-256 over normalized text.
- Settings live under an `audit` key in `.loreconfig`, each looked up
  on its own, with flags to override.
- `never-reviewed` is a warning by default, so adopting the block does
  not fail a build until the team has recorded its reviews.
- Sources that could not be checked are an error by default, changed by
  level like any other finding.
- The fingerprint, lock format and findings are specified and get a new
  `audit` example kind.
- No migration command; `meta-source` is an opt-in finding.
- Editor packages accept the block only.

## Known limits

- A source with only `file` is flagged by any edit to that file. A
  file cited whole by many rules makes them all due together. The README
  advises a heading or phrase wherever the file has one.
- A review record says a person ran the command for that rule. It
  cannot prove they read it.

## Left to the builder

- The slug function's exact character classes, pinned by examples.
- Names and wording of text output lines and notices.
- How `lore audit` and `lore review` share the finding computation.
- The order of work across packages, and whether the editor packages
  ship in the same release as the CLI.
