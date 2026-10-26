import { expect, test } from "bun:test";
import Ajv from "ajv/dist/2020";
import { parse } from "yaml";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../spec/schemas/", import.meta.url);
const ajv = new Ajv({ allErrors: true, strict: true });
for (const f of readdirSync(dir).filter((f) => f.endsWith(".schema.json"))) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
}

function check(name: string, yamlText: string): boolean {
  const validate = ajv.getSchema(`https://lore.dev/schemas/v1/${name}.schema.json`);
  if (!validate) throw new Error(`schema ${name} not loaded`);
  return validate(parse(yamlText, { version: "1.2" })) as boolean;
}
const valid = (name: string, text: string) => expect(check(name, text)).toBe(true);
const invalid = (name: string, text: string) => expect(check(name, text)).toBe(false);

test("defaults accepts category and severity", () => valid("defaults", "category: functional_correctness\nseverity: blocking"));
test("defaults rejects an unknown severity", () => invalid("defaults", "severity: critical"));
test("defaults rejects a kebab category", () => invalid("defaults", "category: data-provenance"));
test("scope rejects an empty files list", () => invalid("scope", "files: []"));
test("scope rejects a leading slash", () => invalid("scope", 'files: ["/apps/**"]'));
test("scope rejects a .. segment", () => invalid("scope", 'files: ["../x/**"]'));
test("when accepts the four keys", () => valid("when", 'addedContains: ["a"]\naddedMatches: ["b"]\nchanged: ["c"]\nunchanged: ["/d/**"]'));
test("when rejects an unknown key", () => invalid("when", 'diffContains: ["a"]'));
test("when rejects an empty mapping", () => invalid("when", "{}"));
test("meta accepts any mapping", () => valid("meta", "source: x\nowner: y\nrefs: [1, 2]"));
test("meta rejects a scalar", () => invalid("meta", "hello"));
test("loreconfig accepts every key", () => valid("loreconfig", "lore: 1\nroot: true\nrepo: github.com/acme/shop\ncategories: [data_provenance]\ndisable: [currency-from-settings]"));
test("loreconfig rejects lore: 2", () => invalid("loreconfig", "lore: 2"));
test("loreconfig rejects a bad repo", () => invalid("loreconfig", "repo: https://github.com/acme/shop.git"));
test("loreconfig rejects a trailing .git", () => invalid("loreconfig", "repo: github.com/acme/shop.git"));
test("when rejects .. in unchanged", () => invalid("when", 'unchanged: ["../x/**"]'));
test("JSON input parses to the same value as YAML", () => valid("scope", '{ "files": ["**/*.ts"] }'));
test("every registry entry has a unique kebab name", () => {
  const entries = JSON.parse(readFileSync(new URL("../spec/errors.json", import.meta.url), "utf8")) as {
    name: string;
    kind: string;
    description: string;
  }[];
  const names = entries.map((e) => e.name);
  expect(new Set(names).size).toBe(names.length);
  for (const e of entries) {
    expect(e.name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(["error", "warning"]).toContain(e.kind);
    expect(e.description.length).toBeGreaterThan(0);
  }
});
