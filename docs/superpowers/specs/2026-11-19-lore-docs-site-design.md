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
- Concept pages and guides that teach the format to rule writers.
- A reference page for each CLI command.
- The spec on the site, split one page per top-level section and
  generated from `spec/SPEC.md`, so the site never holds a copy of it.
- Generated reference pages for error and warning codes
  (`spec/errors.json`) and the JSON Schemas (`spec/schemas/`).
- A test that fails CI when a CLI command or flag has no docs.

## Non-goals

- A docs.mattstack.dev tab. That site gets only a short pointer page
  (a separate small change in repo-tools).
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

## Site structure

Top navbar: **Learn**, **CLI**, **Specification**, and a GitHub link.

### Learn (rule writers)

- **Introduction:** what Lore is and why, condensed from the README's
  opening, "Why Lore" and "Design principles". Links to the README's
  "Does it work?" results rather than repeating them.
- **Getting started:** write a first `.lore` file, run `lore check`,
  read the output.
- **Concepts**, one page each: files and folders (`.lore/` folders,
  where globs resolve); entries (rules and context, ids, categories,
  severity); scope (`<scope>`, `<defaults>`, narrowing); conditions
  (`<when>` and every key, including the added, removed and dropped
  pairs); checks (`<check>`, regex and ast-grep, hits are hints);
  context (`<context>`, `src`); sources and reviews (`<source>`, lock
  files, `lore audit`, `lore review`); configuration (`.loreconfig`:
  categories, `disable`, `root`, `loose`, `audit`); shared rule
  repositories (given folders, `repo` keys, reading rules at a ref);
  selection (how a tool decides which entries apply, and the verdict
  format).
- **Guides:** convert an existing review guide (pointing at the
  `writing-lore` skill); run `lore check` from an agent (the `AGENTS.md`
  line); hand a reviewer the selection and check verdicts; run Lore in
  CI; adopt `<source>` file by file; keep rules in a shared repository;
  Lore or a skill (the README's comparison).
- **Editors:** one page on highlighting (`.gitattributes`), and links to
  the VS Code, Zed, Prettier and language server READMEs.

Each concept page ends with links to the spec sections that define it.

### CLI (CLI and pipeline users)

- **Overview:** install, Node and git requirements, the single-file
  `lore.js` from releases, how the commands relate.
- One page per command: `select`, `check`, `verdicts`, `audit`,
  `review`. Each has usage, every option, examples, output in text and
  JSON, and exit codes. Content moves from `packages/cli/README.md`.
- **Shared options:** the rules options (`--repo`, `--no-repo`,
  `--remote`, `--rules-ref`, `--given`) and output options, defined once
  and linked from each command.
- **Rules in scope, not triggered:** `--also-in-scope` and `--expand`,
  with the cost notes.
- **Output formats:** the selection JSON, the text output, the verdict
  set.
- **Exit codes.**
- **Errors and warnings:** generated from `spec/errors.json`, one entry
  per code with its kind and description, grouped errors first. Each
  code has its own anchor so pages and the language server's hover could
  link to it.

After the move, `packages/cli/README.md` keeps what npm readers need:
what the command is, install, one example per command, and a link to the
site.

### Specification (implementers)

- Generated at build time from `spec/SPEC.md`: one page per `##`
  section (Introduction, Conventions, Conformance examples, Files and
  folders, Parsing, Defaults, Rules, Context, Categories and severity,
  Scope and globs, Conditions, Regex dialect, Checks, Sources,
  Eligibility, Auditing sources, `.loreconfig`), in the spec's order.
- Links inside the spec (`#auditing-sources`) are rewritten to the page
  and anchor that now holds the target. A link that cannot be resolved
  fails the build.
- Conformance examples render as code blocks with their number shown.
- The pages are generated into a gitignored folder; nothing generated is
  committed.
- **Schemas:** a generated page per schema in `spec/schemas/`, showing
  the schema JSON with its title and description.
- **Agent instructions:** `spec/AGENT.md`, shown as a page.
- **Licenses:** the README's license section.

Note that `##` headings inside conformance examples' inputs (such as
"Money is integer minor units") are not sections; splitting follows
headings outside fenced blocks only.

## Repo layout

- `site/` at the repo root: Docusaurus config, sidebars, hand-written
  pages under `site/docs/`, its own `package.json` and lockfile. It stays
  out of the bun workspace (`packages/*`), so Docusaurus's dependencies
  never touch the packages' install or CI cache. (My call.)
- A generator script (TypeScript, run with bun) that writes the spec,
  error and schema pages before `docusaurus build` and `docusaurus
  start`.
- `.github/workflows/docs.yml`: builds the site on every PR that touches
  `site/`, `spec/` or `packages/cli/`, and deploys to Pages on push to
  `main`. (My call; see the question on releases below.)

## Coverage test

A bun test in the repo (so `bun test` in CI runs it):

- Every command in the CLI's usage text has a page under `site/docs/cli/`.
- Every flag the CLI accepts for a command appears on that command's
  page or on the shared options page it links to. The flag lists come
  from the CLI's own source (`packages/cli/src/args.ts` and the `HELP`
  text in `main.ts`), not a copy.
- Every page under `site/docs/cli/` names a real command.

## Search

Local search with `@easyops-cn/docusaurus-search-local`, so the site is
searchable without an Algolia application. (My call.)

## README changes

- The root README keeps its pitch, tour and examples, and gains a
  prominent link to the docs site near the top and in "Try it" and
  "Specification".
- `packages/cli/README.md` slims as described above.
- Package READMEs are unchanged.

## Left to the builder

- Page wording, examples and ordering within each section.
- The generator's internals and how it rewrites spec anchors.
- Theme colors and logo (none exists; a plain wordmark is fine).
- Whether to use Mermaid for the "how tools use Lore" flow.
- The docs.mattstack.dev pointer page's placement and wording, following
  the `rt:docs` skill in repo-tools.
