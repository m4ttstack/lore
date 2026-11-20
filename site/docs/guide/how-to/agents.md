---
title: Run lore check from an agent
sidebar_position: 2
---

# Run lore check from an agent

This guide has a coding agent check its own changes against your rules after every edit.

1. **Install the command.** Add it as a dev dependency, so every checkout has the same version:

   ```sh
   npm install --save-dev @mattstack/lore
   ```

2. **Add one line to `AGENTS.md`**, or to whatever instructions file your agent reads:

   ```markdown
   After editing files, run `lore check` and fix any rule your change breaks.
   ```

3. **Choose `lore` or `npx`.** Plain `lore check` needs `lore` on the `PATH`. A dev dependency puts it there inside package scripts, but not in an ordinary shell. If your agent runs commands from a shell, write the line with `npx @mattstack/lore check` instead, which works anywhere.

4. **Check the output it reads.** `lore check` prints text even when its output is not a terminal, so the agent reads the same rules you would. Run it yourself once after an edit to see what the agent sees.

5. **Check a whole branch before handing it over.** For work spread across commits, tell the agent to run `lore check --base main` at the end. It covers committed and uncommitted work together.

## Without the command

An agent with no Lore tooling can still apply Lore, since `.lore` files are plain text. Paste [`spec/AGENT.md`](https://github.com/m4ttstack/lore/blob/main/spec/AGENT.md) into its instructions; it explains how to find the rules that apply to a change by reading the files. The [For agents](../../spec/for-agents-non-normative.md) page quotes it in full.

## Next steps

- [`lore check`](../../reference/cli/check.md): checking one commit or a branch.
- [Hand a reviewer the rules](./reviewer-handoff.md): the reviewer's side of the same rules.
- [Lore or a skill](./lore-or-a-skill.md): a skill can end by running `lore check` instead of restating rules.
