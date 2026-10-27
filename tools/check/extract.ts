export type ExampleKind = "parse" | "eligibility";
export type Place = "repo" | "external" | "rules" | "loose";
export interface ExampleFile { path: string; place: Place; content: string }
export interface Example {
  number: number;          // 1-based, document order
  kind: string;            // raw; the checker validates it
  section: string;         // nearest preceding ## or ### heading text
  line: number;            // line of the opening fence in SPEC.md
  requires: string[];      // from "requires:" lines
  files: ExampleFile[];
  remote: string | null;   // raw section text
  diff: string | null;     // raw section text
  expect: string | null;   // raw section text
}

const EXAMPLE_OPEN = /^`{6}example[ \t]+(\S+)(.*)$/;
const EXAMPLE_NO_KIND = /^`{6}example(?!\S)/;
const EXAMPLE_CLOSE = /^`{6}$/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
const HEADING = /^#{2,3}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const REQUIRES = /^requires:[ \t]*(.+?)[ \t]*$/;
const MARKER = "=== ";

interface Section { name: string; lines: string[] }

export function extractExamples(markdown: string): Example[] {
  const lines = markdown.split("\n");
  const examples: Example[] = [];
  let section = "";
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;

    if (fence !== null) {
      const closer = new RegExp(`^${fence[0]}{${fence.length},}[ \\t]*$`);
      if (closer.test(text)) fence = null;
      continue;
    }

    const open = EXAMPLE_OPEN.exec(text);
    if (!open && EXAMPLE_NO_KIND.test(text)) throw new Error(`example opened at line ${i + 1} has no kind`);
    if (open) {
      if (open[2] !== "") throw new Error(`example opened at line ${i + 1} has text after its kind`);
      const start = i;
      const body: string[] = [];
      i++;
      while (i < lines.length && !EXAMPLE_CLOSE.test(lines[i]!)) body.push(lines[i++]!);
      if (i >= lines.length) throw new Error(`unterminated example opened at line ${start + 1}`);
      examples.push(build(examples.length + 1, open[1]!, section, start + 1, body));
      continue;
    }

    const fenceOpen = FENCE_OPEN.exec(text);
    if (fenceOpen) {
      fence = fenceOpen[1]!;
      continue;
    }

    const heading = HEADING.exec(text);
    if (heading) section = heading[1]!;
  }
  return examples;
}

function placeOf(name: string): Place {
  for (const place of ["external", "rules", "loose"] as const) if (name.startsWith(`${place}:`)) return place;
  return "repo";
}

function build(number: number, kind: string, section: string, line: number, body: string[]): Example {
  const requires: string[] = [];
  let at = 0;
  for (; at < body.length; at++) {
    const m = REQUIRES.exec(body[at]!);
    if (!m) break;
    requires.push(m[1]!);
  }

  const sections: Section[] = [];
  for (let n = at; n < body.length; n++) {
    const text = body[n]!;
    const where = line + 1 + n;
    if (text.startsWith(MARKER)) {
      const name = text.slice(MARKER.length);
      if (name === "" || name !== name.trim()) throw new Error(`malformed section marker at line ${where}`);
      sections.push({ name, lines: [] });
    } else if (sections.length > 0) {
      sections.at(-1)!.lines.push(text);
    } else if (text.trim() !== "") {
      throw new Error(`text before the first section at line ${where}`);
    }
  }

  const example: Example = { number, kind, section, line, requires, files: [], remote: null, diff: null, expect: null };
  for (const s of sections) {
    const content = s.lines.join("\n");
    if (s.name === "remote" || s.name === "diff" || s.name === "expect") {
      if (example[s.name] !== null) throw new Error(`duplicate "${s.name}" section in example at line ${line}`);
      example[s.name] = content;
    } else example.files.push({ path: s.name, place: placeOf(s.name), content });
  }
  return example;
}
