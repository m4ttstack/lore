# Lore for Zed

A Zed extension for `.lore` files: highlighting from the tree-sitter grammar
in `packages/tree-sitter-lore` (YAML inside `<defaults>`, `<scope>`, `<when>`
and `<meta>`, Markdown in prose), and diagnostics, completion and hover from
the Lore language server.

The server attaches only to Lore and YAML buffers in Zed, so source files do
not get the could-apply lens that VS Code shows, and whether Zed displays the
server's code lenses at all is untested.

It is not published. Install it from this repository as a dev extension.

## Before you start

- Rust installed through rustup. Zed compiles dev extensions with it.
- Bun, and Node 20 or later (the language server is a Node program).
- From the repository root, run `bun install` once.

## Put the language server on PATH

Build the server, then link its bin into a folder on your PATH:

```sh
bun run --filter @lore/language-server build
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/language-server/bin/lore-language-server.js" ~/.local/bin/lore-language-server
command -v lore-language-server
```

Zed looks the server up on the PATH of the project's shell environment, so
the folder must be on PATH in your login shell, not only in one terminal.

To skip PATH, point Zed at the bin in your Zed settings instead:

```json
{
  "lsp": {
    "lore-language-server": {
      "binary": {
        "path": "/absolute/path/to/lore/packages/language-server/bin/lore-language-server.js"
      }
    }
  }
}
```

Rebuild the server after pulling changes to it. The link keeps working.

## Install the extension

1. From the repository root, run `bun scripts/zed-grammar-rev.ts`. It
   writes `packages/zed/extension.toml` (gitignored) from
   `extension.toml.in`, pointing the grammar at this checkout and at the
   last commit that touched `packages/tree-sitter-lore`.
2. In Zed, open the command palette and run `zed: install dev extension`.
   Choose the `packages/zed` folder.
3. Open `test/fixtures/` (or any folder with `.lore` files) in Zed.

Zed builds the grammar from that commit, not from your working tree. After
changing the grammar, commit it, run `bun scripts/zed-grammar-rev.ts` again,
and click Rebuild on the Lore entry in Zed's Extensions page.

## Check it works

- `test/fixtures/readme-1.lore`: tag names, attribute names and quoted
  values are colored; the `files:` line inside `<scope>` and the
  `addedMatches:` line inside `<when>` highlight as YAML; prose renders with
  Markdown highlighting (the backticks in `readme-2.lore` and later files).
- `test/fixtures/example-9-1.lore`: the language server reports
  `unknown-element` on line 5 (`<notes>`).
- The status bar's language server menu lists `lore-language-server` as
  running. If it is missing, run `zed: open log` and look for the
  `lore-language-server is not on PATH` message.

## Settings

The server reads the `lore` section of Zed's settings for it. To use Lore
kept in another repository (external folders), list the folders, each
absolute or relative to the repository root:

```json
{
  "lsp": {
    "lore-language-server": {
      "settings": {
        "lore": {
          "externalFolders": ["/path/to/shared-rules"]
        }
      }
    }
  }
}
```

## `.loreconfig` files

The extension also starts the language server for YAML files, so
`.loreconfig` gets diagnostics. Zed does not treat `.loreconfig` as YAML on
its own; add this to your Zed settings:

```json
{
  "file_types": {
    "YAML": [".loreconfig"]
  }
}
```

To keep the server away from YAML files entirely:

```json
{
  "languages": {
    "YAML": {
      "language_servers": ["!lore-language-server", "..."]
    }
  }
}
```

## Building without Zed

`cargo build --target wasm32-wasip1` in this folder compiles the extension
(add the target once with `rustup target add wasm32-wasip1`).
