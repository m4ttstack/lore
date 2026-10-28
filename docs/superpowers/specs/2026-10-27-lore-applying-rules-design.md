# Lore applying rules: design

Status: draft for review, 2026-10-27. Step 3 of 5.

Builds on the specification (`spec/SPEC.md`, 98 conformance examples),
the step 1 design (`2026-10-25-lore-spec-design.md`) and the step 2
editor tooling design (`2026-10-26-lore-editor-tooling-design.md`).

## Why

Lore's promise is that a reviewer reads the rules that bear on a change
and nothing else. Today that promise stops at selection: the reference
parser computes the eligible rules and hits for a change, but only as a
library function, and nothing says what a reviewer gives back. A team
that keeps its review rules as one long block of prose, read in full for
every change, gets two costs at once: the reviewer's prompt is large, and
its attention is spread over rules that do not apply.

Step 3 closes the loop from a change to a judgment on each rule:

- a `lore` command that any tool can call to get the rules that apply to
  a change, ready to hand to a reviewer;
- a verdict format, so a reviewer answers every selected rule and a
  caller can tell a rule that passed from a rule nobody checked.

The first adopter is a team converting about 100 existing review rules
into Lore and wiring this command into its agent review pipeline. That
work happens in its own private repository and is described there. This
document covers only what lands in the public Lore repo, and is written so
that any tool can use it the same way.

## Goals

- A `lore select` command that takes rules and a change and prints the
  selected entries, their hits and the context to read, as JSON and as
  text ready to paste into a reviewer's prompt.
- Four ways to describe the change: a unified diff, a list of paths, the
  spec's change as JSON, and two git refs.
- Rules read from a folder or from a git ref, plus any number of given
  folders (external folders), so the rules that judge a change can come
  from the branch it merges into.
- A verdict format in the spec: for each selected rule, `pass`, `fail` or
  `not-applicable`, with evidence, and a rule for when a set of verdicts
  is complete.
- A `lore verdicts` command that checks a reviewer's verdicts against a
  selection: well formed, every selected rule answered exactly once, no
  rule answered that was not selected.
- The step 2 gates that a command line tool exposes, closed (see
  Constraints).

## Non-goals

- Running a reviewer. The command selects and checks; calling a model,
  posting comments and deciding whether a change may merge stay with the
  caller.
- Talking to a forge. The command never calls GitLab or GitHub. A caller
  that reviews a merge request fetches its diff and refs itself.
- Fan-out (one reviewer per rule). The verdict format allows it; building
  it is later work.
- The online playground from the roadmap. It moves to a later step; the
  command line tool comes first because the first adopter needs it.
- Publishing to npm. The format's name is not final (see `spec/SPEC.md`,
  Conventions), so the package name waits too. The command ships as a
  single bundled JavaScript file attached to a GitHub release, and later
  as standalone binaries.
- A second implementation. A Rust port is planned as Lore's second
  conforming implementation, after this step.

## Anti-goals

- A command that needs a checkout to be useful. A reviewer that only
  reads a diff must get the same rules a checkout would give it, except
  for the checks that need whole files (see ast-grep below).
- Inputs shaped around one forge or one pipeline. Every input is
  something a shell, a CI job or an agent can produce without Lore
  knowing where it came from.
- Verdicts that can be silently incomplete. A caller must be able to
  tell, mechanically, that every selected rule got an answer.

## Constraints

- TypeScript, in this Bun workspace, built on `@lore/parser`. The command
  is a thin layer: parsing and selection stay in the parser, and every
  behaviour the spec defines is tested through the conformance examples
  there, not again in the command.
- Runs under both Node 20+ and Bun from one bundled file
  (`bun build --target node`). This closes the step 2 gate where
  `@lore/parser`'s `main` points at TypeScript source: the command never
  imports source at run time.
- The caller decides which revision's rules run (see Rules): `--rules-ref`
  or `--base` names one, and otherwise the working tree or the given
  folders are read as they stand. The first adopter's rules are in a
  given folder that ships with its reviewer, and once in-repo they are
  read at the branch a change merges into, so every rule that runs has
  been merged. The linear-time regex gate from step 2 is
  therefore not a blocker for this step; the remaining two small gates
  are:
  - a `RegexLimitError` message is truncated before it is printed;
  - an ast-grep timeout or crash becomes a warning naming the rule and
    file, never a crash of the command.
- Selection must not read every repository file's content (the last step
  2 gate). It lists tracked paths and reads only the `.lore` and
  `.loreconfig` files, the files a `src` names, and, for ast-grep checks,
  the changed files.
