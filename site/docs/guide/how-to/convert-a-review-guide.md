---
title: Convert a review guide
sidebar_position: 1
---

# Convert a review guide

This guide turns an existing review checklist, style guide or `AGENTS.md` section into Lore rules. The work is mostly judgment, so it suits an AI agent with the `writing-lore` skill, checked by you.

1. **Give your agent the skill.** Copy [`skills/writing-lore/`](https://github.com/m4ttstack/lore/tree/main/skills/writing-lore) from the Lore repository into your project's `.claude/skills/`, or into `~/.claude/skills/` for every project. Other agents can read [`SKILL.md`](https://github.com/m4ttstack/lore/blob/main/skills/writing-lore/SKILL.md) directly.

2. **Point it at the guide.** Ask the agent to convert one document, such as `docs/checkout-review.md`. The skill covers which instructions belong in Lore, which belong in a lint rule or a skill, and how to choose when each rule applies.

3. **Keep the source.** Save a copy of the guide as converted beside the rules, such as `docs/converted/checkout-review.md`, and ask for a [`<source>`](../topics/sources-and-reviews.md) on each rule naming its section in that copy. The original loses those sections in step 6, and a source pointing at a removed section fails `lore audit` with `source-missing`.

4. **Check the rules parse.** Run `npx @mattstack/lore check` on any change. Excluded entries print on stderr with an error name, such as `unknown-category`; fix each one.

5. **Try them on real changes.** Run `npx @mattstack/lore check <commit>` on a few past commits the guide was written for. A rule that never shows up on a change it should catch has a scope or condition that is too narrow.

6. **Cut the prose.** Remove the converted sections from the original guide, or replace them with a pointer to the Lore files, so the rules live in one place.

## Next steps

- [Writing rules](../topics/writing-rules.md): what makes a rule clear on its own.
- [Lore or a skill](./lore-or-a-skill.md): deciding where an instruction belongs.
- [Run lore check from an agent](./agents.md): have the agent check its own changes against the new rules.
