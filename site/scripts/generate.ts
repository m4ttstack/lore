import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errorsPage, schemaPages, type RegistryEntry } from "./registry";
import { splitSpec } from "./spec";

const root = join(import.meta.dir, "..", "..");
const out = join(root, "site", "docs", "spec");
const ref = process.env.LORE_REF || "main";

const registry: RegistryEntry[] = JSON.parse(readFileSync(join(root, "spec", "errors.json"), "utf8"));
const pages = splitSpec(readFileSync(join(root, "spec", "SPEC.md"), "utf8"), { ref }).map((page) =>
  page.id === "errors-and-warnings" ? errorsPage(page, registry) : page,
);
const schemaDir = join(root, "spec", "schemas");
const schemas = schemaPages(
  readdirSync(schemaDir)
    .filter((f) => f.endsWith(".schema.json"))
    .map((file) => ({ file, json: readFileSync(join(schemaDir, file), "utf8") })),
);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "schemas"), { recursive: true });
for (const page of pages) writeFileSync(join(out, `${page.id}.md`), page.body);
for (const page of schemas) writeFileSync(join(out, "schemas", `${page.id}.md`), page.body);
writeFileSync(join(out, "schemas", "_category_.json"), `${JSON.stringify({ label: "Schemas", position: 25 }, null, 2)}\n`);

console.log(`wrote ${pages.length} spec pages and ${schemas.length} schema pages to site/docs/spec (ref ${ref})`);
