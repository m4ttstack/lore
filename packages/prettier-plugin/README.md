# @lore/prettier-plugin

A Prettier 3 plugin that formats `.lore` files.

## Build

Prettier runs under Node, which cannot load the TypeScript sources, so build the plugin first:

```sh
bun install
bun run build
```

`build` bundles `src/` and `@lore/parser` with esbuild into `dist/index.js`, an ES module for Node 20 or later. Prettier itself is a peer dependency and is not bundled.

## Use

Point Prettier at the built plugin, for example in `.prettierrc`:

```json
{
  "plugins": ["./packages/prettier-plugin/dist/index.js"]
}
```

Prettier then formats every `.lore` file with the `lore` parser.

## What it changes

- Children, YAML and prose sit one level inside each top-level element: two spaces, or one tab with `useTabs`.
- Top-level tags stay at column 0, with one blank line between top-level elements.
- Attributes are written in the order `id`, `category`, `severity`, `src`, `lang`, `disabled`.
- YAML blocks go through Prettier's YAML printer.
- Prose up to its first blank line outside a fenced code block holds the summary and is only re-indented. The rest goes through Prettier's Markdown printer with `proseWrap: "preserve"`.
- `<check>` bodies and top-level comments are kept as written.
- A file with a file-level error is returned unchanged, and an entry with an entry-level error is left as written.

The formatter sees one file, not its `.loreconfig`, so it accepts any category name when it decides whether a file or entry has an error.
