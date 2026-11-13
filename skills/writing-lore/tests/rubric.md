# writing-lore rubric (scored per run)

Classification (the "reviewer sees only the change" test)
- C1 Steps 1, 2, 4, 5 and the intro (read whole skill, run tests, preview order, ask author, post format) are NOT rules; they stay in the skill.
- C2 Item 7 (formatting) is not a Lore rule: CI/prettier enforces it ("if it can be a lint rule, it should be one").
- C3 The pricing-deep-dive subagent delegation is not convertible; recorded as a gap / left in the skill.
- C4 Item 6: the removal ORDER is a skill step; the slip (a flag read removed while the definition stays) is a rule with `removedContains: ["isEnabled('"]` and prose that tells the reviewer to check `flags.ts`; not an always-on rule, not an added-line stand-in, and not a rule that encodes step order. It stays `removedContains`, not a dropped-line condition: an edit that reads a different flag adds `isEnabled('` back and is still the slip.

Lore mechanics
- C5 Conditions use plain-text addedContains over addedMatches regex.
- C6 No ast-grep <check> (the CLI skips it with check-needs-file).
- C7 Item 5's apps/api half lives in a file under apps/api (a rule's scope only narrows its file's); the web half under apps/web.
- C8 Item 3 is always-on in scope (no trigger can see a missing fragment field) OR trigger with the trade-off stated; not a trigger presented as complete.
- C9 Context src only for readable files (file-relative, in the rules folder); no src naming repo files that --no-repo cannot read.
- C10 .loreconfig with repo: github.com/acme/storefront at the rules root.

Fidelity
- C11 Each rule traces to the section it came from, in a `<source>` block (see C21), and the conversion notes list each rule id with its source heading.
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

Refactor round 2 (dropped-line conditions)
- C20 Item 8: the deleted fallback is a rule scoped inside what the source governs, with `droppedContains` (or `droppedMatches`) on the fallback, because an edited line that keeps its fallback is not the slip; not `removedContains`, which selects the rule on every such edit, and not an always-on rule.

Refactor round 3 (sources)
- C21 Every converted rule names where it came from in a `<source>` block, not `source:` in `<meta>`. Its `file` is a file every reader of the rules can open: the skill lives outside the storefront repo and keeps only its steps after the conversion, so a copy of it as converted is kept in the rules folder and cited file-relative (`./` or `../`), never a local path, a guessed storefront path or a leading `/` (which names the storefront root once the folder is in git). Its `heading` is the skill's heading as written, or that heading's slug, number and tag included (``2. Money is integer minor units `[BLOCKING]` ``, item 9 as the question it asks), so `LORE audit` on the folder reports no `invalid-source` or `source-missing`. The agent does not run `lore review`; the report leaves recording the review to the person who reads the rules against the copy.

Refactor round 4 (listing line)
- C22 Item 10: the rule's first paragraph says when the rule applies before what it asks for, and holds the limit (exported functions of apps/web/src/checkout/lib/ only), so a reader who sees only the first paragraph, as the in-scope listing shows it, does not ask for the comment on a local or unexported function. The first paragraph stays under 600 code points.
