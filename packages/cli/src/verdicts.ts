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

  if (!isObject(verdictSet) || verdictSet.lore !== "1" || !Array.isArray(verdictSet.verdicts)) {
    return [{ name: "invalid-verdict-set", rule: null, detail: 'The verdict set must be an object with lore "1" and a verdicts array.' }];
  }

  const selected = new Set(selection.rules.map((rule) => rule.id));
  const newPaths = new Set(selection.change.filter((file) => file.kind !== "D").map((file) => file.path));
  const oldPaths = new Set<string>();
  for (const file of selection.change) {
    if (file.kind === "D" || file.kind === "M") oldPaths.add(file.path);
    if (file.kind === "R" && file.oldPath !== null) oldPaths.add(file.oldPath);
  }

  const seen = new Set<string>();
  verdictSet.verdicts.forEach((raw: unknown, index: number) => {
    const verdict = readVerdict(raw);
    if (verdict === null) {
      report("invalid-verdict-set", null, `Verdict ${index + 1} is malformed.`);
      return;
    }
    const { rule } = verdict;
    if (!selected.has(rule)) report("unselected-verdict", rule, `"${rule}" is not a selected rule.`);
    else if (seen.has(rule)) report("duplicate-verdict", rule, `"${rule}" has more than one verdict.`);
    seen.add(rule);
    if (verdict.verdict === "fail" && verdict.evidence.length === 0) {
      report("fail-without-evidence", rule, "A fail needs at least one evidence location.");
    }
    const outside = verdict.evidence.find(({ file, side }) => !(side === "new" ? newPaths : oldPaths).has(file));
    if (outside !== undefined) {
      report("evidence-outside-change", rule, `${outside.file} is not a changed file on the ${outside.side} side.`);
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

function readVerdict(raw: unknown): Verdict | null {
  if (!isObject(raw) || typeof raw.rule !== "string" || !VERDICTS.includes(raw.verdict as string)) return null;
  const evidence: Location[] = [];
  if (raw.evidence !== undefined) {
    if (!Array.isArray(raw.evidence)) return null;
    for (const item of raw.evidence) {
      if (!isObject(item) || typeof item.file !== "string" || !Number.isInteger(item.line) || (item.line as number) < 1) return null;
      if (item.side !== undefined && item.side !== "new" && item.side !== "old") return null;
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
