---
title: Hand a reviewer the rules
sidebar_position: 3
---

# Hand a reviewer the rules

This guide gives a reviewer, human or AI, the rules that apply to a branch, then checks their verdicts.

1. **Print the rules for the branch.** From the branch, compare it with the commit where it left `main`:

   ```sh
   git diff main... | npx @mattstack/lore select --diff - --format text
   ```

   The text asks for a verdict on every selected rule and shows the format to answer in. Paste it into the reviewer's prompt, or into the pull request.

2. **Save the selection as JSON.** The verdicts are checked against this file, so save it from the same diff:

   ```sh
   git diff main... | npx @mattstack/lore select --diff - --format json > selection.json
   ```

3. **Collect the verdicts.** The reviewer answers in a fenced block tagged `lore-verdicts`. Save its contents as `verdicts.json`:

   ```json
   {
     "lore": "1",
     "verdicts": [
       {
         "rule": "money-in-minor-units",
         "verdict": "fail",
         "evidence": [{ "file": "src/checkout/total.ts", "line": 2 }],
         "note": "toFixed on a float amount"
       },
       { "rule": "price-from-quote", "verdict": "pass" }
     ]
   }
   ```

4. **Check them.**

   ```sh
   npx @mattstack/lore verdicts --selection selection.json verdicts.json
   ```

   With a verdict for every rule, it prints `{ "problems": [] }` and exits 0. A missing verdict comes back as a problem, and the command exits 1:

   ```json
   {
     "problems": [
       {
         "name": "missing-verdict",
         "rule": "price-from-quote",
         "detail": "\"price-from-quote\" has no verdict."
       }
     ]
   }
   ```

5. **Act on the result.** Send any problem back to the reviewer. Once the verdicts are clean, every `fail` names the line that breaks its rule.

## Next steps

- [Rules in scope, not triggered](../../reference/cli/also-in-scope.md): also show the reviewer rules that almost applied.
- [Output formats](../../reference/cli/output.md#verdict-set): every verdict problem and what it means.
- [How selection works](../topics/selection.md): why each rule needs exactly one answer.
