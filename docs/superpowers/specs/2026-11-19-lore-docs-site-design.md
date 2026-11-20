# Lore docs site

## Intent

The README sells Lore and gives a quick tour, but nobody can learn the
whole format or the tool from it. The real reference exists but is hard
to use: `spec/SPEC.md` is 8,700 lines in CommonMark-spec style, and the
CLI reference is buried in `packages/cli/README.md`. Lore needs a docs
site where someone can learn everything Lore and its tools do.

It serves three readers, all equally:

- **Rule writers:** teams writing `.lore` and `.loreconfig` files.
- **CLI and pipeline users:** people wiring `lore` into review, agents
  or CI.
- **Implementers:** people building another parser, tool or integration
  against the spec and schemas.

## Goals

- A docs site on GitHub Pages, built and deployed from the Lore repo
  (`m4ttstack/lore`), at `https://m4ttstack.github.io/lore/`.
- A Guide (quick start, core concepts, topics, how-to guides) that
  teaches the format, and a Reference for every element, key and command.
- A reference page for each CLI command.
- The spec on the site, split one page per top-level section and
  generated from `spec/SPEC.md`, so the site never holds a copy of it.
- Generated reference pages for error and warning codes
  (`spec/errors.json`) and the JSON Schemas (`spec/schemas/`).
- A test that fails CI when a CLI command or flag has no docs.

## Non-goals

- A docs.mattstack.dev tab. That site gets only a short pointer page,
  built as the last step of this work (see Deliverables).
- A custom domain. `m4ttstack.github.io/lore` for now.
- Versioned docs (one set per CLI release).
- A playground or anything interactive.
- Docs for the editor packages beyond what their READMEs say today. One
  page linking to them is enough until they are published.

## Anti-goals

- Hand-copying spec text into pages. Concept pages explain in plain
  language and link to the spec section; they never paste normative text.
- Docs that drift from the CLI unnoticed. A flag added in a PR with no
  docs must fail CI.
- Pages that describe behavior nobody verified in the source.

## Constraints

- Docusaurus 3, the stack docs.mattstack.dev runs, so the Docusaurus
  config, conventions and skills in repo-tools carry over
  (`repo-tools/sites/docs/docusaurus.config.ts`;
  `repo-tools/skills/docusaurus-config/SKILL.md` and
  `docusaurus-documentation/SKILL.md`, read by path).
- Broken links, anchors and Markdown links fail the build
  (`onBrokenLinks`, `onBrokenAnchors`, `onBrokenMarkdownLinks: "throw"`),
  as on docs.mattstack.dev.
- Lore's writing voice: plain language, short sentences, no em or en
  dashes, as in the README.
- `scripts/fixtures.ts` builds test fixtures from the README's code
  samples, so README edits that touch code blocks must regenerate
  fixtures (CI checks they are clean).
- The repo is a bun workspace over `packages/*`; CI pins bun 1.4.3.

## Approaches

| | What | Trade-off |
|---|---|---|
| **A. Docusaurus, full site (picked)** | Guides, concepts, per-command CLI pages, the spec split by section, generated error and schema pages, a coverage test | Most work; reuses the Docusaurus know-how Matt already has |
| B. Starlight, full site | Same content on Astro Starlight | Lighter and has search built in, but a second docs stack beside mattstack's |
| C. Publish existing Markdown | README, CLI README and SPEC.md behind a sidebar | An afternoon's work, but adds none of the missing guides or concepts |

Matt picked A. Hosting on GitHub Pages from the Lore repo, rather than a
docs.mattstack.dev tab, was also his call: Lore presents itself as a
tool-neutral format, docs change in the same PR as the code they
describe, and there is no cross-repo build.

## Decided

- **Readers:** all three, as above (Matt).
- **Hosting:** GitHub Pages from `m4ttstack/lore` (Matt).
- **Stack:** Docusaurus 3 (Matt, approach A).
- **Pointer:** docs.mattstack.dev gets a short page linking to the Lore
  site (Matt).
