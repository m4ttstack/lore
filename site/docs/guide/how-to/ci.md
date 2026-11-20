---
title: Run Lore in CI
sidebar_position: 4
---

# Run Lore in CI

This guide adds a GitHub Actions job that prints the rules for each pull request, fails when a rule file is broken, and audits rule sources.

`lore check` lists rules; it does not judge whether a change breaks them. That is a reviewer's job (see [Hand a reviewer the rules](./reviewer-handoff.md)). In CI it gives every pull request a log of the rules that apply, and with `--strict` it fails when an error in the rules left an entry out.

1. **Add the workflow.** Create `.github/workflows/lore.yml`:

   ```yaml
   name: lore
   on: pull_request

   jobs:
     lore:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
           with:
             fetch-depth: 0
         - uses: actions/setup-node@v4
           with:
             node-version: 20
         - name: Rules for this change
           run: npx @mattstack/lore check --base origin/${{ github.base_ref }} --strict
         - name: Rule sources
           run: npx @mattstack/lore audit
   ```

   `fetch-depth: 0` fetches the history `--base` needs to find where the branch left its target.

2. **Judge by the target branch's rules.** To stop a pull request from loosening a rule in the same change that breaks it, read the rules from the target branch:

   ```yaml
         - name: Rules for this change
           run: npx @mattstack/lore check --base origin/${{ github.base_ref }} --rules-ref origin/${{ github.base_ref }} --strict
   ```

3. **Decide what fails the build.** `lore check --strict` exits 1 when an entry was excluded by an error. `lore audit` exits 1 for a finding at level `error`: by default a cited file or heading that no longer exists. Raise or lower findings with `--level`, or with the `audit` key of a [`.loreconfig`](../topics/configuration.md):

   ```yaml
         - name: Rule sources
           run: npx @mattstack/lore audit --level source-changed=error
   ```

4. **Pin the version.** Add `@mattstack/lore` as a dev dependency, so CI and every machine use the same release. Install it before the Lore steps, then call the local command:

   ```yaml
         - run: npm ci
         - name: Rules for this change
           run: npx lore check --base origin/${{ github.base_ref }} --rules-ref origin/${{ github.base_ref }} --strict
         - name: Rule sources
           run: npx lore audit
   ```

   Without the install, `npx lore` would fetch an unrelated package named `lore`. Without a dev dependency, keep `npx @mattstack/lore` and pin a version, such as `npx @mattstack/lore@0.6.1`.

The exit codes for every command are on [Exit codes](../../reference/cli/exit-codes.md).

## Next steps

- [Sources and reviews](../topics/sources-and-reviews.md): what `lore audit` reports, and how to clear it.
- [`lore check`](../../reference/cli/check.md): every option, including `--base` and `--rules-ref`.
- [Keep rules in a shared repository](./shared-repository.md): CI for a repo whose rules live elsewhere.
