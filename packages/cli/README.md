# lore

The `lore` command reads [Lore](https://github.com/m4ttstack/lore) rule files and tells a reviewer or an author which rules apply to a change. It never calls a forge, a model or the network. It runs git when an input needs it, and looks for `ast-grep` only for a selected `ast-grep` check.

The full reference, with every option, output format and exit code, is at [m4ttstack.github.io/lore/reference/cli](https://m4ttstack.github.io/lore/reference/cli).

## Install

Install it as a dev dependency, or run it without installing:

```
npm install --save-dev @mattstack/lore
npx @mattstack/lore check
```

It needs Node 20 or later, and `lore check` needs git 2.25 or later. Each [GitHub release](https://github.com/m4ttstack/lore/releases) also attaches the command as one file, `lore.js`, that runs on Node or Bun.

## Commands

`lore check` prints the rules your uncommitted work must follow. Name a commit, or `--base main` for the whole branch ([reference](https://m4ttstack.github.io/lore/reference/cli/check)):

```
lore check --base main
```

`lore select` prints the rules that apply to a diff, for a reviewer, with the verdict format to answer in ([reference](https://m4ttstack.github.io/lore/reference/cli/select)):

```
git diff main... | lore select --diff - --format json > selection.json
```

`lore verdicts` checks a reviewer's verdicts against that selection ([reference](https://m4ttstack.github.io/lore/reference/cli/verdicts)):

```
lore verdicts --selection selection.json verdicts.json
```

`lore audit` checks that each rule's `<source>` still exists and has not changed since it was last reviewed ([reference](https://m4ttstack.github.io/lore/reference/cli/audit)):

```
lore audit
```

`lore review` records that you compared a rule with its sources ([reference](https://m4ttstack.github.io/lore/reference/cli/review)):

```
lore review money-in-minor-units
```

## Build

```
bun install
bun run --filter @mattstack/lore build
```

This writes one file, `packages/cli/dist/lore.js`. Run it with Node 20 or later, or with Bun.
