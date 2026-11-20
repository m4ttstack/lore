import type { SpecPage } from "./spec";

export interface RegistryEntry { name: string; kind: "error" | "warning"; description: string }
export interface SchemaPage { id: string; title: string; body: string } // id: file name without .schema.json

const TABLE_HEADER = "| Name | Kind | Description |";

// Replaces the Name | Kind | Description table with one `### <name> {#<name>}` heading per code,
// errors first, then warnings, each in errors.json order. Throws if the table and the registry differ.
export function errorsPage(page: SpecPage, registry: RegistryEntry[]): SpecPage {
  const lines = page.body.split("\n");
  const start = lines.indexOf(TABLE_HEADER);
  if (start < 0) throw new Error("errors page has no Name | Kind | Description table");
  let end = start + 2;
  while (end < lines.length && lines[end]!.startsWith("|")) end++;

  const rows = lines.slice(start + 2, end).map(parseRow);
  for (let i = 0; i < Math.max(rows.length, registry.length); i++) {
    const row = rows[i];
    const entry = registry[i];
    if (row?.name !== entry?.name || row?.kind !== entry?.kind || row?.description !== entry?.description) {
      throw new Error(`spec/errors.json and the spec's Errors and warnings table differ at ${row?.name ?? entry?.name}`);
    }
  }

  const ordered = [...registry.filter((e) => e.kind === "error"), ...registry.filter((e) => e.kind === "warning")];
  const sections = ordered.flatMap((e) => [`### ${e.name} {#${e.name}}`, "", `**Kind:** ${e.kind}`, "", e.description, ""]);
  const body = [...lines.slice(0, start), ...sections, ...lines.slice(end)].join("\n");
  return { ...page, body: body.replace(/\n---\n/, "\ntoc_max_heading_level: 2\n---\n") };
}

function parseRow(line: string): RegistryEntry {
  const cells = line.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replaceAll("\\|", "|"));
  const name = cells[0]!.replace(/^`|`$/g, "");
  return { name, kind: cells[1] as RegistryEntry["kind"], description: cells[2] ?? "" };
}

export function schemaPages(schemas: { file: string; json: string }[]): SchemaPage[] {
  const pages = schemas
    .map(({ file, json }) => {
      const id = file.replace(/\.schema\.json$/, "");
      const schema = JSON.parse(json) as { title?: string; description?: string };
      const title = schema.title ?? id;
      const body = [
        "---",
        `id: ${id}`,
        `title: ${JSON.stringify(title)}`,
        "---",
        "",
        `# ${title}`,
        "",
        ...(schema.description ? [schema.description, ""] : []),
        `Source: \`spec/schemas/${file}\`.`,
        "",
        "```json",
        json.trimEnd(),
        "```",
        "",
      ].join("\n");
      return { id, title, body };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const index = [
    "---",
    "id: index",
    "title: Schemas",
    "sidebar_position: 0",
    "---",
    "",
    "# Schemas",
    "",
    "JSON Schemas for the YAML blocks and the results the specification defines.",
    "",
    ...pages.map((p) => `- [${p.title}](./${p.id}.md)`),
    "",
  ].join("\n");
  return [{ id: "index", title: "Schemas", body: index }, ...pages];
}
