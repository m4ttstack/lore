---
title: <meta>
sidebar_position: 8
---

# `<meta>`

`<meta>` holds what a team wants to record about an entry: an owner, a ticket, links. It is a child of a rule or a context.

```html
<rule id="tenant-scoped-queries" category="security" severity="blocking">
  <meta>
    owner: platform-team
    added: 2026-03-01
    links: ["https://wiki.example.com/tenancy"]
  </meta>
  Every query on a tenant table filters by the current tenant.
</rule>
```

The block is YAML (or JSON), and its value must be a mapping. It takes no attributes, and an entry has at most one.

## Keys

`<meta>` is free-form: the specification gives no key a meaning, and tools may define their own. Its keys and values never change whether an entry is selected.

The mapping is kept as parsed in the document model. The `lore` command passes a rule's `meta` to the reviewer in the selection; a context's `meta` is not included. Under YAML's core schema, `2026-03-01` stays a string, not a date.

A `source` key in `<meta>` is free-form too. To cite the files a rule came from in a way tools can audit, use [`<source>`](./source.md); `lore audit --level meta-source=warn` lists the rules that still carry a `source` key and no `<source>` block.

## Errors

A value that is not a mapping, such as a scalar, a list or `null`, is `invalid-meta`, which excludes the entry.

## Specification

- [Children](../../spec/rules.md#children)
- [`meta.schema.json`](../../spec/schemas/meta.md)
