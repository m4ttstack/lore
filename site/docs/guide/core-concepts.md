---
title: Core concepts
sidebar_position: 3
---

# Core concepts

These are the terms the rest of the docs use. Each gets a paragraph or two here, and a topic page with the detail.

## Rule

A rule is one thing your team expects every change to follow, written as a `<rule>` entry in a `.lore` file. Its prose says what the rule asks, in Markdown, completely on its own. Its id, category and severity identify it and say what breaking it costs.

When a rule is selected for a change, a reviewer answers it with `pass`, `fail` or `not-applicable`. See [Writing rules](./topics/writing-rules.md).

## Context

A context is background reading, written as a `<context>` entry. It points at a document, such as an architecture note, and says when that document is relevant. A context is selected the same way a rule is, but it gets no verdict. See [Context](./topics/context.md).

## Scope

A scope says which files an entry can be broken in, as a list of globs. A scope at the top of a file applies to every entry in it, and an entry can narrow it further. Globs resolve from the directory that holds the `.lore/` folder, so rules can live beside the code they govern. See [Scope](./topics/scope.md).

## Condition

A condition, in a `<when>` block, is a test on the change itself. It can look for text in added or removed lines, for text an edit removed without adding back, or for other files that did or did not change. An entry with conditions is selected only when all of them hold. See [Conditions](./topics/conditions.md).

## Check

A check, in a `<check>` block, is a search that points the reviewer at lines worth a look. Unlike a condition, it never decides whether its rule is selected. A line a check finds is a hint, never a verdict. See [Checks](./topics/checks.md).

## Source

A source, in a `<source>` block, names the document a rule was written from, such as a section of a review guide. `lore audit` then tells you when that text changes, so the rule can be reviewed against it again. See [Sources and reviews](./topics/sources-and-reviews.md).

## Lore folder

A Lore folder is a directory named `.lore/` that holds `.lore` files. It can sit anywhere in a repository, and there can be many. Rules can also live in another repository and be given to a tool as an external folder. See [Files and folders](./topics/files-and-folders.md) and [Shared rule repositories](./topics/shared-rules.md).

## `.loreconfig`

A `.loreconfig` file holds settings for its directory and everything below it, like a `.gitignore`. It can declare categories, switch rules off for part of a repository, and mark where lookup stops. See [Configuration](./topics/configuration.md).

## Selection

The selection is the set of entries that apply to a change: every rule and context whose scope covers a changed file and whose conditions hold. It is fully specified, so every conforming tool selects the same entries from the same files and change. See [How selection works](./topics/selection.md).

## Verdict

A verdict is a reviewer's answer for one selected rule: `pass`, `fail` with evidence, or `not-applicable` with a note. A verdict set answers every selected rule exactly once, so a rule nobody checked shows up as missing. See [How selection works](./topics/selection.md#verdicts).

## Next steps

- [Quick start](./quick-start.md): see a rule, a scope and a condition work on a real change.
- [Writing rules](./topics/writing-rules.md): the first topic, on what makes a good rule.
- [Format reference](../reference/format/rule.md): every element and key, looked up one at a time.
