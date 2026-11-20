import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const DIR = "site/docs/reference/format";
const PAGES: Record<string, string> = { when: "when", scope: "scope", defaults: "defaults", loreconfig: "loreconfig" };

describe("format reference coverage", () => {
  for (const [schema, page] of Object.entries(PAGES)) {
    test(`every ${schema}.schema.json key has a heading on ${page}.md`, () => {
      const keys = Object.keys(JSON.parse(readFileSync(`spec/schemas/${schema}.schema.json`, "utf8")).properties);
      expect(keys.length).toBeGreaterThan(0);
      expect(existsSync(`${DIR}/${page}.md`), `${DIR}/${page}.md`).toBe(true);
      const body = readFileSync(`${DIR}/${page}.md`, "utf8");
      for (const key of keys) expect(body, `${page}.md has no heading for ${key}`).toMatch(new RegExp(`^### \`${key}\``, "m"));
    });
  }
});