- **Deploy on release:** the site deploys when a `cli-v*` tag is pushed,
  so it always matches the version on npm (Matt). A PR that changes the
  CLI still builds the site and must document its flags (the coverage
  test); those docs publish with the next release. A manual
  `workflow_dispatch` re-deploys from the latest `cli-v*` tag, for
  spec-only or typo fixes that should not wait. (Manual re-deploy from
  the latest tag, not from `main`, is my call: it keeps "the site matches
  npm" true.)

## Models

The site's structure and writing follow four docs sites for tools of the
same shape (a rule format plus a CLI), studied 2026-11-19:

- **Vale** (docs.vale.sh): style rules in folders plus a CLI, the
  closest match to Lore. Taken: one reference page per rule type and per
  config key with the same table each time; every rule example paired
  with the input and the tool's exact output; concept pages that go
  from a plain definition to a minimal example to a real one, and end
  with the lookup or precedence order as a numbered list; version gates
  as one "Requires ..." note; a Markdown twin of every page and an
  `llms.txt` for agents.
- **ESLint** (eslint.org/docs): Taken: one short "Core concepts" page
  that defines each term in a paragraph or two and links on; CLI
  options grouped by task, each option with the same block (description,
  argument, repeatable, default, example); the full `--help` output at
  the top of the CLI reference as an index; "incorrect" and "correct"
  example pairs; a "Next steps" list at the end of a page.
- **ast-grep** (ast-grep.github.io): Taken: navbar split into a Guide
  and a Reference; a reference page that opens with an index of every
  key grouped by purpose, then one heading per key with its type and
  whether it is required; a CLI hub page with a table of every command,
  plus a page per command; a quick start that begins with one command
  and grows from there.
- **Semgrep** (docs.semgrep.dev): Taken: a Required and Optional table at
  the top of the syntax reference, linking to each key's section; every
  key documented as a definition, a complete example, and what it
  selects and what it does not. Avoided: a CLI reference that is only a
  raw help dump.

Not taken: ast-grep's marketing tone, playground links (Lore has no
playground), and pages titled by error message (the error registry
already gives each code its own anchor).

## Writing style

- Direct and neutral. Guides speak to the reader as "you"; reference
  pages describe in the third person. No marketing language.
- Short sentences (about 10 to 25 words), paragraphs of one to three
  sentences, plain words. No em or en dashes.
- An example follows the sentence that introduces it, usually after a
  colon, and is followed by one sentence saying what it shows.
- Every rule example comes with a change and what Lore does with it:
  the exact `lore check` output, or "selects" and "does not select"
  pairs, taken from real runs, never typed by hand.
- Callouts are rare and typed: tip, note, warning. A feature that needs
  a recent CLI gets one note: "Requires lore 0.6.0 or later."
- Each guide and concept page ends with "Next steps": two to four links,
  each with one sentence on what the reader finds there.

## Site structure

Top navbar: **Guide**, **Reference**, **Specification**, and a GitHub
link. Guide is for learning, Reference for looking things up,
Specification for implementers.

### Guide

- **What is Lore:** what Lore is and why, condensed from the README's
  opening, "Why Lore" and "Design principles". Links to the README's
  "Does it work?" results rather than repeating them.
- **Quick start:** one command first (`npx @mattstack/lore check` on a
  repo with one rule), then growing to a `<when>` condition and a
  second file. Each step shows the real output.
- **Core concepts:** one page, a paragraph or two per term (rule,
  context, scope, condition, check, source, Lore folder, `.loreconfig`,
  selection, verdict), each ending with a link to its topic page.
- **Topics**, one page each, simplest to advanced, ending with any
  lookup or precedence order as a numbered list: files and folders;
  writing rules (ids, categories, severity, prose); scope; conditions
  (every `<when>` key, with the added, removed and dropped pairs);
  checks; context; sources and reviews; configuration (`.loreconfig`
  lookup order); shared rule repositories (given folders, `repo` keys,
  reading rules at a ref); how selection works (and the verdict format).
