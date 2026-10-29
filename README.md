# Lore

**Portable domain rules for code review.**

Lore is an open file format for the rules a team expects every change to
follow: the domain knowledge that a linter can't check and a new
contributor can't guess. Rules live in plain files next to your code.
Each rule declares where it applies, so any tool, and any reviewer, human
or AI, can work out exactly which rules matter for a given change.

> [!NOTE]
> Lore is an early-stage proposal. The syntax and the name may change
> before a first stable version. A reference command-line tool is
> available as a preview ([Try it](#try-it)). Feedback is very welcome;
> see [Participate](#participate).

```html
<scope>
  files: ["src/checkout/**/*.{ts,tsx}"]
</scope>

<rule id="price-from-quote" category="functional_correctness" severity="blocking">
  A displayed price must come from the quote that produced it.

  Recomputing a price from its inputs drops quote-level discounts, so the
  customer sees one total and is charged another.
</rule>

<rule id="money-in-minor-units" category="functional_correctness">
  <when>
    addedContains: ["parseFloat(", "toFixed("]
  </when>
  Amounts are integers in minor units (cents). Floating point never touches
  money.
</rule>
```

## Why Lore

Every codebase has rules that matter more than formatting: how money is
rounded, which queries must be scoped to a tenant, which files must change
together. Today those rules live in wiki pages, review checklists, long
`AGENTS.md` files, or only in senior engineers' heads.

That works poorly at scale:

- **Reviewers can't tell which rules apply.** A 300-line guide is either
  read in full for every change or skimmed and missed.
- **Rules are hard to maintain.** Adding, changing or retiring one rule
  means editing a long document and hoping nothing else depended on it.
- **Every tool wants its own format.** Each AI coding and review tool has a
  different instructions file, and none of them say which rules a review
  actually checked.

Lore gives each rule just enough structure to be selected by a machine,
while keeping the rule itself in plain prose for people and models to
apply.

## Design principles

1. **Plain files, versioned with the code.** Rules are reviewed, blamed and
   reverted like any other change. No service or account is required.
2. **Selected, not skimmed.** A rule's scope and conditions are evaluated
   by code against a diff. Given the same files and the same change, every
   conforming tool selects the same rules.
3. **Prose is the rule.** Structure only decides *when* a rule applies. What
   the rule *says* is always written out in Markdown, complete on its own.
4. **Readable without tooling.** A person or an AI agent who has never
   heard of Lore can open a `.lore` file and apply it correctly.
5. **Tool-neutral.** Lore is a specification with a conformance suite, not
   a product. Editors, review bots, CI and AI agents can all implement it.

## A quick tour

### Files and folders

Rules live in `.lore` files inside a `.lore/` folder. A folder can sit
anywhere in a repository, and its globs resolve relative to the directory
that contains it, so a set of rules can live beside the code it governs.

```
.lore/
  security.lore          rules for the whole repo
services/billing/
  .lore/
    invoices.lore        globs resolve from services/billing/
  src/
```

A `.lore` file is a sequence of tagged sections. Structured parts are YAML
(JSON works too); the rule text is Markdown. Indenting inside a section is
optional: tools strip it, so use whatever reads best.

### Scope

A `<scope>` at the top of a file applies to every rule in it. A rule can
narrow that scope, never widen it.

```html
<scope>
  files: ["src/components/**/*.tsx"]
  ignores: ["**/*.stories.tsx"]
</scope>

<rule id="icon-buttons-have-labels" category="accessibility">
  <when>
    addedContains: ["<IconButton"]
  </when>
  Every `IconButton` has an `aria-label` that names the action, not the
  icon: "Delete invoice", not "Trash".
</rule>
```

### Conditions

`<when>` adds conditions on the change itself: text in added lines
(`addedContains`, `addedMatches`), or other files that did or didn't
change (`changed`, `unchanged`). A rule applies only when its scope matches
a changed file and all of its conditions hold. The added lines that
`addedContains` or `addedMatches` find are also pointed out to the
reviewer, so one condition both selects the rule and shows where to look.

```html
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

### Checks

A `<check>` is a deterministic search that points a reviewer at specific
lines without deciding whether the rule applies. It is a hint, never a
verdict: the reviewer still decides whether the rule is broken. Checks are
regular expressions or [ast-grep](https://ast-grep.github.io/) patterns,
which can match code by its structure rather than its text. Lore never
runs shell commands.

```html
<rule id="tenant-scoped-queries" category="security" severity="blocking">
  <scope>
    files: ["server/**/*.ts"]
  </scope>
  <check lang="ast-grep">
    db.$MODEL.findMany($$$)
  </check>
  Every query on customer data filters by `tenantId`. A query without it can
  return another customer's records.
</rule>
```

### Context

Not everything is a rule. A `<context>` entry points at background reading,
such as an architecture document, and tells the reviewer when it is
relevant. Context uses the same scope and conditions as rules, but is never
pass or fail.

```html
<context id="billing-architecture" src="docs/billing.md">
  Read before reviewing changes to how invoices are calculated.
</context>
```

### Configuration

An optional `.loreconfig` file applies to its directory and everything
below it, like `.gitignore`. It can add custom categories, switch off rules
for part of a repository, and mark where configuration lookup stops.

```yaml
lore: 1
categories: [data_retention]
disable: [icon-buttons-have-labels]
```

Rules don't have to live in the repository they govern. A team or an
organization can keep shared rules in their own repository and map them
onto another with a `repo` key.

Rules are read at a revision of their own. A tool can judge a change by
the rules on the branch it merges into, so a change can't relax a rule
in the same commit that breaks it.

## How tools use Lore

Given a change, a tool:

1. collects the `.lore` files from the repository and from any shared
   rule folders;
2. selects every rule whose scope matches a changed file and whose
   conditions hold;
3. flags lines worth a closer look, from the selected rules' conditions
   and checks;
4. hands the selected rules, flagged lines and context to a reviewer;
5. collects one verdict per selected rule, and checks that none is
   missing.

Selection is fully specified, so it is the same in every tool. The
reviewer answers each selected rule with `pass`, `fail` or
`not-applicable`. A `fail` names the line that breaks the rule, and any
answer other than `pass` says why:

```json
{
  "lore": "1",
  "verdicts": [
    {
      "rule": "price-from-quote",
      "verdict": "fail",
      "evidence": [{ "file": "src/checkout/CartTotal.tsx", "line": 42 }],
      "note": "The total is rebuilt from line items, not the quote."
    },
    { "rule": "money-in-minor-units", "verdict": "pass" },
    { "rule": "tenant-scoped-queries", "verdict": "pass" },
    {
      "rule": "migration-with-schema",
      "verdict": "not-applicable",
      "note": "The change adds no migration."
    }
  ]
}
```

Because every selected rule must be answered exactly once, a tool can
tell a rule that passed from a rule nobody checked. How the results are
shown is up to the tool. A review bot might show something like this:

```
4 Lore rules apply to this change

  ✗ price-from-quote          src/checkout/CartTotal.tsx:42
                              total is rebuilt from line items, not the quote
  ✓ money-in-minor-units
  ✓ tenant-scoped-queries
  - migration-with-schema     not applicable
```

## Try it

The reference `lore` command implements selection, change checking and
verdict checking. It is on npm as `@mattstack/lore` and runs on Node 20 or
later.

From a repository with `.lore` files, check your uncommitted work against
the rules. The command lists the rules that apply to the change and flags
the lines worth a look, so you can fix anything the change breaks:

```
npx @mattstack/lore check
```

It prints text even when its output is not a terminal, so an agent reads
the same thing; add `--format json` for the selection as JSON.

To check one commit instead, name it: `npx @mattstack/lore check HEAD`. To check
a whole branch, committed and uncommitted work together, compare it against
the commit where the branch left `main`: `npx @mattstack/lore check --base main`.

To have an agent do this after every edit, add a line to `AGENTS.md`:

```markdown
After editing files, run `lore check` and fix any rule your change breaks.
```

Plain `lore check` needs `lore` on the `PATH`; adding `@mattstack/lore` as a
dev dependency puts it there inside package scripts. `npx @mattstack/lore check`
works from any shell, so write that in the line if the agent runs it outside
package scripts.

To hand a reviewer the rules that apply to your branch, print them ready to
paste into a prompt:

```
git diff main... | npx @mattstack/lore select --diff - --format text
```

Save the selection as JSON, then check a reviewer's verdicts against it:

```
git diff main... | npx @mattstack/lore select --diff - --format json > selection.json
npx @mattstack/lore verdicts --selection selection.json verdicts.json
```

The command is also one JavaScript file, attached to each GitHub release,
that runs on Node 20 or later or on Bun:

```
curl -LO https://github.com/m4ttstack/lore/releases/download/cli-v0.2.0/lore.js
node lore.js check
```

`lore verdicts` exits 0 when every selected rule has exactly one valid
verdict, and lists the problems otherwise. The command never calls a
model, a code host or the network; git is the only program it runs. The
[CLI README](packages/cli/README.md) covers every flag, including shared
rule folders and reading rules at a git ref.

## Where Lore fits

| | Linters and static analysis | Agent instruction files (`AGENTS.md` and similar) | Lore |
|---|---|---|---|
| Best for | Rules a machine can decide | General conventions and setup | Domain rules that need judgment |
| Applied | Mechanically, to every file | Loaded whole into context | Selected per change |
| Result | Pass or fail | None recorded | A result per rule, by id |

Lore complements these tools rather than replacing them. If a rule can be
a lint rule, it should be one.

### Lore or a skill?

A skill, such as a Claude Code or Codex skill, packages a procedure an
agent follows for one kind of task. A Lore file holds the rules a
finished change must satisfy. Many instructions written in skills today
are rules, and work better as Lore.

| | Lore rule | Skill |
|---|---|---|
| Describes | What a finished change must satisfy | How to carry out a kind of task |
| Selected | By a tool, from the files a change touches | By the agent, from the task it was given |
| Used by | Authors and reviewers | The agent doing the task |
| Result | A verdict per rule | The work itself |
| Example | Amounts are integers in minor units. | To remove a feature flag, delete its reads, then its definition, then the flag itself. |

To decide where an instruction belongs, ask whether a reviewer who sees
only the finished change could tell whether it was followed. If they
could, it is a Lore rule. If it is a step, an order of steps, or a
check-in with a person, it belongs in a skill.

The two work together. A skill keeps only its steps, and can end by
running `lore check` on the change instead of restating rules that Lore
already holds.

## Specification

The specification is [`spec/SPEC.md`](spec/SPEC.md). It is written in the
style of the [CommonMark spec](https://spec.commonmark.org/): normative
text with numbered conformance examples that any implementation can run,
plus JSON Schemas for every structured block and for the expected output.

[`spec/AGENT.md`](spec/AGENT.md) holds short instructions for agents with
no Lore tooling. Paste it into `AGENTS.md` or your agent's instruction
file.

### Roadmap

1. **Specification** for `.lore` and `.loreconfig`, with conformance
   examples and schemas.
2. **Editor support:** done: reference parser, Prettier plugin, language
   server, VS Code/Cursor and Zed extensions (not yet published).
3. **Applying rules:** in progress. The `lore` command (`select`, `check`
   and `verdicts`) is on npm as `@mattstack/lore`, a preview. Next: the
   verdict format as a normative part of the specification, and more ways
   to describe a change, such as a list of paths or two git refs.
4. **Integrations** with code review tools and AI agents. A first
   integration with an AI review pipeline is in trial.
5. **More implementations:** a second conforming implementation in Rust,
   standalone binaries, and an online playground. The other packages go to
   npm once the format's name is final.

### Editor support

The repository holds a [reference parser](packages/parser/README.md), a [Prettier
plugin](packages/prettier-plugin/README.md), a language server, and
extensions for [VS Code and Cursor](packages/vscode/README.md) and
[Zed](packages/zed/README.md). None are published yet, so install them from
a checkout using each README.

On GitHub and GitLab, this line in `.gitattributes` highlights `.lore` files
as Markdown:

```
*.lore linguist-language=Markdown gitlab-language=markdown
```

## Prior art

Lore builds on ideas from several projects:

- [Aviator invariants](https://docs.aviator.co/verify/concepts/invariants):
  categorized, conditioned rules applied to every matching change.
- [AGENTS.md](https://agents.md): a shared, vendor-neutral home for agent
  instructions.
- [EditorConfig](https://editorconfig.org/) and
  [ESLint](https://eslint.org/): directory-scoped configuration and
  per-path rules.
- [CommonMark](https://commonmark.org/): a specification tested by its own
  examples.
- Copilot instructions, Cursor rules and Claude Code rules: glob-scoped
  guidance for AI tools.

## Participate

Lore is at the stage where outside input shapes it most. Useful
contributions right now:

- Rules from your own codebase that Lore can't express well.
- Problems with the scoping model or the syntax.
- Interest in implementing Lore in an editor, review tool or agent.

Open an [issue](https://github.com/m4ttstack/lore/issues) to start a
conversation.

## License

The specification text is licensed under
[CC-BY-4.0](LICENSE-CC-BY-4.0). Schemas, examples and code are licensed
under the [MIT License](LICENSE). The agent instructions in
[`spec/AGENT.md`](spec/AGENT.md) are dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), so they can
be pasted anywhere without a notice.
