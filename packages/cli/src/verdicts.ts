import { InputError } from "./errors";
import type { Selection } from "./selection";

export interface VerdictProblem { name: string; rule: string | null; detail: string }

interface Location { file: string; line: number; side: "new" | "old" }
interface Verdict { rule: string; verdict: "pass" | "fail" | "not-applicable"; evidence: Location[]; note: string }

const VERDICTS = ["pass", "fail", "not-applicable"];
const CHANGE_KINDS = ["A", "M", "D", "R"];

export function checkVerdicts(selection: Selection, verdictSet: unknown): VerdictProblem[] {
  const problems: VerdictProblem[] = [];
  const report = (name: string, rule: string | null, detail: string): void => void problems.push({ name, rule, detail });

  const invalidSet = (detail: string): VerdictProblem[] => [{ name: "invalid-verdict-set", rule: null, detail }];
  if (!isObject(verdictSet)) return invalidSet("The verdict set is not a JSON object.");
  if (verdictSet.lore !== "1") return invalidSet('The verdict set\'s "lore" must be "1".');
  if (!Array.isArray(verdictSet.verdicts)) return invalidSet('The verdict set\'s "verdicts" must be an array.');

  const selected = new Set(selection.rules.map((rule) => rule.id));
  const newPaths = new Set(selection.change.filter((file) => file.kind !== "D").map((file) => file.path));
  const oldPaths = new Set<string>();
  for (const file of selection.change) {
    if (file.kind === "D" || file.kind === "M") oldPaths.add(file.path);
    if (file.kind === "R" && file.oldPath !== null) oldPaths.add(file.oldPath);
  }

  const seen = new Set<string>();
  verdictSet.verdicts.forEach((raw: unknown, index: number) => {
    const verdict = readVerdict(raw, index + 1);
    if (typeof verdict === "string") {
      report("invalid-verdict-set", isObject(raw) && typeof raw.rule === "string" ? raw.rule : null, verdict);
      return;
    }
    const { rule } = verdict;
    if (!selected.has(rule)) report("unselected-verdict", rule, `"${rule}" is not a selected rule.`);
    else if (seen.has(rule)) report("duplicate-verdict", rule, `"${rule}" has more than one verdict.`);
    seen.add(rule);
    if (verdict.verdict === "fail" && verdict.evidence.length === 0) {
      report("fail-without-evidence", rule, "A fail needs at least one evidence location.");
    }
    const outside = verdict.evidence.filter(({ file, side }) => !(side === "new" ? newPaths : oldPaths).has(file));
    if (outside.length > 0) {
      const where = outside.map(({ file, line, side }) => `${file} line ${line} (${side} side)`).join(", ");
      report("evidence-outside-change", rule, `Evidence names no changed file on its side: ${where}.`);
    }
    if (verdict.verdict !== "pass" && verdict.note.trim() === "") {
      report("missing-note", rule, `A ${verdict.verdict} needs a note.`);
    }
  });

  for (const rule of selection.rules) {
    if (!seen.has(rule.id)) report("missing-verdict", rule.id, `"${rule.id}" has no verdict.`);
  }

  return problems.sort((a, b) => compare(a.rule, b.rule) || compare(a.name, b.name));
}

export function readSelection(value: unknown): Selection {
  if (
    !isObject(value) || !Array.isArray(value.rules) || !Array.isArray(value.context) || !Array.isArray(value.change) ||
    !value.rules.every((rule) => isObject(rule) && typeof rule.id === "string") ||
    !value.context.every((context) => isObject(context) && typeof context.id === "string") ||
    !value.change.every(
      (file) =>
        isObject(file) && CHANGE_KINDS.includes(file.kind as string) && typeof file.path === "string" &&
        (file.oldPath === null || typeof file.oldPath === "string"),
    )
  ) {
    throw new InputError("the selection file is not a lore select selection");
  }
  return value as unknown as Selection;
}

// A malformed verdict comes back as the detail naming its failing field.
function readVerdict(raw: unknown, number: number): Verdict | string {
  if (!isObject(raw)) return `Verdict ${number} is not an object.`;
  if (typeof raw.rule !== "string") return `Verdict ${number} has no string "rule".`;
  const bad = (what: string): string => `Verdict ${number} for "${raw.rule}": ${what}.`;
  if (!VERDICTS.includes(raw.verdict as string)) return bad('"verdict" must be pass, fail or not-applicable');
  const evidence: Location[] = [];
  if (raw.evidence !== undefined) {
    if (!Array.isArray(raw.evidence)) return bad('"evidence" must be an array');
    for (const [at, item] of raw.evidence.entries()) {
      const nth = `evidence ${at + 1}`;
      if (!isObject(item)) return bad(`${nth} is not an object`);
      if (typeof item.file !== "string") return bad(`${nth} "file" must be a string`);
      if (!Number.isInteger(item.line) || (item.line as number) < 1) return bad(`${nth} "line" must be a whole number of 1 or more`);
      if (item.side !== undefined && item.side !== "new" && item.side !== "old") return bad(`${nth} "side" must be new or old`);
      evidence.push({ file: item.file, line: item.line as number, side: item.side ?? "new" });
    }
  }
  return {
    rule: raw.rule,
    verdict: raw.verdict as Verdict["verdict"],
    evidence,
    note: typeof raw.note === "string" ? raw.note : "",
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compare(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}
