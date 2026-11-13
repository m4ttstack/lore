import { describe, expect, test } from "bun:test";
import type { Example, ExampleFile } from "../../../tools/check/extract";
import { audit, lockPathFor, lockRefs, lockRefsHolding, type AuditOptions, type Finding } from "../src/audit";
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
    expect(result).toEqual({ findings: [], summary: { counts: {}, rulesWithSource: 1, rulesWithoutSource: 0 }, excluded: [], unjudged: [] });
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

  test("a withheld lock file reports no orphan-review, and its live records are still used", () => {
    const gone = record(AT_HEADING, { rule: "price-from-quote" });
    const files = { [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING), gone) };
    expect(run(files).findings.map((f) => f.name)).toEqual(["orphan-review"]);
    expect(run(files, { withheld: [{ repository: "repo", path: LOCK, reason: ".lore/linked.lore could not be read" }] }).findings).toEqual([]);
    expect(run(files, { withheld: [{ repository: 0, path: LOCK, reason: "external:.lore/linked.lore could not be read" }] }).findings.map((f) => f.name)).toEqual(["orphan-review"]);
  });

  test("two matching headings are ambiguous-heading, not source-missing", () => {
    const doc = "## Money is integer minor units\n\nCents.\n\n## money is integer minor units\n\nAlso cents.\n";
    const result = run({ [LORE]: rule(HEADING), "docs/review.md": doc, [LOCK]: lock(record(AT_HEADING, {}, doc)) });
    expect(result.findings).toEqual([finding({ name: "ambiguous-heading", level: "warn", source: AT_HEADING })]);
  });

  test("a meta source key without a <source> block is meta-source, off by default", () => {
    const lore = `<rule id="${ID}" category="functional_correctness">\n<meta>\nsource: https://wiki.example.com/money\n</meta>\nAmounts are integers.\n</rule>\n`;
    expect(run({ [LORE]: lore })).toEqual({ findings: [], summary: { counts: {}, rulesWithSource: 0, rulesWithoutSource: 1 }, excluded: [], unjudged: [] });
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

  describe("a .loreconfig error that may hide Lore files keeps every record of the Lore root that could hold them", () => {
    const WEB = record(source({ file: "docs/review.md" }), { rule: "web-rule" });
    const GONE = record(AT_HEADING, { rule: "gone-rule" });
    const names = (files: Record<string, string>) => run(files).findings.map((f) => [f.name, f.rule, f.file]);

    test("repo-inside-repo, which excludes its directory", () => {
      const files = {
        [LORE]: rule(HEADING),
        "apps/web/.loreconfig": "repo: github.com/acme/shop\n",
        "apps/web/.lore/web.lore": rule("file: /docs/review.md", "web-rule"),
        "docs/review.md": DOC,
        [LOCK]: lock(record(AT_HEADING), WEB, GONE),
      };
      expect(names(files)).toEqual([]);
      expect(run(files).excluded.map((d) => d.name)).toEqual(["repo-inside-repo"]);
    });

    test("nested-repo, which excludes its directory in an external folder", () => {
      const files = {
        "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
        "external:lore/shop/.lore/a.lore": rule("file: /docs/review.md\nheading: Money is integer minor units"),
        "external:lore/shop/apps/web/.loreconfig": "repo: github.com/acme/web\n",
        "external:lore/shop/apps/web/.lore/web.lore": rule("file: /docs/review.md", "web-rule"),
        "docs/review.md": DOC,
        "external:lore/shop/lore-reviews.lock": lock(record(AT_HEADING), WEB, GONE),
      };
      expect(names(files)).toEqual([]);
    });

    test("invalid-loreconfig in a given folder's repository, which marks nothing, under a shared Lore root", () => {
      const files = {
        "external:lore/.loreconfig": "root: true\n",
        "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
        "external:lore/shop/.lore/a.lore": rule("file: /docs/review.md\nheading: Money is integer minor units"),
        "external:lore/web/.loreconfig": "repo: github.com/acme/shop\nroot: yes\n",
        "external:lore/web/.lore/web.lore": rule("file: /docs/review.md", "web-rule"),
        "docs/review.md": DOC,
        "external:lore/lore-reviews.lock": lock(record(AT_HEADING), WEB, GONE),
      };
      expect(names(files)).toEqual([]);
    });

    test("not invalid-loreconfig in the governed repo, which leaves every Lore file collected", () => {
      const files = {
        [LORE]: rule(HEADING),
        "apps/web/.loreconfig": "root: yes\n",
        "apps/web/.lore/web.lore": rule("file: /docs/review.md", "web-rule"),
        "docs/review.md": DOC,
        [LOCK]: lock(record(AT_HEADING), WEB, GONE),
      };
      expect(names(files)).toEqual([["orphan-review", "gone-rule", LOCK]]);
    });
  });
});

