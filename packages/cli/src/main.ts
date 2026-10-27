import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RegexLimitError, parse, select } from "@lore/parser";
import pkg from "../package.json";
import { parseCommand, type SelectCommand } from "./args";
import { parseUnifiedDiff } from "./diff";
import { InputError, UsageError } from "./errors";
import { buildInput, findRepoRoot } from "./input";
import { toSelection } from "./selection";
import { renderText } from "./text";

export interface IO {
  stdin: () => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  isTTY: boolean;
}

const HELP = `Usage:
  lore select [rules] --diff <file|-> [options]
  lore --help
  lore --version

Rules:
  --repo <dir>        The governed repo's working tree (default: the git root above the current directory)
  --no-repo           Take the governed repo to hold no Lore files; needs --remote
  --remote <url>      The governed repo's remote, for matching "repo" (repeatable; default: read from git)
  --rules-ref <ref>   Read the repo's Lore files at this git ref instead of the working tree
  --given <dir>       A given folder (repeatable)

Change:
  --diff <file|->     A unified diff, or - for stdin

Output:
  --format text|json  Default: text on a terminal, json otherwise
  --capabilities <list>  Checks to run, default regex,ast-grep
  --strict            Exit 1 when the rules have errors that excluded entries

Exit codes: 0 selection ran, 1 --strict and entries were excluded, 2 usage or input error.
`;

export async function run(argv: string[], io: IO): Promise<number> {
  try {
    const command = parseCommand(argv);
    switch (command.name) {
      case "help":
        io.stdout(HELP);
        return 0;
      case "version":
        io.stdout(`${pkg.version}\n`);
        return 0;
      case "verdicts":
        throw new UsageError("lore verdicts is not available yet");
      case "select":
        return await runSelect(command, io);
    }
  } catch (error) {
    if (error instanceof UsageError || error instanceof InputError || error instanceof RegexLimitError) {
      io.stderr(`lore: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

async function runSelect(command: SelectCommand, io: IO): Promise<number> {
  const change = parseUnifiedDiff(await readDiff(command.diff, io));
  const { input, readSrc } = await buildInput({
    repo: governedRepo(command),
    rulesRef: command.rulesRef,
    given: command.given,
    remotes: command.remotes,
  });
  const model = parse(input);
  const result = await select(input, change, {
    capabilities: command.capabilities,
    astGrepBinary: "ast-grep",
    fileContent: () => null,
  });
  const selection = toSelection(model, result, change, readSrc);
  const format = command.format ?? (io.isTTY ? "text" : "json");
  io.stdout(format === "json" ? `${JSON.stringify(selection, null, 2)}\n` : renderText(selection));
  return command.strict && selection.excluded.length > 0 ? 1 : 0;
}

function governedRepo(command: SelectCommand): string | null {
  if (command.noRepo) return null;
  if (command.repo !== null) {
    const root = findRepoRoot(resolve(command.repo));
    if (root === null) throw new InputError(`--repo ${command.repo} is not in a git working copy`);
    return root;
  }
  const root = findRepoRoot(process.cwd());
  if (root === null) throw new InputError("no git working copy here: pass --repo or --no-repo");
  return root;
}

async function readDiff(source: string, io: IO): Promise<string> {
  if (source === "-") return io.stdin();
  try {
    return readFileSync(source, "utf8");
  } catch {
    throw new InputError(`cannot read diff: ${source}`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

if (require.main === module) {
  run(process.argv.slice(2), {
    stdin: readStdin,
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    isTTY: process.stdout.isTTY === true,
  }).then((code) => {
    process.exitCode = code;
  });
}
