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

  test("a set that is not an object with lore 1 and a verdicts array is invalid", () => {
    for (const bad of [null, [], "x", { verdicts: [] }, { lore: "2", verdicts: [] }, { lore: "1" }, { lore: "1", verdicts: {} }]) {
      expect(checkVerdicts(selection, bad)).toEqual([
        { name: "invalid-verdict-set", rule: null, detail: expect.any(String) },
      ]);
    }
  });

  test("each malformed verdict is one problem and the rest are still checked", () => {
    const problems = checkVerdicts(selection, set(
      "nope",
      { rule: 3, verdict: "pass" },
      { rule: "alpha", verdict: "maybe" },
      { rule: "alpha", verdict: "pass", evidence: [{ file: "src/mod.ts", line: 0 }] },
      { rule: "alpha", verdict: "pass", evidence: [{ file: "src/mod.ts", line: 1, side: "both" }] },
      { rule: "alpha", verdict: "pass", evidence: "x" },
      pass("beta"),
    ));
    expect(problems.filter((p) => p.name === "invalid-verdict-set")).toHaveLength(6);
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
