# @lore/parser

The reference parser for Lore. It reads `.lore` and `.loreconfig` files into the spec's document model and selects the entries a change makes eligible. It passes every conformance example in `spec/SPEC.md`.

The package is TypeScript source with one runtime dependency, `yaml`. Bun runs it directly; Node consumers bundle it, as the Prettier plugin and the language server do.

## Input

Every call that reads a repository takes a `LoreInput`:

```ts
interface LoreInput {
  repo: InputFile[];     // the governed repository's files, paths relative to its root
  given: GivenFolder[];  // external folders holding Lore for this repository
  remotes: string[];     // the governed repository's remote URLs, matched against each `repo` key
}
interface InputFile { path: string; content: string }
interface GivenFolder { folder: string; files: InputFile[]; repository?: string }
```

Paths use forward slashes. `parse` needs the content of the `.lore` and `.loreconfig` files; other files count for their paths, and `select` also searches changed files' content with `<check>` patterns.

A `GivenFolder` names a folder inside a repository: `folder` is its path from that repository's root, and `files` lists that whole repository. `repository` is an optional key for that repository: folders with the same key are one repository. Without keys on both, two folders are one repository when their file lists are equal.

## API

- `parse(input: LoreInput): DocumentModel`: collects the Lore files and returns `{ entries, errors, warnings }`, the spec's document model. Selection warnings such as `missing-src-target` are not included.
- `parseFile(path: string, content: string): LoreFile`: reads one file's structure (top-level nodes and structure diagnostics) without collecting a repository.
- `collect(input: LoreInput): Collected`: the collection step on its own: which files are Lore files, their bases, categories and trees, and the `.loreconfig` files that apply.
- `select(input: LoreInput, change: Change, options?: SelectOptions): Promise<EligibilityResult>`: the entries the change makes eligible, check hits, the entries excluded by errors, and warnings, including `missing-src-target`.
- `coveringEntries(input: LoreInput, model: DocumentModel, path: string): Entry[]`: the enabled entries whose scope covers `path`, leaving out those a `disable` list switches off for it. `<when>` is not evaluated. Pass the `model` that `parse(input)` returned.
- `missingSrcTargets(input: LoreInput, model: DocumentModel): Diagnostic[]`: the `missing-src-target` warnings with no change, for callers that know the governed repository's files.

### SelectOptions

```ts
interface SelectOptions { capabilities?: ("regex" | "ast-grep")[]; astGrepBinary?: string | null }
```

`capabilities` turns on `<check>` evaluation per language; without one, checks in that language report `unsupported-check-language`. `astGrepBinary` says where `ast-grep` comes from for `<check lang="ast-grep">`:

- `undefined` (the default): `ast-grep` on `PATH`.
- a string: the path of the binary to run.
- `null`: no binary, so ast-grep checks report `unsupported-check-language`.

A binary that does not report version `0.51.0` counts as missing.

### Errors

`select` rejects with `RegexLimitError` when a regular expression in an entry that could be eligible goes past the engine's limits (groups nested more than 1,000 deep, or a pattern the engine cannot compile). Every pattern compiles before selection starts, so the same input fails every run. Other problems in the input are diagnostics, not exceptions.
