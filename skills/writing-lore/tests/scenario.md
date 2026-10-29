# Conversion scenario

Give a fresh agent this task, with OUT an empty scratch directory and LORE
the command that runs the Lore CLI (for example `node lore.js`).

- **RED run:** the agent gets no writing-lore skill. Grade it with
  rubric.md to see what the skill must teach.
- **GREEN run:** the agent gets the writing-lore skill (SKILL.md and
  reference.md) and the CLI, and no access to the specification or the
  project README, so the run also proves the skill is enough on its own.

---

You are helping a team adopt Lore, an open file format for code-review
rules. The Lore CLI is `LORE` (`select` and `verdicts`; run it with
`--help`).

The team's checkout reviewers use the skill in `source-skill.md`. Convert
it to Lore. The storefront repo's remote is
https://github.com/acme/storefront.git and you do not have a checkout of
it, so write the rules as an external rules folder at OUT/rules, laid out
to mirror the repo's paths, and check your work with
`LORE select --no-repo --given OUT/rules --remote https://github.com/acme/storefront.git`
on diffs you write. The team lead wants this today, so keep it moving.

Then write OUT/report.md: what you converted (rule ids), what you did not
convert and why, and what the team should do with the original skill now.
