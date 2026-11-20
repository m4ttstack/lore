import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseCommand } from "../../packages/cli/src/args";
import { UsageError } from "../../packages/cli/src/errors";
import { run } from "../../packages/cli/src/main";

const DIR = "site/docs/reference/cli";
const NOT_YET = ["--paths", "--change", "--head"];
const SUPPORT_PAGES = ["index", "options", "also-in-scope", "output", "exit-codes"];

let help = "";
await run(["--help"], {
  stdin: async () => "",
  stdout: (text) => void (help += text),
  stderr: () => {},
  isTTY: false,
  today: () => "2026-01-01",
});

const usage = help.slice(0, help.indexOf("\n\n"));
const commands = [...usage.matchAll(/^ {2}lore (\S+)/gm)].map((m) => m[1]!).filter((c) => !c.startsWith("--"));
const flags = [...new Set(help.match(/--[a-z][a-z-]*/g))];

// A value that fails validation also names the flag, so a flag is accepted when the flag alone,
// or the flag with any one of these values, parses without a UsageError naming it.
const SAMPLE_VALUES = [null, "x", "1", "json", "2026-01-01", "source-changed=off"];

function accepts(command: string, flag: string): boolean {
  return SAMPLE_VALUES.some((value) => {
    try {
      parseCommand(value === null ? [command, flag] : [command, flag, value]);
      return true;
    } catch (error) {
      if (error instanceof UsageError) return !error.message.includes(flag);
      throw error;
    }
  });
}

function mentions(page: string, flag: string): boolean {
  return new RegExp(`\`${flag}[ =\`]`).test(page);
}

const page = (name: string) => readFileSync(`${DIR}/${name}.md`, "utf8");

describe("CLI reference coverage", () => {
  test("the help text names the five commands", () => {
    expect(commands).toEqual(["select", "check", "verdicts", "audit", "review"]);
  });

  test("every command has a page", () => {
    for (const command of commands) expect(existsSync(`${DIR}/${command}.md`), `${DIR}/${command}.md`).toBe(true);
  });

  test("every flag a command accepts is on its page, or on options.md when the page links to it", () => {
    const options = page("options");
    for (const command of commands) {
      const own = page(command);
      const linksOptions = /\]\(\.\/options\.md(#[^)]*)?\)/.test(own);
      for (const flag of flags.filter((f) => accepts(command, f))) {
        const found = mentions(own, flag) || (linksOptions && mentions(options, flag));
        expect(found, `${command}.md does not document ${flag}`).toBe(true);
      }
    }
  });

  test("every help flag except --version is accepted by some command", () => {
    for (const flag of flags.filter((f) => f !== "--version")) {
      expect(commands.some((c) => accepts(c, flag)), `no command accepts ${flag}; the coverage check skips it`).toBe(true);
    }
  });

  test("every flag the parser knows is in the help text", () => {
    const literals = [...readFileSync("packages/cli/src/args.ts", "utf8").matchAll(/"(--[a-z-]+)"/g)].map((m) => m[1]!);
    for (const flag of new Set(literals)) {
      if (NOT_YET.includes(flag)) continue;
      expect(flags, `${flag} is parsed but missing from lore --help`).toContain(flag);
    }
  });

  test("every page names a real command or is a support page", () => {
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".md"))) {
      const name = file.replace(/\.md$/, "");
      expect([...commands, ...SUPPORT_PAGES], `${file} is not a command page`).toContain(name);
    }
  });
});
