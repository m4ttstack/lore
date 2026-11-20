import GithubSlugger from "github-slugger";
import { extractExamples } from "../../tools/check/extract";

export interface SpecPage { id: string; title: string; position: number; body: string }
export interface SplitOptions { ref: string } // git ref for GitHub links, e.g. "cli-v0.7.0" or "main"

const FENCE_OPEN = /^(`{3,}|~{3,})/;
const HEADING = /^(#{2,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const LINK = /\]\(([^)\s]+)\)/g;
const EXAMPLE_OPEN = /^`{6}example[ \t]+(\S+)[ \t]*$/;
const REPO = "https://github.com/m4ttstack/lore";

interface Line { text: string; inFence: boolean; heading?: { level: number; text: string; slug: string } }

export function splitSpec(markdown: string, options: SplitOptions): SpecPage[] {
  const lines = classify(markdown);
  const examples = new Map(extractExamples(markdown).map((e) => [e.line, e]));

  const pages: { id: string; title: string; lines: { text: string; inFence: boolean; index: number }[] }[] = [];
  const pageOfAnchor = new Map<string, string>();
  const pageTops = new Set<string>();

  lines.forEach((line, index) => {
    if (line.heading?.level === 2) {
      pages.push({ id: line.heading.slug, title: line.heading.text, lines: [] });
      pageTops.add(line.heading.slug);
    }
    const page = pages.at(-1);
    if (!page) return;
    if (line.heading) pageOfAnchor.set(line.heading.slug, page.id);
    page.lines.push({ text: line.text, inFence: line.inFence, index });
  });

  return pages.map((page, i) => {
    const out: string[] = [];
    for (const { text, inFence, index } of page.lines) {
      const heading = lines[index]!.heading;
      if (heading?.level === 2) {
        out.push(`# ${heading.text}`);
      } else if (heading) {
        out.push(`${"#".repeat(heading.level)} ${heading.text} {#${heading.slug}}`);
      } else if (!inFence) {
        out.push(rewriteLinks(text, page.id, pageOfAnchor, pageTops, options));
      } else {
        const example = examples.get(index + 1);
        const open = EXAMPLE_OPEN.exec(text);
        out.push(example && open ? `\`\`\`\`\`\`text title="Example ${example.number} (${open[1]})"` : text);
      }
    }
    const front = ["---", `id: ${page.id}`, `title: ${JSON.stringify(page.title)}`, `sidebar_position: ${i + 1}`, "---", ""];
    return { id: page.id, title: page.title, position: i + 1, body: `${front.join("\n")}\n${out.join("\n").trim()}\n` };
  });
}

// Fence opener lines count as inside the fence, so example openers can be rewritten there.
// Headings get slugs from one slugger over the whole document, as GitHub assigns them.
function classify(markdown: string): Line[] {
  const slugger = new GithubSlugger();
  let fence: string | null = null;
  return markdown.split("\n").map((text) => {
    if (fence !== null) {
      if (new RegExp(`^${fence[0]}{${fence.length},}[ \\t]*$`).test(text)) fence = null;
      return { text, inFence: true };
    }
    const open = FENCE_OPEN.exec(text);
    if (open) {
      fence = open[1]!;
      return { text, inFence: true };
    }
    const h = HEADING.exec(text);
    if (h) return { text, inFence: false, heading: { level: h[1]!.length, text: h[2]!, slug: slugger.slug(h[2]!) } };
    return { text, inFence: false };
  });
}

function rewriteLinks(
  text: string,
  pageId: string,
  pageOfAnchor: Map<string, string>,
  pageTops: Set<string>,
  { ref }: SplitOptions,
): string {
  return text.replace(LINK, (_, target: string) => `](${resolve(target)})`);

  function resolve(target: string): string {
    if (/^https?:\/\//.test(target)) return target;
    if (target.startsWith("#")) {
      const anchor = target.slice(1);
      const page = pageOfAnchor.get(anchor);
      if (!page) throw new Error(`spec link #${anchor} matches no heading`);
      if (pageTops.has(anchor)) return `./${page}.md`;
      return page === pageId ? target : `./${page}.md#${anchor}`;
    }
    if (target === "AGENT.md") return "./for-agents-non-normative.md";
    if (target === "errors.json") return "./errors-and-warnings.md";
    if (target === "schemas/") return "./schemas/index.md";
    const schema = /^schemas\/([a-z-]+)\.schema\.json$/.exec(target);
    if (schema) return `./schemas/${schema[1]}.md`;
    if (target === "../LICENSE" || target === "../LICENSE-CC-BY-4.0") return `${REPO}/blob/${ref}/${target.slice(3)}`;
    throw new Error(`spec link ${target} has no page on the site`);
  }
}