- No forge, model or network access. Git is the only external program the
  command runs, and only when a git input is used.

## The command

```
lore select   [rules] [change] [--capabilities regex,ast-grep] [--format text|json] [--strict]
lore verdicts --selection <file> [<verdicts-file> | -]
```

`--capabilities` defaults to both; `ast-grep` is dropped, with the
parser's existing warning, when no ast-grep binary is found.

### Rules

| Flag | Meaning |
|---|---|
| `--repo <dir>` | The governed repo's working tree. Default: the git root above the current directory. |
| `--rules-ref <ref>` | Read the repo's Lore files at this git ref instead of the working tree, through `git show` and `git ls-tree`. No checkout needed. |
| `--given <dir>` | A given folder, as the spec defines it. Repeatable. External folders inside it are found and mapped by `repo`, exactly as `spec/SPEC.md` External folders says. |
| `--remote <host/path>` | The governed repo's remote, for matching `repo`. Default: read from `git remote -v` in `--repo`. Repeatable. |

With `--base`/`--head` (below) and no `--rules-ref`, the rules are read at
`--base`. With any other change input and no `--rules-ref`, they are read
from the working tree as it stands; making it match a branch is the
caller's business.

**The spec gains a rules revision.** Today the spec reads the governed
repo "as the change leaves it", so a rule a change adds is eligible for
that same change (an Eligibility example expects exactly this). A team
that lets a change judge itself by its own rules lets a change delete or
loosen the rule in its way. The spec therefore gains, in Collecting
files, an optional **rules revision**: a tool MAY let its caller name a
revision of the governed repo to read Lore files, `.loreconfig` files
and `src` targets from, instead of the revision the change leaves. The
change itself (its files and added lines) is unaffected. Without one, a
tool reads as today, so every existing example keeps its meaning, and
the command's tests compare against the examples with no rules revision
given. `--rules-ref`, and `--base` when `--rules-ref` is absent, set it.

The example format gains a section for it, `=== rules:<path>`: a file of
the governed repo as it is at the rules revision. An eligibility example
with at least one `rules:` section is run with a rules revision: Lore
files, `.loreconfig` files and `src` targets are collected from the
`rules:` files only, and the plain `=== <path>` files are still the
governed repo as the change leaves it (the content checks search). An
example with no `rules:` section is run as today. A diagnostic's `file`
for a file read at the rules revision keeps the `rules:` prefix, as
`external:` files keep theirs. One new example, placed beside the
existing Eligibility example where a change adds `quote-expiry-shown`,
gives the same change with `checkout.lore` at the rules revision
holding `price-from-quote` but not `quote-expiry-shown`, and expects
`price-from-quote` eligible and `quote-expiry-shown` not.

Two existing spec sentences gain a qualifier when these additions land:
Eligibility's "the entries themselves are read from the files as the
change leaves them" (unless a rules revision is given), and Collecting
files' "MUST NOT find them by walking a file system" (except in a given
folder in no working copy).

**Given folders outside a working copy.** The spec collects only files
tracked by version control, so that a stray `node_modules/**/.lore/`
cannot add rules. A given folder that is in no git working copy (an
installed plugin, an unpacked release, a CI artifact) would therefore
collect nothing. The spec gains: a tool MAY collect a given folder that
is in no working copy, counting every file under it except those inside
a dot-folder other than `.lore`; when it does, it MUST report the warning
`untracked-given-folder` once for that folder, and a tool MAY instead
refuse such a folder and collect nothing from it. The spec text names
the trade-off: the team, not version control, then decides what is in
the folder.

The example format gains `=== loose:<path>`: a file of one given folder
that is in no working copy, `<path>` relative to that folder. The
warning's `file` is `loose:.` and its `line` is 1, and it joins
`errors.json` as a warning. A diagnostic in a loose folder's file keeps
the `loose:` prefix, as `rules:` and `external:` files keep theirs. One new example gives
a loose folder with a `.loreconfig` mapping it to the governed repo, a
rule that is eligible, and a `.lore` file inside a dot-folder
(`.cache/.lore/stale.lore`) that is not collected; it expects the
warning. An example with `loose:` sections is run only by a tool that
collects such folders, declared with `requires: loose-given-folder`, as
`regex` and `ast-grep` are. The reference parser and `lore select`
collect such folders and report the warning.

Both sections are new to `tools/check` (its extractor accepts only the
current five) and to the parser's conformance test, which learn them in
the same change as the spec text.

