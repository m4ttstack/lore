import { describe, expect, test } from "bun:test";
import type { Example, ExampleFile } from "../../../tools/check/extract";
import { audit, lockPathFor, lockRefs, type AuditOptions, type Finding } from "../src/audit";
import { parseWithContext } from "../src/model";
import { writeReviews, type ReviewRecord } from "../src/reviews";
import { resolveSource } from "../src/sources";
import type { Source } from "../src/types";
import { auditOptions, toInput } from "./harness";

const LORE = ".lore/checkout.lore";
const LOCK = "lore-reviews.lock";
const ID = "money-in-minor-units";
const DOC = "# Checkout review\n\n## Money is integer minor units\n\nAmounts are integers in minor units.\n\n## Dates\n\nUse UTC.\n";

function rule(source: string, id = ID, extra = ""): string {
  return `<rule id="${id}" category="functional_correctness"${extra}>\n<source>\n${source}\n</source>\nAmounts are integers in minor units (cents).\n</rule>\n`;
}

function placeOf(path: string): ExampleFile["place"] {
  return path.startsWith("external:") ? "external" : path.startsWith("loose:") ? "loose" : "repo";
}

function example(files: Record<string, string>): Example {
  return {
    number: 1, kind: "audit", section: "", line: 1, requires: [], remote: null, diff: null, expect: null, today: "2026-11-12",
    files: Object.entries(files).map(([path, content]) => ({ path, place: placeOf(path), content })),
  };
}

function run(files: Record<string, string>, options: Partial<AuditOptions> = {}) {
  const ex = example(files);
  const parsed = parseWithContext(toInput(ex));
  return audit(parsed, { ...auditOptions(ex, parsed), ...options });
}

function hashOf(source: Source, content: string): string {
  const resolved = resolveSource(source, content);
  if (!resolved.ok) throw new Error("the source does not resolve");
  return resolved.hash;
}

function source(partial: Partial<Source> = {}): Source {
  return { file: "docs/review.md", heading: null, phrase: null, ...partial };
}

function record(src: Source, partial: Partial<ReviewRecord> = {}, content = DOC): ReviewRecord {
  return { rule: ID, ...src, reviewed: "2026-11-01", hash: hashOf(src, content), ...partial };
}

function lock(...records: ReviewRecord[]): string {
  return writeReviews(records);
}

function finding(partial: Partial<Finding> & Pick<Finding, "name" | "level">): Finding {
  return { rule: ID, file: LORE, source: source(), reason: null, ...partial };
}

const HEADING = "file: docs/review.md\nheading: Money is integer minor units";
const AT_HEADING = source({ heading: "Money is integer minor units" });

