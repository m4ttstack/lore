---
title: Keep rules in a shared repository
sidebar_position: 6
---

# Keep rules in a shared repository

This guide moves rules into a repository of their own, so one set serves several repositories.

1. **Create the rules repository.** Put the rules under a folder such as `lore/`, with a `.loreconfig` that makes it a Lore root:

   ```yaml
   # team-rules/lore/.loreconfig
   root: true
   ```

2. **Map a folder onto each governed repository.** Add a folder per repository, with a `repo` key naming it:

   ```yaml
   # team-rules/lore/shop/.loreconfig
   repo: github.com/acme/shop
   ```

   Below `shop/`, directories mirror the shop repository. A `.lore/` folder directly under `shop/` resolves its globs from the shop's root.

3. **Commit the rules.** Only files git tracks in the rules repository are read.

4. **Run with the folder given.** From a clone of the shop, with the rules repository checked out beside it:

   ```sh
   npx @mattstack/lore check --given ../team-rules/lore
   ```

   The tool matches `repo: github.com/acme/shop` against the shop's git remotes and collects the rules below `shop/`.

5. **Check out the rules in CI.** CI has no sibling folder, so check the rules repository out inside the workspace, for example with `actions/checkout` and `path: team-rules`. The CI commands below give it as `--given team-rules/lore`.

6. **Name the remote in CI if needed.** If CI clones from a mirror whose URL does not match, pass the remote yourself:

   ```sh
   npx @mattstack/lore check --base origin/main --given team-rules/lore --remote github.com/acme/shop
   ```

7. **Judge by the target branch's own rules.** `--rules-ref` reads the governed repo's own Lore files at a git ref, so a change cannot loosen one of them in the same commit that breaks it:

   ```sh
   npx @mattstack/lore check --base origin/main --rules-ref origin/main --given team-rules/lore
   ```

   It does not apply to the given folder, which is read from its own checkout. The next step pins that.

8. **Pin the rules version.** Check out the rules repository at a tag or commit in CI, so a change to the shared rules reaches each repository when its team chooses.

## Next steps

- [Shared rule repositories](../topics/shared-rules.md): how matching, loose folders and ids work.
- [`--given`, `--remote` and `--rules-ref`](../../reference/cli/options.md#rules): the options in full.
- [External folders](../../spec/external-folders.md) in the specification.
