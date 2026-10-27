# Lore for VS Code and Cursor

One extension serves both editors. It highlights `.lore` files, with YAML and Markdown highlighting inside their blocks, gives `.loreconfig` files YAML highlighting, and starts the Lore language server for:

- Diagnostics: every error and warning the parser reports for an open `.lore` or `.loreconfig` file, named by registry name with the registry description.
- Completion: tags, attributes, categories, severities, check languages, `<when>` keys and known ids in `disable` lists.
- Hover: what an error, warning, tag, attribute or `<when>` key means, and an entry's resolved scope.
- A "could apply" lens at the top of any other file in a governed repository, listing the rules and context whose scope covers it.

## Build and install

The extension is not published. Build the `.vsix` from the repository root:

```sh
bun install
bun run --filter lore-vscode package
```

This writes `packages/vscode/dist/lore-vscode.vsix`, with the language server bundled inside.

Install it by hand:

- VS Code: run **Extensions: Install from VSIX...** from the Command Palette and pick the file, or run `code --install-extension packages/vscode/dist/lore-vscode.vsix`.
- Cursor: run **Extensions: Install from VSIX...** from the Command Palette, or drag the file onto the Extensions view, or run `cursor --install-extension packages/vscode/dist/lore-vscode.vsix`.

Reload the window after installing a new build.

## Which files the editor sees

Review-time tools follow the spec's collection rule: tracked files only, as the change leaves them. The editor is an authoring aid, so it is more relaxed: the language server counts tracked files plus untracked files git does not ignore, and reads open buffers over the files on disk. A new or unsaved `.lore` or `.loreconfig` file therefore takes effect at once. Diagnostics, completion and the lens all use this relaxed list, so the editor can show results a review would not yet see.

## Settings

- `lore.externalFolders`: folders holding Lore for this repository, kept in another repository. Each entry is absolute or relative to the repository root. Changes reach the server without a reload.

## Workspace trust

The language server runs git in the opened folder, so it starts only once the workspace is trusted. In Restricted Mode you get highlighting only.

## Limits

- The extension loads in every workspace once the editor has started, but starts the language server only when the workspace contains a `.lore` or `.loreconfig` file (outside `node_modules`), when `lore.externalFolders` is set, or when a Lore file is opened. Setting `lore.externalFolders` later starts it without a reload.
- A lone carriage return (one not followed by a line feed) stays inside its line, as the spec says, but editors treat it as a line break, so positions on later lines can be off.
- Without git, or outside a repository, only open buffers count: a `.loreconfig` on disk that is not open is not read, so its categories and `disable` lists are unknown until it is opened.
- The lens shows one lens per id, so VS Code joins them with ` | `: `Lore: could apply: a | b`. Clicking an id opens its entry.
