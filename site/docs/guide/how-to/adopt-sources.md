---
title: Adopt sources file by file
sidebar_position: 5
---

# Adopt sources file by file

This guide adds `<source>` blocks to an existing rule set one Lore file at a time, without failing the build along the way. Requires lore 0.6.0 or later for every tool that reads the rules.

1. **Upgrade every tool first.** An older tool leaves out a rule with a `<source>`, and ignores a `.loreconfig` with an `audit` key. Upgrade the `lore` command in CI and on each machine, and any editor extension, before the first rule file uses either.

2. **Add sources to one Lore file.** Give each rule the document it came from, with a `heading` or `phrase` where the document has one:

   ```html
   <rule id="money-in-minor-units" category="functional_correctness">
     <source>
       file: docs/checkout-review.md
       heading: Money is integer minor units
     </source>
     Amounts are integers in minor units (cents).
   </rule>
   ```

3. **See what needs review.** Every new source starts `never-reviewed`, a warning, so `lore audit` still exits 0:

   ```text
   .lore/checkout.lore
     warn  never-reviewed  money-in-minor-units  docs/checkout-review.md#Money is integer minor units
   ```

4. **Review the file.** Read each rule against the text it cites. When they agree, record the whole file at once:

   ```sh
   npx @mattstack/lore review --file .lore/checkout.lore
   ```

   A source that does not resolve, such as a heading that was renamed, is refused and printed on stderr. Fix the `<source>`, then run the command again.

5. **Commit the lock file.** `lore audit` reads `lore-reviews.lock` only once git tracks it:

   ```sh
   git add lore-reviews.lock
   ```

6. **Repeat for the next file.** Once every file is done, consider raising `never-reviewed` to an error in your root `.loreconfig`, so new rules arrive with their review:

   ```yaml
   audit:
     levels:
       never-reviewed: error
   ```

## Next steps

- [Sources and reviews](../topics/sources-and-reviews.md): the review cycle after adoption.
- [`lore review`](../../reference/cli/review.md): naming rules by id, `--date` and `--prune`.
- [Run Lore in CI](./ci.md): run `lore audit` on every pull request.
