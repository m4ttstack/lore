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

const AUTHOR_PREAMBLE = `# Lore rules for this change

These rules apply to your change. Fix any that your change breaks.

A flagged line is a place to look, not a verdict. Read the context below before changing code. Judge only by these rules; never invent rules from other prose.`;

const MAX_FLAGGED_LINES = 20;
const MAX_LINE_CODE_POINTS = 200;

const NOTHING = "No Lore rules apply to this change.";

export function renderText(selection: Selection, audience: "reviewer" | "author" = "reviewer"): string {
  const sections: string[] = [];
  if (selection.rules.length === 0 && selection.context.length === 0) {
    sections.push(selection.excluded.length === 0 ? NOTHING : `${NOTHING} Some Lore entries were excluded; see the excluded lines on stderr.`);
  } else {
    sections.push(audience === "author" ? AUTHOR_PREAMBLE : PREAMBLE);
    for (const rule of selection.rules) {
      const lines = [`## Rule ${span(rule.id)} (${rule.severity}, ${rule.category ?? "no category"})`, "", rule.prose];
      if (rule.hits.length > 0) {
        lines.push("", "Flagged lines:", "");
        for (const hit of rule.hits.slice(0, MAX_FLAGGED_LINES)) lines.push(`- ${span(`${hit.file}:${hit.line}`)} ${span(cut(hit.text))}`);
        if (rule.hits.length > MAX_FLAGGED_LINES) lines.push(`- and ${rule.hits.length - MAX_FLAGGED_LINES} more`);
      }
      sections.push(lines.join("\n"));
    }
    for (const context of selection.context) {
      const lines = [`## Context ${span(context.id)}`, "", context.prose];
      if (context.src !== null && context.srcText !== null) {
        const fence = "`".repeat(Math.max(4, longestRun(context.srcText) + 1));
        lines.push("", `From ${span(context.src)}:`, "", fence, context.srcText.replace(/\n$/, ""), fence);
      }
      sections.push(lines.join("\n"));
    }
  }
  if (selection.warnings.length > 0) sections.push(["## Warnings", "", ...selection.warnings.map(warningLine)].join("\n"));
  return `${sections.join("\n\n")}\n`;
}

export function excludedLines(selection: Selection): string {
  return selection.excluded
    .map(({ name, file, line, entry }) => `lore: excluded ${name} in ${file} line ${line}${entry === null ? "" : ` (entry ${entry})`}\n`)
    .join("");
}

function warningLine(warning: Diagnostic): string {
  const entry = warning.entry === null ? "" : ` (entry ${span(warning.entry)})`;
  return `- ${span(warning.name)} in ${span(warning.file)} line ${warning.line}${entry}`;
}

function cut(text: string): string {
  const points = Array.from(text);
  return points.length > MAX_LINE_CODE_POINTS ? `${points.slice(0, MAX_LINE_CODE_POINTS).join("")}...` : text;
}

function longestRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

// A code span whose backtick run is longer than any inside the text; CommonMark strips one padding space per side, so edge backticks, edge spaces and empty text get one.
function span(text: string): string {
  const ticks = "`".repeat(longestRun(text) + 1);
  const pad = text === "" || text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ")) ? " " : "";
  return `${ticks}${pad}${text}${pad}${ticks}`;
}
