import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractExamples, type Example } from "../tools/check/extract";

interface FixtureInfo {
  example: number | null;
  kind: string;
  path: string;
  errors: string[];
}

const root = join(import.meta.dir, "..");
const out = join(root, "test", "fixtures");
const GENERATED = /^(example-\d+-\d+|readme-\d+)\.lore$/;

interface Diagnostic { name: string; file: string }

function errorNames(example: Example, path: string): string[] {
  if (example.expect === null) return [];
  const expect = JSON.parse(example.expect) as { errors?: Diagnostic[]; excluded?: Diagnostic[] };
  const diagnostics = example.kind === "eligibility" ? expect.excluded ?? [] : expect.errors ?? [];
  return diagnostics.filter((d) => d.file === path).map((d) => d.name);
}

export function readmeSamples(readme: string): string[] {
  const open = "```html\n";
  const samples: string[] = [];
  for (let start = readme.indexOf(open); start !== -1; start = readme.indexOf(open, start)) {
    start += open.length;
    const end = readme.indexOf("\n```", start);
    if (end === -1) break;
    samples.push(readme.slice(start, end) + "\n");
    start = end;
  }
  return samples;
}

function writeFixtures(): void {
  const fixtures = new Map<string, { content: string; info: FixtureInfo }>();

  for (const example of extractExamples(readFileSync(join(root, "spec", "SPEC.md"), "utf8"))) {
    const lore = example.files.filter((file) => file.path.endsWith(".lore"));
    lore.forEach((file, i) => {
      fixtures.set(`example-${example.number}-${i + 1}.lore`, {
        content: file.content,
        info: { example: example.number, kind: example.kind, path: file.path, errors: errorNames(example, file.path) },
      });
    });
  }

  readmeSamples(readFileSync(join(root, "README.md"), "utf8")).forEach((content, i) => {
    fixtures.set(`readme-${i + 1}.lore`, { content, info: { example: null, kind: "readme", path: "README.md", errors: [] } });
  });

  mkdirSync(out, { recursive: true });
  for (const name of readdirSync(out)) if (GENERATED.test(name)) rmSync(join(out, name));
  const index: Record<string, FixtureInfo> = {};
  for (const [name, { content, info }] of fixtures) {
    writeFileSync(join(out, name), content);
    index[name] = info;
  }
  writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 2) + "\n");
  console.log(`wrote ${fixtures.size} fixtures to test/fixtures`);
}

if (import.meta.main) writeFixtures();
