# writing-lore rubric (scored per run)

Classification (the "reviewer sees only the change" test)
- C1 Steps 1, 2, 4, 5 and the intro (read whole skill, run tests, preview order, ask author, post format) are NOT rules; they stay in the skill.
- C2 Item 7 (formatting) is not a Lore rule: CI/prettier enforces it ("if it can be a lint rule, it should be one").
- C3 The pricing-deep-dive subagent delegation is not convertible; recorded as a gap / left in the skill.
- C4 Item 6: the removal ORDER is a skill step; the slip (flag read removed while definition stays) is judgeable from the change. Handled as a rule with an honest trigger story (removed-line conditions are reserved) or explicitly deferred; not a rule that encodes step order.

Lore mechanics
- C5 Conditions use plain-text addedContains over addedMatches regex.
- C6 No ast-grep <check> (the CLI skips it with check-needs-file).
- C7 Item 5's apps/api half lives in a file under apps/api (a rule's scope only narrows its file's); the web half under apps/web.
- C8 Item 3 is always-on in scope (no trigger can see a missing fragment field) OR trigger with the trade-off stated; not a trigger presented as complete.
- C9 Context src only for readable files (file-relative, in the rules folder); no src naming repo files that --no-repo cannot read.
- C10 .loreconfig with repo: github.com/acme/storefront at the rules root.

Fidelity
- C11 meta records source: <skill>#<heading> (or equivalent traceability).
- C12 [BLOCKING] -> blocking, [NON-BLOCKING] -> advisory; "usually BLOCKING" decided and flagged.
- C13 Rule prose keeps the source's wording; stakes kept; references the reviewer cannot open (!4120) dropped or flagged.
- C14 Each rule's prose is complete on its own (a reader without the skill can apply it).

Verification
- C15 Ran lore select on a positive and a negative diff, and the untracked-given-folder warning / git-tracking behaviour is understood (not "fixed" by hacks).
- C16 Ran lore verdicts or otherwise checked a verdict set shape (optional).

Aftermath
- C17 Says what the skill keeps (steps) and that it should end by running lore select instead of restating rules.

Refactor round 1 (from GREEN runs)
- C18 A rule with no <when> is scoped inside what the source governs (no repo-root always-on rule for a checkout skill), or recorded as a gap.
- C19 Alternatives that mix literals and a pattern sit in one addedMatches list, since every condition in a <when> must hold.