**No governed repo.** `--repo` may point nowhere a reviewer can reach: a
review that reads only a diff can run outside any checkout. With
`--no-repo`, the governed repo is taken to hold no Lore files and no
`src` targets; rules come only from `--given` folders, and `--remote` is
then required, since there is no git to read it from. Without `--no-repo`
and with no git root found, the command exits 2 and says to pass
`--repo` or `--no-repo`. `--rules-ref`, `--base` and `--head` with
`--no-repo` are usage errors (exit 2): there is no git to read them in.

### Change

Exactly one of these. Giving none, or two, is a usage error (exit 2).

| Input | Meaning |
|---|---|
| `--diff <file>` or `--diff -` | A unified diff (`git diff`, `git format-patch`, a forge's `.diff` download). Renames are read from `rename from`/`rename to`; added lines and their new line numbers from the hunks. |
| `--paths <path>...` or `--paths -` | Paths only, one per line on stdin with `-`. Each is a modified file with no added lines. |
| `--change <file>` or `--change -` | The spec's change as JSON: `{ "files": [{ "kind": "A"\|"M"\|"D"\|"R", "path", "oldPath"?, "added": [{ "line", "text" }] }] }`. |
| `--base <ref> --head <ref>` | Build the diff with `git diff --find-renames <base>...<head>` in `--repo`. |

**Paths mode and added-line conditions.** With paths there are no added
lines, so any rule whose `<when>` needs an `addedContains` or
`addedMatches` condition is not eligible. That is correct selection, but
a writer about to start work still wants to know about such rules. In
paths mode only, the result therefore adds `conditional`: the ids of
rules that would be eligible if their added-line conditions held. This
is a command feature, not a change to eligibility, and the text output
lists these rules under their own heading.

**ast-grep and whole files.** An ast-grep check matches structure, so it
needs the changed file's whole new content. The command has it with
`--base`/`--head` (`git show <head>:<path>`) and with a working tree
whose files match the change's new side. With `--diff`, `--paths` or
`--change` and no working tree that matches, it skips each ast-grep
check and reports the warning `check-needs-file` for it (a command
warning, not a spec one), and the rule stays eligible.

### Output

`--format json` (the default when stdout is not a terminal) prints:

```json
{
  "lore": "1",
  "rules": [
    {
      "id": "...", "file": "...", "category": "...", "severity": "blocking",
      "summary": "...", "prose": "...", "meta": null,
      "hits": [{ "file": "...", "line": 12, "text": "..." }]
    }
  ],
  "context": [{ "id": "...", "file": "...", "summary": "...", "prose": "...", "src": "...", "srcText": "..." }],
  "conditional": [],
  "change": [{ "kind": "M", "path": "...", "oldPath": null, "added": [12, 13] }],
  "excluded": [ /* the eligibility result's excluded diagnostics */ ],
  "warnings": [ /* one list, sorted like the eligibility warnings */ ]
}
```

Rules come in the order of the eligibility result. `change` lists the
change's files with their added line numbers (not their text), so a
verdict checker has everything it needs from this one document. `srcText` is the
content of the file a context's `src` names, read at the same ref as the
rules, or null when it has none. `warnings` is one sorted list of the eligibility warnings and
the command's own (`check-needs-file`, `src-not-read` and `lore-file-not-read`).

`--format text` (the default on a terminal) prints the same content as
Markdown a reviewer can read directly: a short preamble with the verdict
instructions (below), then each rule as a heading with its id, severity
and category, its prose, and its hits as `file:line` with the line text;
then each context with its prose and `src` text; then warnings. The text
form is what a caller pastes into a prompt, so its wording is part of
this design's review, and it carries the verdict instructions so a
reviewer never needs `AGENT.md` as well.

Exit codes: 0 when selection ran, whatever it selected; 1 when the rules
have errors that excluded entries and `--strict` is given; 2 on a usage
or input error (unreadable diff, unknown ref).

## Verdicts

A new spec section, **Verdicts**, normative, with conformance examples
of a new kind, `verdicts`. Each gives a **selection** (the `lore select`
JSON shape above, trimmed to `rules`, `context` and `change`; the spec
defines this shape, so it is not a command detail) and a verdict set,
and expects the problems a checker reports. Rules and contexts are
separate lists in the selection, so a checker never has to tell them
apart from ids alone.

A verdict answers one eligible rule:

```json
{
  "rule": "money-in-minor-units",
  "verdict": "fail",
  "evidence": [{ "file": "apps/web/src/pricing/Price.tsx", "line": 3, "text": "..." }],
  "note": "Adds a float multiply on a price; the rule wants integer cents."
}
```

- `verdict` is `pass`, `fail` or `not-applicable`.
  - `pass`: the change keeps the rule.
  - `fail`: the change breaks it. `evidence` MUST hold at least one
    location in a changed file.
  - `not-applicable`: the rule was selected but does not bear on this
    change (selection is deliberately broad: a scope can match a file the
    rule has nothing to say about). `note` MUST say why.
- `note` is the reviewer's reason, in prose. Required for `fail` and
  `not-applicable`, optional for `pass`.
- Each hit is a pointer, not a verdict: a rule with hits can pass, and a
  rule without hits can fail. A `fail` whose evidence includes a hit
  location is the common case.
- An evidence location has `side`, `new` (the default) or `old`. A `new`
  location names a changed file by its new path, not a deleted one, and
  a line in the file as the change leaves it. An `old` location names a
  changed file by its old path (a deleted, modified or renamed file) and
  a line in the file before the change: the way to point at a guard the
  change removed. `text` is optional on both. A checker can confirm the
  file is part of the change but not that the line exists, since the
  selection carries added line numbers, not file lengths.

A **verdict set** is `{ "lore": "1", "verdicts": [...] }`. It is
**complete** for an eligibility result when it holds exactly one verdict
for each eligible rule and none for any other id. Contexts get no
verdict. A checker reports these problems, each naming the rule:
`missing-verdict`, `duplicate-verdict`, `unselected-verdict`,
`fail-without-evidence`, `evidence-outside-change` (a `new` location in
no changed file that still exists, or an `old` location in no changed
file's old path), and `missing-note`.

Severity stays the rule's: a `fail` of a `blocking` rule is a blocking
problem and a `fail` of an `advisory` rule is advice. How a caller maps
that onto its own finding levels, and whether it re-checks a fail before
acting on it, is the caller's business.

`lore verdicts` reads the selection (the JSON from `lore select`) and a
verdict set and prints the problems as JSON; exit 0 when there are none,
1 otherwise.

`AGENT.md` step 4 is updated to point at the verdict format, so a plain
agent and a tool-backed one report the same shape.

## The slice first

The first adopter builds this end to end on a thin slice before widening
it, so real numbers arrive early and spec gaps surface while they are
cheap. In this repo the slice is:

1. `lore select` with `--repo`, `--no-repo`, `--remote`, `--rules-ref`,
   `--given`, `--diff` and `--format text|json`; the two spec additions
   (rules revision, given folders outside a working copy) with their
   examples; the two small step 2 gates and the path-listing change to
   collection.
2. `lore verdicts`, checking the draft verdict format above. The
   adopter's review engine checks verdicts mechanically from its first
   run, so the checker ships in the slice.
3. The bundled file attached to a GitHub release.

The rest follows once the slice is running for the adopter:

4. `--paths` (with `conditional`), `--change`, `--base`/`--head`, and
   ast-grep with whole files.
5. The Verdicts spec section with its examples, made normative from the
   draft and what the slice's reviews taught, and the `AGENT.md` update.
6. README: "How tools use Lore" gains the command, and the roadmap moves
   the playground to a later step.

The verdict format is a draft in the slice: `lore verdicts` implements
it and the adopter's reviewer answers in it, but it only enters the spec
in 5, after real reviews have used it. A change to the draft in 5 is a
change to `lore verdicts` too.

## Testing

- Each input form has a fixture test that produces a known change, then
  checks that selecting with it matches the conformance example it was
  built from. The unified diff parser gets its own tests: renames, new and
  deleted files, `\ No newline at end of file`, binary files (no added
  lines), CRLF.
- `--rules-ref` is tested against a temporary git repository whose rules
  differ between two commits.
- The text output gets a snapshot test, and is looked at by a person, not
  just snapshotted, before the slice ships.
- `verdicts` examples run in the conformance check, as `parse` and
  `eligibility` examples do.
- CI builds the bundle and runs it under Node and Bun against one
  example.

## Left to the builder

- Command line parsing library or none, and the internal layout of the
  command package (`packages/cli`, name `@lore/cli`, binary `lore`).
- The exact Markdown of the text output, within the content above.
- How `--repo` lists tracked paths (`git ls-files` or `git ls-tree`) and
  how the parser's input is shaped to avoid reading content it does not
  need.
