import { existsSync, readFileSync } from "node:fs";
import { checkSpec, specSections, type RegistryEntry, type SchemaName, type SchemaSet } from "./check";
import { extractExamples } from "./extract";

const spec = new URL("../../spec/", import.meta.url);
const specPath = new URL("SPEC.md", spec);
const schemaNames: SchemaName[] = ["defaults", "scope", "when", "meta", "loreconfig", "document-model", "eligibility"];

if (!existsSync(specPath)) {
  console.error("spec/SPEC.md not found");
  process.exit(1);
}

const readJson = (url: URL) => JSON.parse(readFileSync(url, "utf8"));
const markdown = readFileSync(specPath, "utf8");
const registry = readJson(new URL("errors.json", spec)) as RegistryEntry[];
const schemas = Object.fromEntries(schemaNames.map((n) => [n, readJson(new URL(`schemas/${n}.schema.json`, spec))])) as SchemaSet;

const agentPath = new URL("AGENT.md", spec);
const agent = existsSync(agentPath) ? readFileSync(agentPath, "utf8") : undefined;
const problems = checkSpec({ markdown, registry, schemas, agent });
if (problems.length > 0) {
  for (const p of problems) console.error(`SPEC.md:${p.line} ${p.rule}: ${p.message}`);
  process.exit(1);
}

const examples = extractExamples(markdown);
const covered = specSections(markdown, examples).filter((s) => !s.exempt && s.examples > 0).length;
console.log(`${examples.length} examples, ${covered} sections covered`);
