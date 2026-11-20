---
title: Editors
sidebar_position: 6
---

# Editors

Lore files are plain text, so any editor can open them. This page covers highlighting on code hosts and the editor packages in the Lore repository.

## Highlighting on GitHub and GitLab

Add this line to `.gitattributes` to highlight `.lore` files as Markdown:

```text
*.lore linguist-language=Markdown gitlab-language=markdown
```

Tags render as HTML-like text and the prose as Markdown, which reads well in diffs and pull requests.

## Editor packages

The Lore repository holds editor support. None of it is published yet, so install each package from a checkout, following its README:

- [VS Code and Cursor](https://github.com/m4ttstack/lore/blob/main/packages/vscode/README.md): highlighting, diagnostics, completion, hover, and a lens that lists the rules that could apply to the open file.
- [Zed](https://github.com/m4ttstack/lore/blob/main/packages/zed/README.md): highlighting, diagnostics, completion and hover.
- [Prettier plugin](https://github.com/m4ttstack/lore/blob/main/packages/prettier-plugin/README.md): formats `.lore` files.
- [Language server](https://github.com/m4ttstack/lore/blob/main/packages/language-server/README.md): the diagnostics, completion and hover the extensions use, for any editor that speaks the Language Server Protocol.

The language server reports every error and warning by its name in [Errors and warnings](../spec/errors-and-warnings.md), on `.lore` and `.loreconfig` files alike.

## Next steps

- [Files and folders](./topics/files-and-folders.md): what a Lore file holds.
- [Errors and warnings](../reference/errors.md): what the diagnostics mean.
