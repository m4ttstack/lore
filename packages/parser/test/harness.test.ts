import { expect, test } from "bun:test";
import type { Example } from "../../../tools/check/extract";
import { parseWithContext } from "../src/model";
import { auditOptions, toChange, toInput } from "./harness";

function example(over: Partial<Example>): Example {
  return { number: 1, kind: "parse", section: "", line: 1, requires: [], files: [], remote: null, diff: null, today: null, expect: null, ...over };
}

test("toInput puts external: files in one given folder with the prefix stripped and folder \"\"", () => {
  const input = toInput(example({
    files: [
      { path: ".lore/a.lore", place: "repo", content: "a" },
      { path: "external:shop/.loreconfig", place: "external", content: "b" },
    ],
  }));
  expect(input.repo).toEqual([{ path: ".lore/a.lore", content: "a" }]);
  expect(input.given).toEqual([{ folder: "", files: [{ path: "shop/.loreconfig", content: "b" }] }]);
});

test("toInput puts rules: files in input.rules with the prefix stripped, only when there are some", () => {
  const input = toInput(example({
    files: [
      { path: ".lore/a.lore", place: "repo", content: "a" },
      { path: "rules:.lore/a.lore", place: "rules", content: "b" },
    ],
  }));
  expect(input.repo).toEqual([{ path: ".lore/a.lore", content: "a" }]);
  expect(input.rules).toEqual([{ path: ".lore/a.lore", content: "b" }]);
  expect("rules" in toInput(example({ files: [{ path: "a", place: "repo", content: "a" }] }))).toBe(false);
});

test("toInput uses https://github.com/acme/shop when the example has no remote", () => {
  expect(toInput(example({})).remotes).toEqual(["https://github.com/acme/shop"]);
  expect(toInput(example({ remote: "git@github.com:Acme/shop.git" })).remotes).toEqual(["git@github.com:Acme/shop.git"]);
});

test("toChange reads A, M, D and R lines and their + lines", () => {
  const change = toChange(["A a.ts", "+1 one", "M b.ts", "+2 two", "+5 five", "D c.ts", "R a -> b", "+3 x"].join("\n"));
  expect(change.files).toEqual([
    { kind: "A", path: "a.ts", added: [{ line: 1, text: "one" }], removed: [] },
    { kind: "M", path: "b.ts", added: [{ line: 2, text: "two" }, { line: 5, text: "five" }], removed: [] },
    { kind: "D", path: "c.ts", added: [], removed: [] },
    { kind: "R", oldPath: "a", path: "b", added: [{ line: 3, text: "x" }], removed: [] },
  ]);
});

test("toChange reads - lines onto the current file, never an added one", () => {
  const change = toChange(["M b.ts", "-2 two", "+2 deux", "D c.ts", "-1 one", "-2"].join("\n"));
  expect(change.files).toEqual([
    { kind: "M", path: "b.ts", added: [{ line: 2, text: "deux" }], removed: [{ line: 2, text: "two" }] },
    { kind: "D", path: "c.ts", added: [], removed: [{ line: 1, text: "one" }, { line: 2, text: "" }] },
  ]);
  expect(() => toChange(["A a.ts", "-1 one"].join("\n"))).toThrow("removed line in an added file: -1 one");
});

test("auditOptions reads each lock file at a Lore root with its repository, reads absent files as null and rejects a malformed lock", () => {
  const record = '{"rule":"a","file":"docs/a.md","heading":null,"phrase":null,"reviewed":"2026-11-01","hash":"3fa9c1d2e7b4"}';
  const ex = example({
    today: "2026-11-12",
    files: [
      { path: ".lore/a.lore", place: "repo", content: '<rule id="a" category="security">\nA.\n</rule>\n' },
      { path: "docs/a.md", place: "repo", content: "# A" },
      { path: "lore-reviews.lock", place: "repo", content: `{"lore-reviews":1}\n${record}` },
      { path: "docs/lore-reviews.lock", place: "repo", content: '{"lore-reviews":1}' },
      { path: "external:lore/.loreconfig", place: "external", content: "repo: github.com/acme/shop\n" },
      { path: "external:lore/.lore/b.lore", place: "external", content: '<rule id="b" category="security">\nB.\n</rule>\n' },
      { path: "external:lore/lore-reviews.lock", place: "external", content: '{"lore-reviews":1}' },
    ],
  });
  const options = auditOptions(ex, parseWithContext(toInput(ex)));
  expect(options.today).toBe("2026-11-12");
  expect(options.locks.map(({ repository, path, records }) => [repository, path, records.map((r) => r.rule)])).toEqual([
    ["repo", "lore-reviews.lock", ["a"]],
    [0, "external:lore/lore-reviews.lock", []],
  ]);
  expect(options.readSource({} as never, "docs/a.md")).toBe("# A");
  expect(options.readSource({} as never, "docs/b.md")).toBeNull();
  const broken = example({ files: [{ path: "lore-reviews.lock", place: "repo", content: "{}" }] });
  expect(() => auditOptions(broken, parseWithContext(toInput(broken)))).toThrow("lore-reviews.lock:1");
});
