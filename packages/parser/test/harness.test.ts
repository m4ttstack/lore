import { expect, test } from "bun:test";
import type { Example } from "../../../tools/check/extract";
import { toChange, toInput } from "./harness";

function example(over: Partial<Example>): Example {
  return { number: 1, kind: "parse", section: "", line: 1, requires: [], files: [], remote: null, diff: null, expect: null, ...over };
}

test("toInput puts external: files in one given folder with the prefix stripped and folder \"\"", () => {
  const input = toInput(example({
    files: [
      { path: ".lore/a.lore", external: false, content: "a" },
      { path: "external:shop/.loreconfig", external: true, content: "b" },
    ],
  }));
  expect(input.repo).toEqual([{ path: ".lore/a.lore", content: "a" }]);
  expect(input.given).toEqual([{ folder: "", files: [{ path: "shop/.loreconfig", content: "b" }] }]);
});

test("toInput uses https://github.com/acme/shop when the example has no remote", () => {
  expect(toInput(example({})).remotes).toEqual(["https://github.com/acme/shop"]);
  expect(toInput(example({ remote: "git@github.com:Acme/shop.git" })).remotes).toEqual(["git@github.com:Acme/shop.git"]);
});

test("toChange reads A, M, D and R lines and their + lines", () => {
  const change = toChange(["A a.ts", "+1 one", "M b.ts", "+2 two", "+5 five", "D c.ts", "R a -> b", "+3 x"].join("\n"));
  expect(change.files).toEqual([
    { kind: "A", path: "a.ts", added: [{ line: 1, text: "one" }] },
    { kind: "M", path: "b.ts", added: [{ line: 2, text: "two" }, { line: 5, text: "five" }] },
    { kind: "D", path: "c.ts", added: [] },
    { kind: "R", oldPath: "a", path: "b", added: [{ line: 3, text: "x" }] },
  ]);
});
