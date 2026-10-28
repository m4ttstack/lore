import type { Change, DocumentModel, EligibilityResult, Entry } from "@lore/parser";
import type { EntrySources } from "../src/selection";

const base = { category: null, severity: null, disabled: false, scopes: [], when: null, checks: [], meta: null, src: null };

export const rule: Entry = {
  ...base, kind: "rule", id: "money-in-minor-units", file: ".lore/pricing.lore", category: "data_lineage", severity: "blocking",
  meta: { owner: "pricing" }, summary: "Money is integer minor units.", prose: "Money is stored as integer minor units.\nNever multiply a price by a float.",
};
export const advisory: Entry = { ...base, kind: "rule", id: "name-things", file: ".lore/style.lore", summary: "Name things.", prose: "Name things well." };
export const context: Entry = {
  ...base, kind: "context", id: "architecture", file: ".lore/pricing.lore", src: "docs/architecture.md",
  summary: "Pricing architecture.", prose: "Pricing lives in one module.",
};
export const notEligible: Entry = { ...base, kind: "rule", id: "not-selected", file: ".lore/pricing.lore", summary: "Other.", prose: "Other." };

export const model: DocumentModel = {
  entries: [rule, advisory, context, notEligible],
  errors: [{ name: "unknown-attribute", file: ".lore/bad.lore", entry: "broken", line: 3 }],
  warnings: [],
};

export const result: EligibilityResult = {
  eligible: ["architecture", "money-in-minor-units", "name-things"],
  hits: [
    { rule: "money-in-minor-units", file: "src/Price.ts", line: 4, text: "total * 1.2" },
    { rule: "money-in-minor-units", file: "src/Price.ts", line: 9, text: "price * 0.5" },
  ],
  excluded: model.errors,
  warnings: [{ name: "check-needs-file", file: ".lore/pricing.lore", entry: "money-in-minor-units", line: 6 }],
};

export const change: Change = {
  files: [
    { kind: "M", path: "src/Price.ts", added: [{ line: 4, text: "total * 1.2" }, { line: 9, text: "price * 0.5" }] },
    { kind: "R", oldPath: "src/old.ts", path: "src/new.ts", added: [] },
  ],
};

export const sources: EntrySources = {
  read: (entry) => (entry.src === "docs/architecture.md" ? "# Architecture\n\nOne pricing module.\n" : null),
  diagnostic: (entry, name) => ({ name, file: entry.file, entry: entry.id, line: 12, range: { start: { line: 12, character: 0 }, end: { line: 12, character: 9 } } }),
};
