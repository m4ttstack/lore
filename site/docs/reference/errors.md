---
title: Errors and warnings
sidebar_position: 3
---

# Errors and warnings

Every problem a Lore tool reports has a name, such as `unknown-element` or `invalid-yaml`. An error excludes what it is found in: a file, an entry or a `.loreconfig`. A warning excludes nothing.

The full list, with a description and an anchor for each name, is [Errors and warnings](../spec/errors-and-warnings.md) in the specification. It is generated from `spec/errors.json`, so it always matches the tools. Which errors exclude a file and which exclude one entry is in [Error reach](../spec/error-reach.md).

The `lore` command prints excluded entries on stderr, one line each:

```text
lore: excluded unknown-category in .lore/checkout.lore line 24 (entry dates-from-locale)
```

In JSON output the same problems are in `excluded` and `warnings`. With [`--strict`](./cli/options.md#strict), an excluded entry makes the command exit 1.

`lore audit` findings, such as `source-changed`, are a separate list: see [`lore audit`](./cli/audit.md#findings). So are the problems `lore verdicts` reports: see [Output formats](./cli/output.md#verdict-set).
