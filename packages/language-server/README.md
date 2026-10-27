# @lore/language-server

A language server for Lore. It reports the parser's errors and warnings for every open `.lore` and `.loreconfig` file, named by registry name with the registry description, on the span the parser gives.

## Authoring help

- Completion: tags at column 0 and inside entries, attribute names per element, the categories in effect for the file (the fixed ones plus those a `.loreconfig` adds), `blocking` and `advisory`, `regex` and `ast-grep`, `<when>` keys, and known ids inside a `.loreconfig` `disable` list.
- Hover: the registry description of an error or warning under the cursor; a one-sentence text for each tag, attribute and `<when>` key; an entry's resolved scope on its opening tag.

## Which rules could apply

In any other file of a governed repository, a code lens on the first line lists the rules and context whose scope covers the file: `Lore: could apply: <id>, <id>`. Each id is its own lens, so editors show them side by side, and clicking one runs the server's `lore.openEntry` command, which asks the editor to open the entry's file at its opening tag. Disabled entries, and entries a `disable` list switches off for that path, are left out. `<when>` conditions depend on a change and are not evaluated, so the lens says "could apply". A file no entry covers gets no lens.

The client must send these other files to the server (a `{ scheme: "file" }` document selector); only their paths matter, so editing one does not trigger a refresh.

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

Diagnostics, and the state completion, hover and the lens read, re-run 150 ms after the last edit to a Lore file or after a file opens or closes.

## Settings

- `lore.externalFolders`: folders holding Lore for this repository, kept in another repository. Each entry is absolute or relative to the repository root. Each folder's enclosing repository is listed with git, and its marked directories are matched to this repository's remotes as the spec's External folders section describes.

## Rules repositories

A file at or below a directory marked by a `.loreconfig` with a `repo` key is checked as part of an external folder. When an open workspace folder is the repository the mark names, and lists the folder in `lore.externalFolders`, that repository is used, so problems that need its files show. Otherwise the marked directories are checked on their own. Files outside every marked directory are checked as that repository's own Lore.

## Limits

- A lone carriage return (one not followed by a line feed) stays inside its line, as the spec says, but editors treat it as a line break, so positions on later lines can be off.
- Without git, or outside a repository, only open buffers count: a `.loreconfig` on disk that is not open is not read, so its categories and `disable` lists are unknown until it is opened.
