# Lore

Lore is an open file format for the things a team knows about its code
that a linter can't check: "a displayed price must come from the quote
that produced it", "a `.graphql` change ships with regenerated types",
"never show a verified badge over data nothing verified".

Each rule is a small, named unit with a scope (where it can be broken),
optional conditions, a category and a severity. A tool reads the rules,
works out which ones apply to a change, and hands exactly those to a
reviewer, human or agent.

> **Status:** design stage. The syntax below is a proposal and will change.
> "Lore" is a working name.

## Why

Most teams already write this knowledge down. It ends up in long prose:
agent skills, `AGENTS.md` files, review checklists, wiki pages. That works
until it doesn't:

- **Hard to maintain.** Adding or retiring one rule means editing a big
  document and hoping nothing else leaned on that paragraph.
- **No selection.** Nothing knows which rules matter for a given change,
  so a reviewer reads everything or misses things.
- **No record.** Nobody can say which rules a review actually checked.

Lore keeps the knowledge as plain files in git, but gives every rule
enough structure that a tool can pick the right ones for a diff without
reading the prose first.

It's a spec, not a product, the way GraphQL is a spec with many
implementations. Any repo can adopt it, and an agent with no Lore tooling
at all can read a `.lore` file and know what to do with it.

## What it looks like

Rules live in `.lore` files inside a `.lore/` folder. The folder can sit
anywhere: next to the code it covers, or in one central place. Globs
resolve relative to the folder's parent.

```
apps/web/src/checkout/
  .lore/
    pricing.lore
  cart/
  payment/
```

A `.lore` file is made of tagged sections, a bit like a Svelte or Vue
component. YAML or JSON where tools need structure, Markdown where people
write.

```
<defaults>
category: functional_correctness
severity: blocking
</defaults>

<scope>
files: ["**/*.{ts,tsx,graphql}"]
ignores: ["**/*.test.{ts,tsx}"]
</scope>

<rule id="price-from-quote">
A displayed price must come from the quote that produced it.

No helper may recompute a price separately from the quote, even when the
inputs look identical: the quote carries discounts the inputs don't.
</rule>
```

The file's `<scope>` covers every rule in it. That rule applies to any
change touching a `.ts`, `.tsx` or `.graphql` file under `checkout/`,
tests excluded. A rule's prose states the whole rule on its own, and its
first paragraph doubles as the summary tools show in lists and verdicts.

Structured blocks are YAML 1.2, and JSON is valid YAML, so a team writes
whichever it prefers. This `<scope>` means the same as the one above:

```
<scope>
{ "files": ["**/*.{ts,tsx,graphql}"], "ignores": ["**/*.test.{ts,tsx}"] }
</scope>
```

### Narrowing a rule's scope

A rule can narrow its file's scope, never widen it.

```
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
```

### Conditions on the diff

`<when>` makes a rule apply only when the change looks a certain way:
added lines containing or matching something (`addedContains`,
`addedMatches`), or files elsewhere in the diff that did or didn't change
(`changed`, `unchanged`). The rule above only applies when a `.graphql`
file changed and nothing under `__generated__/` did. A leading `/` means
the repo root.

```
<rule id="currency-from-settings" severity="advisory">
<when>
addedContains: ["'USD'", "'EUR'"]
</when>
Display text never hard-codes a currency code; it uses the shop's
`currency` setting.
</rule>
```

### Pointing the reviewer at lines

`<check>` is a cheap, deterministic search over the rule's in-scope
changed files. Its hits go to the reviewer with file and line. A hit is a
pointer, not a verdict: the reviewer still decides, and no hits doesn't
mean the rule passed.

```
<rule id="no-or-across-columns">
<check lang="ast-grep">
db.$MODEL.findMany({ where: { OR: $$$ } })
</check>
No `where` that ORs across different columns; split it into separate
queries.
</rule>
```

```
<rule id="currency-from-settings" severity="advisory">
<check>
'(USD|EUR)'
</check>
Display text never hard-codes a currency code; it uses the shop's
`currency` setting.
</rule>
```

Checks are `regex` (the default, in a small dialect every language agrees
on) or `ast-grep`. No shell commands, so reading Lore never means running
code.