describe("audit", () => {
  test("a resolving source whose record matches has no findings", () => {
    const result = run({ [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING)) });
    expect(result).toEqual({ findings: [], summary: { counts: {}, rulesWithSource: 1, rulesWithoutSource: 0 }, excluded: [] });
  });

  test("an absent file is source-missing", () => {
    const result = run({ [LORE]: rule("file: docs/review.md"), [LOCK]: lock(record(source())) });
    expect(result.findings).toEqual([
      finding({ name: "source-missing", level: "error", reason: "file not found: docs/review.md" }),
    ]);
    expect(result.summary.counts).toEqual({ "source-missing": 1 });
  });

  test("an absent heading is source-missing", () => {
    const result = run({ [LORE]: rule("file: docs/review.md\nheading: Money"), "docs/review.md": DOC });
    expect(result.findings).toEqual([
      finding({ name: "source-missing", level: "error", source: source({ heading: "Money" }), reason: 'heading not found: "Money"' }),
    ]);
  });

  test("an absent phrase is source-missing", () => {
    const result = run({ [LORE]: rule("file: docs/review.md\nphrase: 'fromCents('"), "docs/review.md": DOC });
    expect(result.findings).toEqual([
      finding({ name: "source-missing", level: "error", source: source({ phrase: "fromCents(" }), reason: 'phrase not found: "fromCents("' }),
    ]);
  });

  test("a source whose file could not be looked at is source-unchecked", () => {
    const result = run({ [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING)) }, { readSource: () => undefined });
    expect(result.findings).toEqual([finding({ name: "source-unchecked", level: "error", source: AT_HEADING })]);
  });

  test("a record whose hash differs is source-changed", () => {
    const result = run({ [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING, { hash: "000000000000" })) });
    expect(result.findings).toEqual([finding({ name: "source-changed", level: "warn", source: AT_HEADING })]);
  });

  test("a source with no record is never-reviewed", () => {
    const result = run({ [LORE]: rule(HEADING), "docs/review.md": DOC });
    expect(result.findings).toEqual([finding({ name: "never-reviewed", level: "warn", source: AT_HEADING })]);
  });

  test("a record older than the age limit is review-overdue, and no limit means none", () => {
    const files = { [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING, { reviewed: "2026-01-01" })) };
    expect(run(files, { maxAgeDays: 180 }).findings).toEqual([finding({ name: "review-overdue", level: "warn", source: AT_HEADING })]);
    expect(run(files, { maxAgeDays: 400 }).findings).toEqual([]);
    expect(run(files).findings).toEqual([]);
  });

  test("a review exactly the age limit old is not overdue", () => {
    const files = { [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING, { reviewed: "2026-11-02" })) };
    expect(run(files, { maxAgeDays: 10 }).findings).toEqual([]);
    expect(run(files, { maxAgeDays: 9 }).findings.map((f) => f.name)).toEqual(["review-overdue"]);
  });

  test("a record for an id no rule has, or for a source the rule no longer has, is orphan-review", () => {
    const gone = record(AT_HEADING, { rule: "price-from-quote" });
    const old = record(source({ heading: "Dates" }));
    const result = run({ [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING), gone, old) });
    expect(result.findings).toEqual([
      finding({ name: "orphan-review", level: "warn", rule: ID, file: LOCK, source: source({ heading: "Dates" }) }),
      finding({ name: "orphan-review", level: "warn", rule: "price-from-quote", file: LOCK, source: AT_HEADING }),
    ]);
  });

  test("two matching headings are ambiguous-heading, not source-missing", () => {
    const doc = "## Money is integer minor units\n\nCents.\n\n## money is integer minor units\n\nAlso cents.\n";
    const result = run({ [LORE]: rule(HEADING), "docs/review.md": doc, [LOCK]: lock(record(AT_HEADING, {}, doc)) });
    expect(result.findings).toEqual([finding({ name: "ambiguous-heading", level: "warn", source: AT_HEADING })]);
  });

  test("a meta source key without a <source> block is meta-source, off by default", () => {
    const lore = `<rule id="${ID}" category="functional_correctness">\n<meta>\nsource: https://wiki.example.com/money\n</meta>\nAmounts are integers.\n</rule>\n`;
    expect(run({ [LORE]: lore })).toEqual({ findings: [], summary: { counts: {}, rulesWithSource: 0, rulesWithoutSource: 1 }, excluded: [] });
    expect(run({ [LORE]: lore }, { levels: { "meta-source": "warn" } }).findings).toEqual([
      finding({ name: "meta-source", level: "warn", source: null }),
    ]);
  });

  test("a rule moved to another Lore folder under the same Lore root keeps its record", () => {
    const src = source({ file: "docs/review.md", heading: "Money is integer minor units" });
    const files = {
      "apps/web/.lore/money.lore": rule("file: /docs/review.md\nheading: Money is integer minor units"),
      "docs/review.md": DOC,
      [LOCK]: lock(record(src)),
    };
    expect(run(files).findings).toEqual([]);
  });

  test("a level in options overrides the .loreconfig", () => {
    const files = {
      ".loreconfig": "audit:\n  levels:\n    source-changed: error\n",
      [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING, { hash: "000000000000" })),
    };
    expect(run(files).findings).toEqual([finding({ name: "source-changed", level: "error", source: AT_HEADING })]);
    expect(run(files, { levels: { "source-changed": "off" } }).findings).toEqual([]);
  });

  test("a missing source that is also unreviewed is only source-missing", () => {
    const result = run({ [LORE]: rule("file: docs/review.md") });
    expect(result.findings).toEqual([finding({ name: "source-missing", level: "error", reason: "file not found: docs/review.md" })]);
  });

  test("the settings of the rule's own Lore file apply, and an orphan takes the Lore root's", () => {
    const files = {
      ".loreconfig": "audit:\n  levels:\n    orphan-review: error\n    never-reviewed: error\n",
      "apps/web/.loreconfig": "audit:\n  levels:\n    orphan-review: off\n    never-reviewed: off\n",
      "apps/web/.lore/money.lore": rule("file: /docs/review.md"),
      ".lore/dates.lore": rule("file: docs/review.md", "dates-in-utc"),
      "docs/review.md": DOC,
      [LOCK]: lock(record(source(), { rule: "price-from-quote" })),
    };
    expect(run(files).findings).toEqual([
      finding({ name: "never-reviewed", level: "error", rule: "dates-in-utc", file: ".lore/dates.lore" }),
      finding({ name: "orphan-review", level: "error", rule: "price-from-quote", file: LOCK }),
    ]);
  });

  test("disabled rules are audited, and findings sort by file, rule, then finding", () => {
    const files = {
      ".lore/b.lore": rule("- file: docs/review.md\n  heading: Money is integer minor units\n- file: docs/gone.md", "zeta-rule", " disabled"),
      ".lore/a.lore": rule("file: docs/gone.md", "alpha-rule"),
      "docs/review.md": DOC,
    };
    expect(run(files).findings.map((f) => [f.file, f.rule, f.name])).toEqual([
      [".lore/a.lore", "alpha-rule", "source-missing"],
      [".lore/b.lore", "zeta-rule", "source-missing"],
      [".lore/b.lore", "zeta-rule", "never-reviewed"],
    ]);
  });

  test("an excluded entry is not audited and its records are not orphans", () => {
    const broken = `<rule id="${ID}" category="functional_correctness" severity="fatal">\nAmounts.\n</rule>\n`;
    const result = run({ [LORE]: broken, [LOCK]: lock(record(source())) });
    expect(result.findings).toEqual([]);
    expect(result.excluded.map((d) => [d.name, d.entry])).toEqual([["invalid-attribute-value", ID]]);
    expect(result.summary).toEqual({ counts: {}, rulesWithSource: 0, rulesWithoutSource: 0 });
  });
});

