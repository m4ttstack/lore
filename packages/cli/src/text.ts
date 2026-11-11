import type { Diagnostic } from "@lore/parser";
import type { ListedRule, Selection } from "./selection";

const VERDICT_MEANINGS = `- \`pass\`: the change keeps the rule.
- \`fail\`: the change breaks it. Give at least one location: a changed file and a line in it as the change leaves it, or, with \`"side": "old"\`, a file's old path and a line the change removed.
- \`not-applicable\`: the rule was selected but does not bear on this change. Say why in \`note\`.`;

const VERDICT_FORMAT = `Return the verdicts as one fenced code block tagged \`lore-verdicts\`:

\`\`\`lore-verdicts
{ "lore": "1", "verdicts": [{ "rule": "<id>", "verdict": "fail", "evidence": [{ "file": "<path>", "line": 12 }], "note": "<why>" }] }
\`\`\``;

const PREAMBLE = `# Lore rules for this change

Answer every rule below with a verdict: \`pass\`, \`fail\` or \`not-applicable\`.

${VERDICT_MEANINGS}

A flagged line is a place to look, not a verdict. A flagged line marked (removed) is one the change removed, named by the file's old path. Read the context below before judging. Judge only by these rules; never invent rules from other prose.

${VERDICT_FORMAT}`;

const AUTHOR_PREAMBLE = `# Lore rules for this change

These rules apply to your change. Fix any that your change breaks.

A flagged line is a place to look, not a verdict. A flagged line marked (removed) is one the change removed, named by the file's old path. Read the context below before changing code. Judge only by these rules; never invent rules from other prose.`;

const MAX_FLAGGED_LINES = 20;
const MAX_LINE_CODE_POINTS = 200;
const MAX_LISTED_RULES = 40;
const MAX_SUMMARY_CODE_POINTS = 160;

const NOTHING = "No Lore rules apply to this change.";
const NOTHING_SELECTED = "No Lore rules were selected for this change.";
const EXCLUDED = "Some Lore entries were excluded; see the excluded lines on stderr.";

const LISTING_PARAGRAPH = {
  reviewer:
    "These rules cover files in this change, but nothing in the change triggered them. No verdict is needed for them. If one looks relevant to what the change does, run the command again with `--expand <id>` to read it, or give it a verdict directly.",
  author: "These rules cover files you changed, but nothing in your change triggered them. Read any that look relevant with `--expand <id>`.",
};

export function renderText(selection: Selection, audience: "reviewer" | "author" = "reviewer"): string {
  const sections: string[] = [];
  const listed = selection.alsoInScope ?? [];
  if (selection.rules.length === 0 && selection.context.length === 0) {
    const opener = listed.length === 0 ? NOTHING : NOTHING_SELECTED;
    sections.push(selection.excluded.length === 0 ? opener : `${opener} ${EXCLUDED}`);
    if (listed.length > 0) {
      sections.push(listingSection(listed, audience));
      if (audience === "reviewer") sections.push(VERDICT_FORMAT, VERDICT_MEANINGS);
    }
  } else {
    sections.push(audience === "author" ? AUTHOR_PREAMBLE : PREAMBLE);
    for (const rule of selection.rules) {
      const lines = [`## Rule ${span(rule.id)} (${rule.severity}, ${rule.category ?? "no category"}${rule.expanded ? ", expanded" : ""})`, "", rule.prose];
      if (rule.hits.length > 0) {
        lines.push("", "Flagged lines:", "");
        for (const hit of rule.hits.slice(0, MAX_FLAGGED_LINES)) lines.push(`- ${span(`${hit.file}:${hit.line}`)}${hit.side === "old" ? " (removed)" : ""} ${span(cut(hit.text))}`);
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
    if (listed.length > 0) sections.push(listingSection(listed, audience));
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

function listingSection(listed: ListedRule[], audience: "reviewer" | "author"): string {
  const lines = ["## Also in scope, not triggered", "", LISTING_PARAGRAPH[audience], ""];
  for (const rule of listed.slice(0, MAX_LISTED_RULES)) {
    lines.push(`- ${span(rule.id)} (${rule.severity}, ${rule.category ?? "no category"}): ${cut(rule.summary, MAX_SUMMARY_CODE_POINTS)}`);
  }
  if (listed.length > MAX_LISTED_RULES) lines.push(`- and ${listed.length - MAX_LISTED_RULES} more; \`--format json\` lists them all`);
  return lines.join("\n");
}

function cut(text: string, max = MAX_LINE_CODE_POINTS): string {
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max).join("")}...` : text;
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
