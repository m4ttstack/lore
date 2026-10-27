# @lore/language-server

A language server for Lore. It reports the parser's errors and warnings for every open `.lore` and `.loreconfig` file, named by registry name with the registry description, on the span the parser gives.

## Build and run

Editors run the server under Node 20 or later, which cannot load the TypeScript sources, so build it first:

```sh
bun install
bun run build
```

`build` bundles `src/` and `@lore/parser` with esbuild into `dist/server.js`, with `spec/errors.json` inlined. Start it over stdio:

```sh
node packages/language-server/bin/lore-language-server.js --stdio
```

## Which files it sees

The server counts the files git tracks plus untracked files git does not ignore, and reads open buffers over the files on disk. A new or unsaved `.lore` or `.loreconfig` file takes effect at once. Review-time tools collect tracked files only.

Diagnostics re-run 150 ms after the last edit.

## Settings

- `lore.externalFolders`: folders holding Lore for this repository, kept in another repository. Each entry is absolute or relative to the repository root. Each folder's enclosing repository is listed with git, and its marked directories are matched to this repository's remotes as the spec's External folders section describes.

## Rules repositories

A file at or below a directory marked by a `.loreconfig` with a `repo` key is checked as part of an external folder. When an open workspace folder is the repository the mark names, and lists the folder in `lore.externalFolders`, that repository is used, so problems that need its files show. Otherwise the marked directories are checked on their own. Files outside every marked directory are checked as that repository's own Lore.

## Limits

- A lone carriage return (one not followed by a line feed) stays inside its line, as the spec says, but editors treat it as a line break, so positions on later lines can be off.
- Without git, or outside a repository, only open buffers count: a `.loreconfig` on disk that is not open is not read, so its categories and `disable` lists are unknown until it is opened.
