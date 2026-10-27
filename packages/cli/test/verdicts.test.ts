import { describe, expect, test } from "bun:test";
import type { Selection } from "../src/selection";
import { checkVerdicts } from "../src/verdicts";

const rule = (id: string) => ({
  id, file: ".lore/a.lore", category: null, severity: "advisory" as const, summary: id, prose: id, meta: null, hits: [],
});

const selection: Selection = {
  lore: "1",
  rules: [rule("alpha"), rule("beta")],
  context: [{ id: "ctx", file: ".lore/a.lore", summary: "c", prose: "c", src: null, srcText: null }],
  conditional: [],
  change: [
    { kind: "M", path: "src/mod.ts", oldPath: null, added: [2] },
    { kind: "R", path: "src/new.ts", oldPath: "src/old.ts", added: [] },
    { kind: "D", path: "src/gone.ts", oldPath: null, added: [] },
  ],
  excluded: [],
  warnings: [],
};

const pass = (id: string) => ({ rule: id, verdict: "pass" });
const set = (...verdicts: unknown[]) => ({ lore: "1", verdicts });
const names = (verdictSet: unknown) => checkVerdicts(selection, verdictSet).map((p) => `${p.rule}:${p.name}`);

describe("checkVerdicts", () => {
  test("a complete valid set has no problems", () => {
    const failing = { rule: "beta", verdict: "fail", note: "why", evidence: [{ file: "src/mod.ts", line: 2 }] };
    expect(checkVerdicts(selection, set(pass("alpha"), failing))).toEqual([]);
  });

  test("extra fields are allowed", () => {
    expect(checkVerdicts(selection, { ...set({ ...pass("alpha"), extra: 1 }, pass("beta")), more: true })).toEqual([]);
  });

  test("a set that is not an object with lore 1 and a verdicts array is invalid, naming the failing field", () => {
    const cases: [unknown, string][] = [
      [null, "The verdict set is not a JSON object."],
      [[], "The verdict set is not a JSON object."],
      ["x", "The verdict set is not a JSON object."],
      [{ verdicts: [] }, 'The verdict set\'s "lore" must be "1".'],
      [{ lore: "2", verdicts: [] }, 'The verdict set\'s "lore" must be "1".'],
      [{ lore: "1" }, 'The verdict set\'s "verdicts" must be an array.'],
      [{ lore: "1", verdicts: {} }, 'The verdict set\'s "verdicts" must be an array.'],
    ];
    for (const [bad, detail] of cases) {
      expect(checkVerdicts(selection, bad)).toEqual([{ name: "invalid-verdict-set", rule: null, detail }]);
    }
  });

  test("each malformed verdict is one problem naming its field and its rule, and the rest are still checked", () => {
    const problems = checkVerdicts(selection, set(
      "nope",
      { rule: 3, verdict: "pass" },
      { rule: "alpha", verdict: "maybe" },
      { rule: "alpha", verdict: "pass", evidence: [{ file: "src/mod.ts", line: 0 }] },
      { rule: "alpha", verdict: "pass", evidence: [{ file: "src/mod.ts", line: 1 }, { file: "src/mod.ts", line: 1, side: "both" }] },
      { rule: "alpha", verdict: "pass", evidence: "x" },
      { rule: "alpha", verdict: "pass", evidence: [7] },
      { rule: "alpha", verdict: "pass", evidence: [{ line: 2 }] },
      pass("beta"),
    ));
    expect(problems.filter((p) => p.name === "invalid-verdict-set")).toEqual([
      { name: "invalid-verdict-set", rule: null, detail: "Verdict 1 is not an object." },
      { name: "invalid-verdict-set", rule: null, detail: 'Verdict 2 has no string "rule".' },
      { name: "invalid-verdict-set", rule: null, detail: 'Verdict 3 for "alpha": "verdict" must be pass, fail or not-applicable.' },
      { name: "invalid-verdict-set", rule: null, detail: 'Verdict 4 for "alpha": evidence 1 "line" must be a whole number of 1 or more.' },
      { name: "invalid-verdict-set", rule: null, detail: 'Verdict 5 for "alpha": evidence 2 "side" must be new or old.' },
      { name: "invalid-verdict-set", rule: null, detail: 'Verdict 6 for "alpha": "evidence" must be an array.' },
      { name: "invalid-verdict-set", rule: null, detail: 'Verdict 7 for "alpha": evidence 1 is not an object.' },
      { name: "invalid-verdict-set", rule: null, detail: 'Verdict 8 for "alpha": evidence 1 "file" must be a string.' },
    ]);
    expect(problems.map((p) => p.name)).toContain("missing-verdict");
  });

  test("missing-verdict names a selected rule with no verdict", () => {
    expect(names(set(pass("alpha")))).toEqual(["beta:missing-verdict"]);
  });

  test("duplicate-verdict is reported once per extra verdict", () => {
    expect(names(set(pass("alpha"), pass("alpha"), pass("alpha"), pass("beta")))).toEqual([
      "alpha:duplicate-verdict", "alpha:duplicate-verdict",
    ]);
  });

  test("unselected-verdict covers unknown and context ids", () => {
    expect(names(set(pass("alpha"), pass("beta"), pass("ctx"), pass("zzz")))).toEqual([
      "ctx:unselected-verdict", "zzz:unselected-verdict",
    ]);
  });

  test("fail-without-evidence for a fail with none or an empty list", () => {
    const problems = names(set({ rule: "alpha", verdict: "fail", note: "n" }, { rule: "beta", verdict: "fail", note: "n", evidence: [] }));
    expect(problems).toEqual(["alpha:fail-without-evidence", "beta:fail-without-evidence"]);
  });

  test("evidence-outside-change for new locations in unchanged or deleted files", () => {
    const evidence = (file: string, side?: string) => ({ rule: "alpha", verdict: "pass", evidence: [{ file, line: 1, side }] });
    for (const file of ["src/other.ts", "src/gone.ts", "src/old.ts"]) {
      expect(names(set(evidence(file), pass("beta")))).toEqual(["alpha:evidence-outside-change"]);
    }
    for (const file of ["src/mod.ts", "src/new.ts"]) {
      expect(names(set(evidence(file, "new"), pass("beta")))).toEqual([]);
    }
  });

  test("evidence-outside-change names every offending location", () => {
    const evidence = [
      { file: "src/other.ts", line: 1 },
      { file: "src/mod.ts", line: 2 },
      { file: "src/new.ts", line: 4, side: "old" },
    ];
    expect(checkVerdicts(selection, set({ rule: "alpha", verdict: "pass", evidence }, pass("beta")))).toEqual([
      {
        name: "evidence-outside-change",
        rule: "alpha",
        detail: "Evidence names no changed file on its side: src/other.ts line 1 (new side), src/new.ts line 4 (old side).",
      },
    ]);
  });

  test("old locations may name a deleted, modified or renamed file's old path", () => {
    const old = (file: string) => ({ rule: "alpha", verdict: "pass", evidence: [{ file, line: 4, side: "old" }] });
    for (const file of ["src/gone.ts", "src/mod.ts", "src/old.ts"]) {
      expect(names(set(old(file), pass("beta")))).toEqual([]);
    }
    for (const file of ["src/new.ts", "src/other.ts"]) {
      expect(names(set(old(file), pass("beta")))).toEqual(["alpha:evidence-outside-change"]);
    }
  });

  test("missing-note for a fail or not-applicable without a non-empty note", () => {
    const evidence = [{ file: "src/mod.ts", line: 2 }];
    expect(names(set(
      { rule: "alpha", verdict: "fail", evidence },
      { rule: "beta", verdict: "not-applicable", note: "   " },
    ))).toEqual(["alpha:missing-note", "beta:missing-note"]);
    expect(names(set(pass("alpha"), { rule: "beta", verdict: "not-applicable", note: "unrelated" }))).toEqual([]);
  });

  test("problems sort by rule, null first, then name", () => {
    expect(names(set(5, { rule: "zzz", verdict: "pass" }, { rule: "alpha", verdict: "fail" }))).toEqual([
      "null:invalid-verdict-set",
      "alpha:fail-without-evidence",
      "alpha:missing-note",
      "beta:missing-verdict",
      "zzz:unselected-verdict",
    ]);
  });

  test("details are one line without em or en dashes", () => {
    const problems = checkVerdicts(selection, set(5, { rule: "alpha", verdict: "fail" }, pass("alpha"), pass("zzz")));
    expect(problems.length).toBeGreaterThan(0);
    for (const { detail } of problems) expect(detail).toMatch(/^[^\n–—]+$/);
  });
});
