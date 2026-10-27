import type { Diagnostic } from "@lore/parser";
import type { Selection } from "./selection";

const PREAMBLE = `# Lore rules for this change

Answer every rule below with a verdict: \`pass\`, \`fail\` or \`not-applicable\`.

- \`pass\`: the change keeps the rule.
- \`fail\`: the change breaks it. Give at least one location: a changed file and a line in it as the change leaves it, or, with \`"side": "old"\`, a file's old path and a line the change removed.
- \`not-applicable\`: the rule was selected but does not bear on this change. Say why in \`note\`.

A flagged line is a place to look, not a verdict. Read the context below before judging. Judge only by these rules; never invent rules from other prose.

Return the verdicts as one fenced code block tagged \`lore-verdicts\`:

\`\`\`lore-verdicts
{ "lore": "1", "verdicts": [{ "rule": "<id>", "verdict": "fail", "evidence": [{ "file": "<path>", "line": 12 }], "note": "<why>" }] }
\`\`\``;

export function renderText(selection: Selection): string {
  const sections: string[] = [];
  if (selection.rules.length === 0 && selection.context.length === 0) sections.push("No Lore rules apply to this change.");
  else {
    sections.push(PREAMBLE);
    for (const rule of selection.rules) {
      const lines = [`## Rule \`${rule.id}\` (${rule.severity}, ${rule.category ?? "no category"})`, "", rule.prose];
      if (rule.hits.length > 0) {
        lines.push("", "Flagged lines:", "");
        for (const hit of rule.hits) lines.push(`- \`${hit.file}:${hit.line}\` \`${hit.text}\``);
      }
      sections.push(lines.join("\n"));
    }
    for (const context of selection.context) {
      const lines = [`## Context \`${context.id}\``, "", context.prose];
      if (context.srcText !== null) lines.push("", `From \`${context.src}\`:`, "", "````", context.srcText.replace(/\n$/, ""), "````");
      sections.push(lines.join("\n"));
    }
  }
  if (selection.warnings.length > 0) sections.push(["## Warnings", "", ...selection.warnings.map(warningLine)].join("\n"));
  return `${sections.join("\n\n")}\n`;
}

function warningLine(warning: Diagnostic): string {
  const entry = warning.entry === null ? "" : ` (entry \`${warning.entry}\`)`;
  return `- \`${warning.name}\` in \`${warning.file}\` line ${warning.line}${entry}`;
}
