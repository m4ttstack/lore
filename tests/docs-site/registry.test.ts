import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { splitSpec } from "../../site/scripts/spec";
import { errorsPage, schemaPages, type RegistryEntry } from "../../site/scripts/registry";

const registry: RegistryEntry[] = JSON.parse(readFileSync("spec/errors.json", "utf8"));
const page = splitSpec(readFileSync("spec/SPEC.md", "utf8"), { ref: "main" }).find((p) => p.id === "errors-and-warnings")!;

describe("errorsPage", () => {
  test("one heading per code, errors first", () => {
    const body = errorsPage(page, registry).body;
    for (const e of registry) expect(body).toContain(`### ${e.name} {#${e.name}}`);
    expect(body.indexOf("{#unreadable-structure}")).toBeLessThan(body.indexOf(`{#${registry.find((e) => e.kind === "warning")!.name}}`));
    expect(body).not.toContain("| Name | Kind | Description |");
  });
  test("short table of contents", () => {
    expect(errorsPage(page, registry).body).toMatch(/^toc_max_heading_level: 2$/m);
  });
  test("drift fails, naming the code", () => {
    const drifted = registry.map((e, i) => (i === 2 ? { ...e, description: "changed" } : e));
    expect(() => errorsPage(page, drifted)).toThrow(registry[2]!.name);
  });
  test("a code missing from the registry fails", () => {
    expect(() => errorsPage(page, registry.slice(0, -1))).toThrow(registry.at(-1)!.name);
  });
});

describe("schemaPages", () => {
  const files = readdirSync("spec/schemas").map((f) => ({ file: f, json: readFileSync(`spec/schemas/${f}`, "utf8") }));
  test("a page per schema plus an index", () => {
    const pages = schemaPages(files);
    expect(pages.map((p) => p.id).sort()).toEqual([...files.map((f) => f.file.replace(".schema.json", "")), "index"].sort());
    expect(pages.find((p) => p.id === "audit")!.title).toBe("Lore audit result");
  });
  test("the index links each schema page by title", () => {
    const index = schemaPages(files).find((p) => p.id === "index")!;
    expect(index.body).toContain("[Lore audit result](./audit.md)");
  });
});
