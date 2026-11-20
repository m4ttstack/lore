---
title: Checks
sidebar_position: 5
---

# Checks

A check is a search that points a reviewer at lines worth a look. It never decides whether its rule is selected, and a line it finds is a hint, never a verdict.

```html
<rule id="money-in-minor-units" category="functional_correctness">
  <check>
    parseFloat\(|toFixed\(
  </check>
  Amounts are integers in minor units (cents). Floating point never touches
  money.
</rule>
```

When this rule is selected, each added line matching the pattern is flagged for the reviewer.

## Checks or conditions

An added-line condition already flags the lines it finds. So reach for a check only when:

- the search should not decide whether the rule applies, as when the rule matters for every change in its scope but some lines deserve a closer look;
- a condition cannot express the search, as with an `ast-grep` pattern that matches code by its structure.

```html
<rule id="tenant-scoped-queries" category="security" severity="blocking">
  <scope>
    files: ["server/**/*.ts"]
  </scope>
  <check lang="ast-grep">
    db.$MODEL.findMany($$$)
  </check>
  Every query on customer data filters by `tenantId`. A query without it can
  return another customer's records.
</rule>
```

Every change under `server/` selects this rule. The check points at each `findMany` call, where a missing `tenantId` would hide.

## Languages

A check without `lang` is a `regex` check: one pattern in Lore's [regex dialect](../../spec/regex-dialect.md), searched for in each added line. `lang="ast-grep"` holds an [ast-grep](https://ast-grep.github.io/) pattern, which may span lines.

The `lore` command runs `regex` checks. It does not run `ast-grep` checks yet: it skips them with a warning, and their rules stay selected.

## Edge cases

### Tags on their own lines

`<check>` and `</check>` each go on a line of their own. A line such as `<check>foo</check>` is not read as a tag at all, so the check would be prose.

### A two-line regex

A `regex` body must be one line. Two or more lines is `regex-not-one-line`, and the rule is left out.

### No hits

No hits does not mean the rule passed. The reviewer still reads the change against the rule's prose.

### A language no tool knows

A `lang` the specification does not define is kept as written. A tool skips that check with the warning `unsupported-check-language`, and the rule stays selected.

## Next steps

- [Conditions](./conditions.md): searches that also decide whether a rule is selected.
- [`<check>` reference](../../reference/format/check.md): the `lang` attribute and the body.
- [Checks](../../spec/checks.md) in the specification.
