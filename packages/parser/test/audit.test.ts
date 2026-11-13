import { describe, expect, test } from "bun:test";
import type { Example, ExampleFile } from "../../../tools/check/extract";
import { audit, lockPathFor, lockRefHolding, lockRefs, type AuditOptions, type Finding } from "../src/audit";
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

function example(files: Record<string, string>, remote: string | null = null): Example {
  return {
    number: 1, kind: "audit", section: "", line: 1, requires: [], remote, diff: null, expect: null, today: "2026-11-12",
    files: Object.entries(files).map(([path, content]) => ({ path, place: placeOf(path), content })),
  };
}

function run(files: Record<string, string>, options: Partial<AuditOptions> = {}, remote: string | null = null) {
  const ex = example(files, remote);
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

  test("a today that is not a real date written YYYY-MM-DD is refused", () => {
    const files = { [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING)) };
    for (const today of ["2026-02-31", "2026-13-01", "2026-11-12T00:00", "12 November 2026"]) {
      expect(() => run(files, { today })).toThrow(`today must be a real date written YYYY-MM-DD, not ${today}`);
    }
    expect(run(files, { today: "2028-02-29" }).findings).toEqual([]);
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

  test("the settings of the rule's own Lore file apply, and an orphan takes its lock file's directory's", () => {
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

  describe("a directory repo-inside-repo excludes covers its own Lore files, so it hides none of an outer lock file's rules", () => {
    const WEB = record(source({ file: "docs/review.md" }), { rule: "web-rule" });
    const GONE = record(AT_HEADING, { rule: "gone-rule" });
    const names = (files: Record<string, string>) => run(files).findings.map((f) => [f.name, f.rule, f.file]);

    test("repo-inside-repo in the governed repo", () => {
      const files = {
        [LORE]: rule(HEADING),
        "apps/web/.loreconfig": "repo: github.com/acme/shop\n",
        "apps/web/.lore/web.lore": rule("file: /docs/review.md", "web-rule"),
        "docs/review.md": DOC,
        [LOCK]: lock(record(AT_HEADING), WEB, GONE),
      };
      expect(names(files)).toEqual([["orphan-review", "gone-rule", LOCK], ["orphan-review", "web-rule", LOCK]]);
      expect(run(files).excluded.map((d) => d.name)).toEqual(["repo-inside-repo"]);
      expect(run(files).unjudged).toEqual([]);
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

  describe("nested-repo below a marked directory may hide rules from the lock file they would have without the key", () => {
    const WEB = record(source({ file: "docs/review.md" }), { rule: "web-rule" });
    const GONE = record(AT_HEADING, { rule: "gone-rule" });
    const SHOP_LOCK = "external:lore/shop/lore-reviews.lock";
    const shop = {
      "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/shop/.lore/a.lore": rule("file: /docs/review.md\nheading: Money is integer minor units"),
      "external:lore/shop/apps/web/.loreconfig": "repo: github.com/acme/web\n",
      "external:lore/shop/apps/web/.lore/web.lore": rule("file: /docs/review.md", "web-rule"),
      "docs/review.md": DOC,
      [SHOP_LOCK]: lock(record(AT_HEADING), WEB, GONE),
    };
    const hides = "an error in external:lore/shop/apps/web/.loreconfig may hide rules";

    test("the marked directory's lock file is not judged", () => {
      const result = run(shop);
      expect(result.excluded.map((d) => [d.name, d.file])).toEqual([["nested-repo", "external:lore/shop/apps/web/.loreconfig"]]);
      expect(result.findings).toEqual([]);
      expect(result.unjudged).toEqual([{ file: SHOP_LOCK, reason: hides }]);
    });

    test("nor is the lock file of a Lore root between them, while one beside them still is", () => {
      const APPS_LOCK = "external:lore/shop/apps/lore-reviews.lock";
      const ADMIN_LOCK = "external:lore/shop/admin/lore-reviews.lock";
      const result = run({
        ...shop,
        "external:lore/shop/apps/.loreconfig": "root: true\n",
        "external:lore/shop/apps/.lore/apps.lore": rule("file: /docs/review.md", "apps-rule"),
        [APPS_LOCK]: lock(record(source(), { rule: "apps-rule" }), WEB),
        "external:lore/shop/admin/.loreconfig": "root: true\n",
        "external:lore/shop/admin/.lore/admin.lore": rule("file: /docs/review.md", "admin-rule"),
        [ADMIN_LOCK]: lock(record(source(), { rule: "admin-rule" }), GONE),
      });
      expect(result.findings.map((f) => [f.name, f.rule, f.file])).toEqual([["orphan-review", "gone-rule", ADMIN_LOCK]]);
      expect(result.unjudged).toEqual([{ file: APPS_LOCK, reason: hides }, { file: SHOP_LOCK, reason: hides }]);
    });

    test("below a directory marked for another repository it hides nothing from the governed repo's lock files", () => {
      const result = run({
        "external:lore/shop/.loreconfig": shop["external:lore/shop/.loreconfig"],
        "external:lore/shop/.lore/a.lore": shop["external:lore/shop/.lore/a.lore"],
        "external:lore/blog/.loreconfig": "repo: github.com/acme/blog\n",
        "external:lore/blog/apps/.loreconfig": "repo: github.com/acme/web\n",
        "docs/review.md": DOC,
        [SHOP_LOCK]: lock(record(AT_HEADING), GONE),
      });
      expect(result.excluded.map((d) => [d.name, d.file])).toEqual([["nested-repo", "external:lore/blog/apps/.loreconfig"]]);
      expect(result.findings.map((f) => [f.name, f.rule])).toEqual([["orphan-review", "gone-rule"]]);
      expect(result.unjudged).toEqual([]);
    });
  });
});

describe("a directory marked with repo starts a lock file's scope, as a Lore root does", () => {
  const GONE = record(source(), { rule: "gone-rule" });
  const SHOP_DUP = record(AT_HEADING, { rule: "dup" });
  const BLOG_DUP = record(source({ heading: "Dates" }), { rule: "dup" });
  const team = {
    "external:lore/.loreconfig": "root: true\naudit:\n  levels:\n    orphan-review: error\n",
    "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
    "external:lore/shop/.lore/a.lore": rule("file: /docs/review.md\nheading: Money is integer minor units", "dup"),
    "external:lore/web/.loreconfig": "repo: github.com/acme/shop\naudit:\n  levels:\n    orphan-review: off\n",
    "external:lore/web/.lore/b.lore": rule("file: /docs/review.md", "web-rule"),
    "external:lore/blog/.loreconfig": "repo: github.com/acme/blog\n",
    "external:lore/blog/.lore/c.lore": rule("file: /docs/review.md\nheading: Dates", "dup"),
    "external:lore/own/.lore/t.lore": rule("file: /docs/review.md", "team-rule"),
    "docs/review.md": DOC,
    "external:lore/shop/lore-reviews.lock": lock(SHOP_DUP, GONE),
    "external:lore/web/lore-reviews.lock": lock(record(source(), { rule: "web-rule" }), GONE),
    "external:lore/blog/lore-reviews.lock": lock(BLOG_DUP, record(source(), { rule: "blog-gone" })),
    "external:lore/lore-reviews.lock": lock(record(source(), { rule: "team-rule" }), record(source(), { rule: "team-gone" })),
  };
  const shown = (result: ReturnType<typeof audit>) => result.findings.map((f) => [f.name, f.level, f.rule, f.file]);

  test("each governed repo's rules are judged against the lock files of their own marked directories", () => {
    const parsed = parseWithContext(toInput(example(team)));
    expect(lockRefs(parsed)).toEqual([
      { repository: 0, path: "external:lore/shop/lore-reviews.lock" },
      { repository: 0, path: "external:lore/web/lore-reviews.lock" },
    ]);
    const shop = run(team);
    expect(shown(shop)).toEqual([["orphan-review", "error", "gone-rule", "external:lore/shop/lore-reviews.lock"]]);
    expect(shop.unjudged).toEqual([]);
    const blog = run(team, {}, "https://github.com/acme/blog");
    expect(shown(blog)).toEqual([["orphan-review", "error", "blog-gone", "external:lore/blog/lore-reviews.lock"]]);
    expect(blog.unjudged).toEqual([]);
  });

  test("the same id in two repositories' folders has one record in each folder's lock file, and neither is never-reviewed", () => {
    for (const remote of ["https://github.com/acme/shop", "https://github.com/acme/blog"]) {
      expect(run(team, {}, remote).findings.filter((f) => f.rule === "dup")).toEqual([]);
    }
  });

  test("the rules repository's own rules, in a governed run there, are judged against the Lore root's lock file", () => {
    const files = {
      "lore/.loreconfig": "root: true\n",
      "lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "lore/shop/.lore/a.lore": rule("file: /docs/review.md\nheading: Money is integer minor units", "dup"),
      "lore/own/.lore/t.lore": rule("file: /docs/review.md", "team-rule"),
      "docs/review.md": DOC,
      "lore/lore-reviews.lock": lock(SHOP_DUP, record(source(), { rule: "team-rule" }), GONE),
    };
    const result = run(files, {}, "https://github.com/acme/team");
    expect(result.excluded.map((d) => [d.name, d.file])).toEqual([["repo-inside-repo", "lore/shop/.loreconfig"]]);
    expect(shown(result)).toEqual([
      ["orphan-review", "warn", "dup", "lore/lore-reviews.lock"],
      ["orphan-review", "warn", "gone-rule", "lore/lore-reviews.lock"],
    ]);
    expect(result.unjudged).toEqual([]);
  });

  test("a rule moved to another marked directory is never-reviewed there and leaves its record behind as an orphan", () => {
    const moved = {
      ...team,
      "external:lore/shop/.lore/a.lore": rule("file: /docs/review.md", "moved-rule"),
      "external:lore/shop/lore-reviews.lock": lock(),
      "external:lore/web/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/web/lore-reviews.lock": lock(record(source(), { rule: "web-rule" }), record(source(), { rule: "moved-rule" })),
    };
    expect(shown(run(moved))).toEqual([
      ["never-reviewed", "warn", "moved-rule", "external:lore/shop/.lore/a.lore"],
      ["orphan-review", "error", "moved-rule", "external:lore/web/lore-reviews.lock"],
    ]);
  });

  test("a rule moved within one lock file's scope keeps its record", () => {
    const moved = {
      ...team,
      "external:lore/shop/.lore/a.lore": "",
      "external:lore/shop/apps/web/.lore/a.lore": rule("file: /docs/review.md\nheading: Money is integer minor units", "dup"),
      "external:lore/shop/lore-reviews.lock": lock(SHOP_DUP),
    };
    expect(shown(run(moved))).toEqual([]);
  });

  test("a run given one marked folder reads only that folder's lock file, and judges it", () => {
    const files = [
      { path: "lore/.loreconfig", content: "root: true\n" },
      { path: "lore/shop/.loreconfig", content: "repo: github.com/acme/shop\n" },
      { path: "lore/shop/.lore/a.lore", content: rule("file: /docs/review.md", "shop-rule") },
      { path: "lore/web/.loreconfig", content: "repo: github.com/acme/shop\n" },
      { path: "lore/web/.lore/b.lore", content: rule("file: /docs/review.md", "web-rule") },
    ];
    const parsed = parseWithContext({
      repo: [{ path: "docs/review.md", content: DOC }], given: [{ folder: "lore/shop", repository: "/work/team", files }], remotes: ["https://github.com/acme/shop"],
    });
    expect(lockRefs(parsed)).toEqual([{ repository: 0, path: "external:lore/shop/lore-reviews.lock" }]);
    const locks = [
      { repository: 0, path: "external:lore/shop/lore-reviews.lock", records: [record(source(), { rule: "shop-rule" }), GONE] },
      { repository: 0, path: "external:lore/web/lore-reviews.lock", records: [record(source(), { rule: "web-rule" }), GONE] },
    ];
    const result = audit(parsed, { today: "2026-11-12", readSource: (_place, file) => (file === "docs/review.md" ? DOC : null), locks });
    expect(shown(result)).toEqual([["orphan-review", "warn", "gone-rule", "external:lore/shop/lore-reviews.lock"]]);
    expect(result.unjudged).toEqual([]);
  });

  test("a real orphan is reported in the governed repo and in a marked directory", () => {
    const governed = run({ [LORE]: rule(HEADING), "docs/review.md": DOC, [LOCK]: lock(record(AT_HEADING), GONE) });
    expect(shown(governed)).toEqual([["orphan-review", "warn", "gone-rule", LOCK]]);
    expect(governed.unjudged).toEqual([]);
  });

  test("the governed repo given as a folder reads two lock files, each judged against its own rules", () => {
    const files = [
      { path: "docs/review.md", content: DOC },
      { path: "lore/.loreconfig", content: "root: true\n" },
      { path: "lore/a/.loreconfig", content: "repo: github.com/acme/shop\n" },
      { path: "lore/a/.lore/r.lore", content: rule("file: /docs/review.md", "a-rule") },
      { path: "lore/b/.lore/r.lore", content: rule("file: /docs/review.md", "b-rule") },
    ];
    const parsed = parseWithContext({ repo: files, given: [{ folder: "lore", repository: "/work/shop", files }], remotes: ["https://github.com/acme/shop"] });
    expect(lockRefs(parsed)).toEqual([{ repository: 0, path: "external:lore/a/lore-reviews.lock" }, { repository: "repo", path: "lore/lore-reviews.lock" }]);
    const locks = [
      { repository: "repo" as const, path: "lore/lore-reviews.lock", records: [record(source(), { rule: "b-rule" }), GONE] },
      { repository: 0, path: "external:lore/a/lore-reviews.lock", records: [record(source(), { rule: "a-rule" })] },
    ];
    const result = audit(parsed, { today: "2026-11-12", readSource: (_place, file) => (file === "docs/review.md" ? DOC : null), locks });
    expect(shown(result)).toEqual([["orphan-review", "warn", "gone-rule", "lore/lore-reviews.lock"]]);
    expect(result.unjudged).toEqual([]);
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

  test("an error in a marked directory hides rules from its lock file only", () => {
    const result = run({ ...team, "external:lore/web/.lore/bad.lore": "<rule id=\"x\">\n" });
    expect(shown(result)).toEqual([["orphan-review", "error", "gone-rule", "external:lore/shop/lore-reviews.lock"]]);
    expect(result.unjudged).toEqual([{ file: "external:lore/web/lore-reviews.lock", reason: "an error in external:lore/web/.lore/bad.lore may hide rules" }]);
  });
});

describe("lockPathFor", () => {
  test("is the lock file in the nearer of the entry's Lore root and its marked directory, with its prefix, in the entry's repository", () => {
    const { model, placeOf, collected } = parseWithContext(toInput(example({
      ".lore/a.lore": rule("file: docs/review.md", "root-rule"),
      "apps/web/.loreconfig": "root: true\n",
      "apps/web/.lore/b.lore": rule("file: docs/review.md", "web-rule"),
      "external:lore/.loreconfig": "root: true\n",
      "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/shop/.lore/c.lore": rule("file: docs/review.md", "shared-rule"),
      "external:lore/shop/apps/.loreconfig": "root: true\n",
      "external:lore/shop/apps/web/.lore/d.lore": rule("file: docs/review.md", "apps-rule"),
      "external:lore/both/.loreconfig": "repo: github.com/acme/shop\nroot: true\n",
      "external:lore/both/.lore/e.lore": rule("file: docs/review.md", "both-rule"),
    })));
    const refs = Object.fromEntries(model.entries.map((entry) => [entry.id, lockPathFor(collected, placeOf.get(entry)!)]));
    expect(refs).toEqual({
      "root-rule": { repository: "repo", path: "lore-reviews.lock" },
      "web-rule": { repository: "repo", path: "apps/web/lore-reviews.lock" },
      "shared-rule": { repository: 0, path: "external:lore/shop/lore-reviews.lock" },
      "apps-rule": { repository: 0, path: "external:lore/shop/apps/lore-reviews.lock" },
      "both-rule": { repository: 0, path: "external:lore/both/lore-reviews.lock" },
    });
  });

  test("in a loose folder, a marked directory below a root: true at its top has its own lock file", () => {
    const { model, placeOf, collected } = parseWithContext(toInput(example({
      "loose:.loreconfig": "root: true\nloose: true\n",
      "loose:shop/.loreconfig": "repo: github.com/acme/shop\n",
      "loose:shop/.lore/c.lore": rule("file: docs/review.md", "shared-rule"),
    })));
    expect(lockPathFor(collected, placeOf.get(model.entries[0]!)!)).toEqual({ repository: 0, path: "loose:shop/lore-reviews.lock" });
  });
});

describe("lockRefHolding", () => {
  test("is the lock file that would cover a file, in its repository", () => {
    const { collected } = parseWithContext(toInput(example({
      ".lore/a.lore": rule("file: docs/review.md", "root-rule"),
      "apps/web/.loreconfig": "root: true\n",
      "apps/api/.loreconfig": "repo: github.com/acme/api\n",
      "external:lore/.loreconfig": "root: true\n",
      "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/shop/.lore/c.lore": rule("file: docs/review.md", "shared-rule"),
      "external:lore/shop/apps/.loreconfig": "repo: github.com/acme/web\n",
    })));
    expect(lockRefHolding(collected, ".lore/gone.lore", "repo")).toEqual({ repository: "repo", path: LOCK });
    expect(lockRefHolding(collected, "apps/web/.lore/gone.lore", "repo")).toEqual({ repository: "repo", path: "apps/web/lore-reviews.lock" });
    expect(lockRefHolding(collected, "apps/web/.loreconfig", "repo")).toEqual({ repository: "repo", path: "apps/web/lore-reviews.lock" });
    expect(lockRefHolding(collected, "external:lore/shop/.lore/gone.lore", 0)).toEqual({ repository: 0, path: "external:lore/shop/lore-reviews.lock" });
  });

  test("is null where no lock file the run reads would cover the file", () => {
    const { collected } = parseWithContext(toInput(example({
      "apps/api/.loreconfig": "repo: github.com/acme/api\n",
      "external:lore/.loreconfig": "root: true\n",
      "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/shop/.lore/c.lore": rule("file: docs/review.md", "shared-rule"),
      "external:lore/shop/apps/.loreconfig": "repo: github.com/acme/web\n",
    })));
    expect(lockRefHolding(collected, "apps/api/.lore/gone.lore", "repo")).toBeNull();
    expect(lockRefHolding(collected, "external:lore/shop/apps/.lore/gone.lore", 0)).toBeNull();
    expect(lockRefHolding(collected, "external:lore/web/.loreconfig", 0)).toBeNull();
    expect(lockRefHolding(collected, "external:lore/own/.lore/gone.lore", 0)).toBeNull();
  });
});

describe("external folders of one repository under one Lore root", () => {
  test("each have their own lock file, which holds the records of their own rules", () => {
    const files = {
      "external:lore/.loreconfig": "root: true\n",
      "external:lore/shop/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/shop/.lore/a.lore": rule("file: /docs/review.md", "shop-rule"),
      "external:lore/web/.loreconfig": "repo: github.com/acme/shop\n",
      "external:lore/web/.lore/b.lore": rule("file: /docs/review.md", "web-rule"),
      "docs/review.md": DOC,
      "external:lore/shop/lore-reviews.lock": lock(record(source(), { rule: "shop-rule" })),
      "external:lore/web/lore-reviews.lock": lock(record(source(), { rule: "web-rule" })),
    };
    const parsed = parseWithContext(toInput(example(files)));
    expect(lockRefs(parsed)).toEqual([
      { repository: 0, path: "external:lore/shop/lore-reviews.lock" },
      { repository: 0, path: "external:lore/web/lore-reviews.lock" },
    ]);
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

  test("an error in a Lore file at the same path in two repositories counts against its own repository's lock file only", () => {
    const broken = `<rule id="b-rule" category="functional_correctness" severity="fatal">\n<source>\nfile: /docs/review.md\n</source>\nB.\n</rule>\n`;
    const folder = (repository: string, lore: string) => ({
      folder: "", repository,
      files: [{ path: ".loreconfig", content: "repo: github.com/acme/shop\n" }, { path: ".lore/r.lore", content: lore }],
    });
    const at = "external:lore-reviews.lock";
    const shown = (result: ReturnType<typeof audit>) => result.findings.map((f) => [f.name, f.rule, f.source?.heading ?? null]);
    const auditOf = (second: string) => {
      const parsed = parseWithContext({
        repo: [{ path: "docs/review.md", content: DOC }],
        given: [folder("/work/a", rule("file: /docs/review.md", "a-rule")), folder("/work/b", second)],
        remotes: ["https://github.com/acme/shop"],
      });
      const locks = [
        { repository: 0, path: at, records: [record(source(), { rule: "a-rule" }), record(source(), { rule: "b-rule" }), record(source(), { rule: "gone-rule" })] },
        { repository: 1, path: at, records: [record(AT_HEADING, { rule: "b-rule" }), record(AT_HEADING, { rule: "gone-rule" })] },
      ];
      return audit(parsed, { today: "2026-11-12", readSource: (_place, file) => (file === "docs/review.md" ? DOC : null), locks });
    };

    const excluded = auditOf(broken);
    expect(excluded.excluded.map((d) => [d.name, d.file, d.entry])).toEqual([["invalid-attribute-value", "external:.lore/r.lore", "b-rule"]]);
    expect(shown(excluded)).toEqual([["orphan-review", "b-rule", null], ["orphan-review", "gone-rule", null], ["orphan-review", "gone-rule", AT_HEADING.heading]]);
    expect(excluded.unjudged).toEqual([]);

    const unreadable = auditOf("<rule id=\"x\">\n");
    expect(shown(unreadable)).toEqual([["orphan-review", "b-rule", null], ["orphan-review", "gone-rule", null]]);
    expect(unreadable.unjudged).toEqual([{ file: at, reason: "an error in external:.lore/r.lore may hide rules" }]);
  });
});