- **How-to guides:** convert an existing review guide (pointing at the
  `writing-lore` skill); run `lore check` from an agent (the `AGENTS.md`
  line); hand a reviewer the selection and check verdicts; run Lore in
  CI; adopt `<source>` file by file; keep rules in a shared repository;
  Lore or a skill (the README's comparison).
- **Editors:** highlighting (`.gitattributes`), and links to the VS Code,
  Zed, Prettier and language server READMEs.

### Reference

- **Format:** one page per element: `<rule>`, `<context>`, `<scope>`,
  `<defaults>`, `<when>`, `<check>`, `<source>`, `<meta>`; and one page
  for `.loreconfig`. Each page opens with a Required and Optional table
  of its attributes or keys, linking to each one's section. Each
  attribute or key then gets a heading in code font, a short list
  (type, required, default), a definition, an example, and for
  conditions a "selects" and "does not select" pair. Each page ends
  with the spec sections that define it.
- **CLI:** a hub page with install, requirements, the single-file
  `lore.js`, a table of every command, and the full `lore --help`
  output. Then one page per command (`select`, `check`, `verdicts`,
  `audit`, `review`): purpose, usage, options grouped by task, each
  option with the same block (description, argument, repeatable,
  default, example), output in text and JSON with a real sample, and
  exit codes. Shared options (rules and output) are defined once on
  their own page and linked. Also: rules in scope, not triggered
  (`--also-in-scope`, `--expand`, cost notes); output formats (the
  selection JSON, text output, the verdict set); exit codes. Content
  moves from `packages/cli/README.md`.
- **Errors and warnings:** a link to the spec's Errors and warnings page,
  the one error-code reference.

After the move, `packages/cli/README.md` keeps what npm readers need:
what the command is, install, one example per command, and a link to the
site.

### Specification (implementers)

- Generated at build time from `spec/SPEC.md`: one page per `##`
  section, all 24, in the spec's order: Introduction, Conventions,
  Conformance examples, Files and folders, Parsing, Defaults, Rules,
  Context, Categories and severity, Scope and globs, Conditions, Regex
  dialect, Checks, Sources, Eligibility, Auditing sources, Error reach,
  `.loreconfig`, External folders, Collecting files, Document model,
  Errors and warnings, For agents (non-normative), Adopting Lore
  (non-normative).
- **Errors and warnings** is the site's one error-code reference. Its
  table is generated from `spec/errors.json` (the spec says the two are
  the same list), with an anchor per code (`#unknown-element`) so other
  pages, and later the language server's hover, can link to a code. The
  build fails if the spec's table and `errors.json` disagree. (My call.)
- **For agents** already quotes `spec/AGENT.md` in full, so there is no
  separate AGENT.md page. (My call.)
- **Adopting Lore** stays a spec page; the Guide pages link to it rather
  than repeat it.
- Links inside the spec (`#auditing-sources`) are rewritten to the page
  and anchor that now holds the target. A link that cannot be resolved
  fails the build.
- Conformance examples render as code blocks with their number shown.
- The pages are generated into a gitignored folder; nothing generated is
  committed.
- **Schemas:** a generated page per schema in `spec/schemas/`, showing
  the schema JSON with its title and description.
- **Licenses:** the README's license section.

Note that `##` headings inside conformance examples' inputs (such as
"Money is integer minor units") are not sections; splitting follows
headings outside fenced blocks only, counting fence length, since
examples open with six backticks and hold shorter fences inside.

## Repo layout

- `site/` at the repo root: Docusaurus config, sidebars, hand-written
  pages under `site/docs/`, its own `package.json` and lockfile. It stays
  out of the bun workspace (`packages/*`), so Docusaurus's dependencies
  never touch the packages' install or CI cache. (My call.)
- A generator script (TypeScript, run with bun) that writes the spec,
  error and schema pages before `docusaurus build` and `docusaurus
  start`.
- `.github/workflows/docs.yml`: builds the site on every PR that touches
  `site/`, `spec/` or `packages/cli/`, and deploys to Pages on a `cli-v*`
  tag or a manual run (see Deploy on release).

## Coverage test

A bun test in the repo (so `bun test` in CI runs it):

- Every command in the CLI's usage text has a page under `site/docs/reference/cli/`.
- Every flag the CLI accepts for a command appears on that command's
  page or on the shared options page it links to. The flag lists come
  from the CLI's own source (`packages/cli/src/args.ts` and the `HELP`
  text in `main.ts`), not a copy.
- Every page under `site/docs/reference/cli/` names a real command.
- Every key in `spec/schemas/when.schema.json`, `scope.schema.json`,
  `defaults.schema.json` and `loreconfig.schema.json` has a heading on
  its Format reference page.

## Search and agents

Local search with `@easyops-cn/docusaurus-search-local`, so the site is
searchable without an Algolia application. An `llms.txt` and a Markdown
copy of every page, as Vale does, so agents can read the docs; Lore is
written for agents as much as people. (Both my calls.)

## README changes

- The root README keeps its pitch, tour and examples, and gains a
  prominent link to the docs site near the top and in "Try it" and
  "Specification".
- `packages/cli/README.md` slims as described above.
- Package READMEs are unchanged.

## Deliverables and order

1. The site in `site/`, with the generator, the coverage test and the
   docs workflow, built on a branch and merged.
2. Matt enables GitHub Pages for `m4ttstack/lore` with GitHub Actions as
   the source (needs repo admin; Pages is off today). This is a manual
   step for Matt.
3. A first deploy. The latest tag (`cli-v0.6.1`) predates `site/`, so
   the first deploy cannot come from a tag that exists today: cut the
   next `cli-v*` release after the site merges, or, while `main` has no
   CLI changes since the last release, allow the manual run to deploy
   from `main` this once.
4. The README changes: the docs link in the root README and the slimmed
   CLI README, once the site is live so the links resolve.
5. The docs.mattstack.dev pointer page in repo-tools, following the
   `rt:docs` skill there.

## Left to the builder

- Page wording, examples and ordering within each section.
- The generator's internals and how it rewrites spec anchors.
- Theme colors and logo (none exists; a plain wordmark is fine).
- Whether to use Mermaid for the "how tools use Lore" flow.
- The docs.mattstack.dev pointer page's placement and wording.