describe("records are orphans only when the run collected the whole Lore root of their lock file", () => {
  const SHOP = record(source(), { rule: "shop-rule" });
  const WEB = record(source(), { rule: "web-rule" });
  const BLOG = record(source(), { rule: "blog-rule" });
  const GONE = record(source(), { rule: "gone-rule" });
  const SHARED = "external:lore/lore-reviews.lock";
  const shared = {
    "external:lore/.loreconfig": "root: true\n",
    "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
    "external:lore/shop/.lore/a.lore": rule("file: /docs/review.md", "shop-rule"),
    "docs/review.md": DOC,
  };
  const orphans = (result: ReturnType<typeof audit>) => result.findings.filter((f) => f.name === "orphan-review").map((f) => f.rule);

  test("a folder marked for another repository under the Lore root keeps every record, and the audit says why", () => {
    const result = run({
      ...shared,
      "external:lore/web/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/web/.lore/b.lore": rule("file: /docs/review.md", "web-rule"),
      "external:lore/blog/.loreconfig": "repo: github.com/acme/blog\n",
      "external:lore/blog/.lore/c.lore": rule("file: /docs/review.md", "blog-rule"),
      [SHARED]: lock(SHOP, WEB, BLOG, GONE),
    });
    expect(result.findings).toEqual([]);
    expect(result.unjudged).toEqual([{ file: SHARED, reason: "external:lore/blog/.loreconfig names another repository" }]);
  });

  test("a Lore root the given folders hold only part of keeps every record", () => {
    const files = [
      { path: "lore/.loreconfig", content: "root: true\n" },
      { path: "lore/shop/.loreconfig", content: "repo: github.com/acme/shop\n" },
      { path: "lore/shop/.lore/a.lore", content: rule("file: /docs/review.md", "shop-rule") },
      { path: "lore/web/.loreconfig", content: "repo: github.com/acme/shop\n" },
      { path: "lore/web/.lore/b.lore", content: rule("file: /docs/review.md", "web-rule") },
    ];
    const audited = (folder: string) => {
      const parsed = parseWithContext({
        repo: [{ path: "docs/review.md", content: DOC }], given: [{ folder, repository: "/work/team", files }], remotes: ["https://github.com/acme/shop"],
      });
      const locks = [{ repository: 0, path: SHARED, records: [SHOP, WEB, GONE] }];
      return audit(parsed, { today: "2026-11-12", readSource: (_place, file) => (file === "docs/review.md" ? DOC : null), locks });
    };
    expect(orphans(audited("lore/shop"))).toEqual([]);
    expect(audited("lore/shop").unjudged).toEqual([{ file: SHARED, reason: "the given folders hold only part of its Lore root" }]);
    expect(orphans(audited("lore"))).toEqual(["gone-rule"]);
    expect(audited("lore").unjudged).toEqual([]);
  });

  test("nested-repo below a folder marked for another repository keeps every record", () => {
    const result = run({
      ...shared,
      "external:lore/apps/.loreconfig": "repo: github.com/acme/blog\n",
      "external:lore/apps/web/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/apps/web/.lore/b.lore": rule("file: /docs/review.md", "web-rule"),
      [SHARED]: lock(SHOP, WEB, GONE),
    });
    expect(result.excluded.map((d) => [d.name, d.file])).toEqual([["nested-repo", "external:lore/apps/web/.loreconfig"]]);
    expect(result.findings).toEqual([]);
    expect(result.unjudged).toEqual([{ file: SHARED, reason: "external:lore/apps/.loreconfig names another repository" }]);
  });

  test("invalid-loreconfig below a folder marked for another repository keeps every record", () => {
    const result = run({
      ...shared,
      "external:lore/apps/.loreconfig": "repo: github.com/acme/blog\n",
      "external:lore/apps/web/.loreconfig": "repo: github.com/acme/shop\nroot: yes\n",
      "external:lore/apps/web/.lore/b.lore": rule("file: /docs/review.md", "web-rule"),
      [SHARED]: lock(SHOP, WEB, GONE),
    });
    expect(result.excluded.map((d) => [d.name, d.file])).toEqual([["invalid-loreconfig", "external:lore/apps/web/.loreconfig"]]);
    expect(result.findings).toEqual([]);
  });

  test("a wholly collected Lore root still reports a real orphan, in the governed repo and in a given folder", () => {
    const governed = run({ [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING), GONE) });
    expect(orphans(governed)).toEqual(["gone-rule"]);
    expect(governed.unjudged).toEqual([]);
    const given = run({
      ...shared,
      "external:lore/web/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/web/.lore/b.lore": rule("file: /docs/review.md", "web-rule"),
      [SHARED]: lock(SHOP, WEB, GONE),
    });
    expect(orphans(given)).toEqual(["gone-rule"]);
    expect(given.unjudged).toEqual([]);
  });

  test("a Lore file under the Lore root in no directory marked for this repository keeps every record", () => {
    const result = run({
      ...shared,
      "external:lore/own/.lore/t.lore": rule("file: /docs/review.md", "team-rule"),
      [SHARED]: lock(SHOP, record(source(), { rule: "team-rule" }), GONE),
    });
    expect(result.findings).toEqual([]);
    expect(result.unjudged).toEqual([{ file: SHARED, reason: "external:lore/own/.lore/t.lore is in no directory marked for this repository" }]);
  });

  test("the governed repo given as a folder judges neither view of its lock file", () => {
    const files = [
      { path: "docs/review.md", content: DOC },
      { path: "lore/.loreconfig", content: "root: true\n" },
      { path: "lore/a/.loreconfig", content: "repo: github.com/acme/shop\n" },
      { path: "lore/a/.lore/r.lore", content: rule("file: /docs/review.md", "a-rule") },
      { path: "lore/b/.lore/r.lore", content: rule("file: /docs/review.md", "b-rule") },
    ];
    const parsed = parseWithContext({ repo: files, given: [{ folder: "lore", repository: "/work/shop", files }], remotes: ["https://github.com/acme/shop"] });
    const records = [record(source(), { rule: "a-rule" }), record(source(), { rule: "b-rule" }), GONE];
    const locks = [{ repository: "repo" as const, path: "lore/lore-reviews.lock", records }, { repository: 0, path: SHARED, records }];
    const result = audit(parsed, { today: "2026-11-12", readSource: (_place, file) => (file === "docs/review.md" ? DOC : null), locks });
    expect(orphans(result)).toEqual([]);
    expect(result.unjudged).toEqual([
      { file: SHARED, reason: "external:lore/b/.lore/r.lore is in no directory marked for this repository" },
      { file: "lore/lore-reviews.lock", reason: "an error in lore/a/.loreconfig may hide rules" },
    ]);
  });

  test("an error that hides rules is the reason, and a lock file whose records all match has no entry", () => {
    const hidden = run({ [LORE]: rule(HEADING), ".lore/bad.lore": "<rule id=\"x\">\n", "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING), GONE) });
    expect(hidden.unjudged).toEqual([{ file: LOCK, reason: "an error in .lore/bad.lore may hide rules" }]);
    const clean = run({ [LORE]: rule(HEADING), ".lore/bad.lore": "<rule id=\"x\">\n", "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING)) });
    expect(clean.unjudged).toEqual([]);
    const unread = run({ [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING), GONE) }, {
      withheld: [{ repository: "repo", path: LOCK, reason: ".lore/linked.lore could not be read" }],
    });
    expect(unread.unjudged).toEqual([{ file: LOCK, reason: ".lore/linked.lore could not be read" }]);
  });
});

describe("lockPathFor", () => {
  test("is the lock file in the directory of the entry's Lore root, with its prefix, in the entry's repository", () => {
    const { model, placeOf, collected } = parseWithContext(toInput(example({
      ".lore/a.lore": rule("file: docs/review.md", "root-rule"),
      "apps/web/.loreconfig": "root: true\n",
      "apps/web/.lore/b.lore": rule("file: docs/review.md", "web-rule"),
      "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/shop/.lore/c.lore": rule("file: docs/review.md", "shared-rule"),
    })));
    const refs = Object.fromEntries(model.entries.map((entry) => [entry.id, lockPathFor(collected, placeOf.get(entry)!)]));
    expect(refs).toEqual({
      "root-rule": { repository: "repo", path: "lore-reviews.lock" },
      "web-rule": { repository: "repo", path: "apps/web/lore-reviews.lock" },
      "shared-rule": { repository: 0, path: "external:lore/shop/lore-reviews.lock" },
    });
  });
});

describe("lockRefsHolding", () => {
  test("is the lock file of the Lore root that would hold a file, in its repository", () => {
    const { collected } = parseWithContext(toInput(example({
      ".lore/a.lore": rule("file: docs/review.md", "root-rule"),
      "apps/web/.loreconfig": "root: true\n",
      "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/shop/.lore/c.lore": rule("file: docs/review.md", "shared-rule"),
    })));
    expect(lockRefsHolding(collected, ".lore/gone.lore", "repo")).toEqual([{ repository: "repo", path: LOCK }]);
    expect(lockRefsHolding(collected, "apps/web/.lore/gone.lore", "repo")).toEqual([{ repository: "repo", path: "apps/web/lore-reviews.lock" }]);
    expect(lockRefsHolding(collected, "apps/web/.loreconfig", "repo")).toEqual([{ repository: "repo", path: "apps/web/lore-reviews.lock" }]);
    expect(lockRefsHolding(collected, "external:lore/shop/.lore/gone.lore", 0)).toEqual([{ repository: 0, path: "external:lore/shop/lore-reviews.lock" }]);
    expect(lockRefsHolding(collected, "external:lore/other/.lore/gone.lore", 0)).toEqual([]);
  });

  test("names, for a .loreconfig no tree reaches, the lock file its directory's Lore root would have if it were marked", () => {
    const { collected } = parseWithContext(toInput(example({
      "external:lore/.loreconfig": "root: true\n",
      "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/shop/.lore/c.lore": rule("file: docs/review.md", "shared-rule"),
    })));
    expect(lockRefsHolding(collected, "external:lore/web/.loreconfig", 0)).toEqual([{ repository: 0, path: "external:lore/lore-reviews.lock" }]);
    expect(lockRefsHolding(collected, "external:lore/web/.lore/gone.lore", 0)).toEqual([]);
  });
});

describe("external folders of one repository under one Lore root", () => {
  test("share one lock file, whose records belong to the rules of both", () => {
    const files = {
      "external:lore/.loreconfig": "root: true\n",
      "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/shop/.lore/a.lore": rule("file: /docs/review.md", "shop-rule"),
      "external:lore/web/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/web/.lore/b.lore": rule("file: /docs/review.md", "web-rule"),
      "docs/review.md": DOC,
      "external:lore/lore-reviews.lock": lock(record(source(), { rule: "shop-rule" }), record(source(), { rule: "web-rule" })),
    };
    const parsed = parseWithContext(toInput(example(files)));
    expect(lockRefs(parsed)).toEqual([{ repository: 0, path: "external:lore/lore-reviews.lock" }]);
    expect(run(files)).toEqual({ findings: [], summary: { counts: {}, rulesWithSource: 2, rulesWithoutSource: 0 }, excluded: [], unjudged: [] });
  });
});

describe("lock files of different repositories", () => {
  test("a lock file at the same path in two repositories is told apart by its repository", () => {
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
    const refs = parsed.model.entries.map((entry) => lockPathFor(parsed.collected, parsed.placeOf.get(entry)!));
    expect(refs).toEqual([{ repository: 0, path: "external:lore-reviews.lock" }, { repository: 1, path: "external:lore-reviews.lock" }]);
    expect(lockRefs(parsed)).toEqual(refs);
    const locks = parsed.model.entries.map((entry, n) => ({ ...refs[n]!, records: [record(source(), { rule: entry.id })] }));
    const result = audit(parsed, { today: "2026-11-12", readSource: (_place, file) => (file === "docs/review.md" ? DOC : null), locks });
    expect(result.findings).toEqual([]);
    expect(result.summary).toEqual({ counts: {}, rulesWithSource: 2, rulesWithoutSource: 0 });
  });
});