### Notes for tools

A `<meta>` block holds anything the spec doesn't interpret, like where a
rule came from or who owns it. Tools keep it but never use it to decide
what applies.

```
<rule id="price-from-quote">
<meta>
source: docs/pricing-review.md#prices
owner: checkout
</meta>
A displayed price must come from the quote that produced it.
</rule>
```

### Context documents

Not everything is a rule. Architecture docs and background reading stay
where they are; a `<context>` entry tells a reviewer when to read them. It
uses the same scope and conditions, and never gets a verdict.

```
<context id="checkout-architecture" src="ARCHITECTURE.md">
Read before judging any change to how a price is computed.
</context>
```

## Which rules apply

Given a diff, a rule or context entry applies when:

1. it isn't marked `disabled` (or switched off by a `.loreconfig`, below),
2. at least one changed file is in its scope, and
3. its `<when>`, if any, holds.

An entry with no scope and no conditions applies to every change under its
folder's parent; at the repo root, that's every change. This is computed
by code, the same way in every tool. A broken entry is skipped and always
reported, never silently dropped.

## `.loreconfig`

A `.loreconfig` can sit in any directory and applies to everything below
it, inherited the way `.gitignore` is.

```yaml
lore: 1
categories: [data_provenance]
disable: [currency-from-settings]
```

`disable` switches rules off for changes at or below that directory, even
rules that come from a shared Lore folder another team owns. `root: true`
stops the lookup from going further up, as in EditorConfig.

A rule has one of nine built-in categories (`functional_correctness`,
`test_coverage`, `security`, `performance`, `accessibility`,
`observability`, `backwards_compatibility`, `documentation`, `code_style`)
or one a `.loreconfig` above it adds. Severity is `blocking` (fix or
explicitly waive before merge) or `advisory` (raise it, the author
decides), and defaults to `advisory`.

### Keeping Lore outside the repo

Because everything is glob-based, Lore doesn't have to live in the repo it
covers. A team can keep it in its own repo and point it at the code:

```
team-repo/lore/shop/
  .loreconfig        repo: github.com/acme/shop
  .lore/
    checkout.lore    globs resolve from the shop repo's root
```

## Adopting it

Lore files are only read from version control, so nothing in
`node_modules` or an ignored folder can add rules.

Until Lore has its own grammar, one line in `.gitattributes` highlights
`.lore` files as Markdown on GitHub and GitLab:

```
*.lore linguist-language=Markdown gitlab-language=markdown
```

The spec will also ship a short paragraph to paste into `AGENTS.md`,
`CLAUDE.md`, Cursor rules or Copilot instructions, so agents you already
use apply Lore with nothing installed.

## Prior art

Lore borrows from tools that each do part of this:

| | Has | Missing for this job |
|---|---|---|
| [Aviator invariants](https://docs.aviator.co/verify/concepts/invariants) | Categories, conditions, a verdict per rule | Stored in a hosted account, not files |
| [AGENTS.md](https://agents.md) | A vendor-neutral convention | No fields, so no scoping beyond nesting |
| Copilot instructions, Cursor rules, Claude Code rules | Glob-scoped files | Tied to one tool, editor context rather than review rules |
| [Open Context Standards](https://github.com/opencontextstandards/ocs) | A neutral `.context/` folder with globs | No categories, content conditions or review meaning |

## Roadmap

1. The spec for `.lore` and `.loreconfig`, with numbered conformance
   examples every implementation can test against
2. Editor support: a Prettier plugin, a language server, syntax
   highlighting
3. How Lore gets applied: from files and a diff to a verdict per rule,
   with a playground to try it
4. A first integration into an agent review pipeline
5. A team view for browsing and editing rules

The current design is in
[`docs/superpowers/specs/2026-10-25-lore-spec-design.md`](docs/superpowers/specs/2026-10-25-lore-spec-design.md).

## Contributing

It's early. Issues about the syntax, the scoping model or real rules that
don't fit it are the most useful thing right now.

## License

The specification text is licensed under
[CC-BY-4.0](LICENSE-CC-BY-4.0). Schemas, examples and code are licensed
under [MIT](LICENSE).
