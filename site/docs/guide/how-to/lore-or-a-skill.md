---
title: Lore or a skill
sidebar_position: 7
---

# Lore or a skill

This guide helps you decide whether an instruction belongs in a Lore rule or in an agent skill, such as a Claude Code or Codex skill.

A skill packages a procedure an agent follows for one kind of task. A Lore file holds the rules a finished change must satisfy. Many instructions written in skills today are rules, and work better as Lore.

| | Lore rule | Skill |
|---|---|---|
| Describes | What a finished change must satisfy | How to carry out a kind of task |
| Selected | By a tool, from the files a change touches | By the agent, from the task it was given |
| Used by | Authors and reviewers | The agent doing the task |
| Result | A verdict per rule | The work itself |
| Example | Amounts are integers in minor units. | To remove a feature flag, delete its reads, then its definition, then the flag itself. |

1. **Ask the reviewer question.** Could a reviewer who sees only the finished change tell whether the instruction was followed? If so, it is a Lore rule.

2. **Look for steps.** A step, an order of steps, or a check-in with a person belongs in a skill.

3. **Check whether a machine can decide it.** If a linter or a type checker can decide the rule, make it a lint rule instead. Lore is for rules that need judgment.

4. **Split mixed instructions.** "When removing a flag, delete its reads first, and never leave a dead branch behind" holds a step (a skill) and a rule (no dead branches, in Lore).

5. **Connect the two.** A skill keeps only its steps, and ends by running `lore check` on the change instead of restating rules Lore already holds.

## Next steps

- [Convert a review guide](./convert-a-review-guide.md): move rules out of a document or a skill.
- [Writing rules](../topics/writing-rules.md): how to phrase what you move.
- [Run lore check from an agent](./agents.md): the line that connects a skill to Lore.