describe("lockPathFor", () => {
  test("is the lock file in the directory of the entry's Lore root, with its tree prefix", () => {
    const { model, placeOf } = parseWithContext(toInput(example({
      ".lore/a.lore": rule("file: docs/review.md", "root-rule"),
      "apps/web/.loreconfig": "root: true\n",
      "apps/web/.lore/b.lore": rule("file: docs/review.md", "web-rule"),
      "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/shop/.lore/c.lore": rule("file: docs/review.md", "shared-rule"),
    })));
    const refs = Object.fromEntries(model.entries.map((entry) => [entry.id, lockPathFor(placeOf.get(entry)!)]));
    expect(refs).toEqual({
      "root-rule": { tree: "repo", path: "lore-reviews.lock" },
      "web-rule": { tree: "repo", path: "apps/web/lore-reviews.lock" },
      "shared-rule": { tree: 0, path: "external:lore/shop/lore-reviews.lock" },
    });
  });
});

describe("lock files of different repositories", () => {
  test("a lock file at the same path in two repositories is told apart by its tree", () => {
    const folder = (repository: string, id: string) => ({
      folder: "", repository,
      files: [
        { path: ".loreconfig", content: "repo: github.com/acme/shop\n" },
        { path: ".lore/a.lore", content: rule("file: /docs/review.md", id) },
      ],
    });
    const parsed = parseWithContext({
      repo: [{ path: "docs/review.md", content: DOC }],
      given: [folder("/work/a", "a-rule"), folder("/work/b", "b-rule")],
      remotes: ["https://github.com/acme/shop"],
    });
    const refs = parsed.model.entries.map((entry) => lockPathFor(parsed.placeOf.get(entry)!));
    expect(refs).toEqual([{ tree: 0, path: "external:lore-reviews.lock" }, { tree: 1, path: "external:lore-reviews.lock" }]);
    expect(lockRefs(parsed)).toEqual(refs);
    const locks = parsed.model.entries.map((entry, n) => ({ ...refs[n]!, records: [record(source(), { rule: entry.id })] }));
    const result = audit(parsed, { today: "2026-11-12", readSource: (_place, file) => (file === "docs/review.md" ? DOC : null), locks });
    expect(result.findings).toEqual([]);
    expect(result.summary).toEqual({ counts: {}, rulesWithSource: 2, rulesWithoutSource: 0 });
  });
});
