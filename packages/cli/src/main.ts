import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { RegexLimitError, parseWithContext, selectParsed } from "@lore/parser";
import pkg from "../package.json";
import { parseCommand, type CheckCommand, type SelectCommand, type VerdictsCommand } from "./args";
import { changeDiff, type ChangeSource } from "./change";
import { parseUnifiedDiff } from "./diff";
import { InputError, UsageError } from "./errors";
import { GitMissingError } from "./git";
import { buildInput, findRepoRoot, unreadWarnings } from "./input";
import { entrySources, toSelection } from "./selection";
import { excludedLines, renderText } from "./text";
import { checkVerdicts, readSelection } from "./verdicts";

export interface IO {
  stdin: () => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  isTTY: boolean;
}

const HELP = `Usage:
  lore select [rules] --diff <file|-> [options]
  lore check [<commit> | --base <ref>] [rules] [options]
  lore verdicts --selection <file> [<verdicts-file> | -]
  lore --help
  lore --version

Rules:
  --repo <dir>           The governed repo's working tree (default: the git root above the current directory)
  --no-repo              Take the governed repo to hold no Lore files; needs --remote
  --remote <url>         The governed repo's remote, for matching "repo" (repeatable; default: read from git)
  --rules-ref <ref>      Read the repo's Lore files at this git ref instead of the working tree
  --given <dir>          A given folder (repeatable)

Change:
  --diff <file|->        A unified diff, or - for stdin (lore select)
  <commit>               The commit lore check reads the change from (default: uncommitted work, untracked files included)
  --base <ref>           lore check: compare with the merge base of <ref> and HEAD (the branch so far)

Output:
  --format text|json     Default: text for lore check; for lore select, text on a terminal, json otherwise
  --capabilities <list>  Checks to run, default regex,ast-grep
  --strict               Exit 1 when the rules have errors that excluded entries

Verdicts:
  --selection <file>     The JSON from lore select
  <verdicts-file>        A verdict set, or - for stdin (default)

Exit codes:
  lore select    0 the selection ran, 1 --strict was given and entries were excluded
  lore check     0 the check ran, 1 --strict was given and entries were excluded
  lore verdicts  0 the verdicts have no problems, 1 the verdicts have problems
  all            2 usage or input error, 70 internal error
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
        return await runVerdicts(command, io);
      case "select":
        return await runSelect(command, io);
      case "check":
        return await runCheck(command, io);
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
  return selectChange(command, io, {
    repo: governedRepo(command),
    untrackedLore: false,
    change: async () => readDiff(command.diff, io),
    audience: "reviewer",
  });
}

async function runCheck(command: CheckCommand, io: IO): Promise<number> {
  const root = changeRoot(command);
  const change: ChangeSource = command.commit === null ? { base: command.base } : { commit: command.commit };
  return selectChange(command, io, {
    repo: command.noRepo ? null : root,
    untrackedLore: command.commit === null,
    change: async () => changeDiff(root, change),
    audience: "author",
  });
}

interface SelectionSource {
  repo: string | null;
  untrackedLore: boolean;
  change: () => Promise<string>;
  audience: "reviewer" | "author";
}

async function selectChange(command: SelectCommand | CheckCommand, io: IO, source: SelectionSource): Promise<number> {
  const { input, readSrc, unread } = await buildInput({
    repo: source.repo,
    rulesRef: command.rulesRef,
    given: command.given,
    remotes: command.remotes,
    untrackedLore: source.untrackedLore,
  });
  const change = parseUnifiedDiff(await source.change());
  const parsed = parseWithContext(input);
  const result = await selectParsed(input, parsed, change, {
    capabilities: command.capabilities,
    astGrepBinary: "ast-grep",
    fileContent: () => null,
  });
  const selection = toSelection(parsed.model, result, change, entrySources(parsed, readSrc), unreadWarnings(unread, parsed.collected));
  const format = command.format ?? (command.name === "check" || io.isTTY ? "text" : "json");
  if (format === "json") io.stdout(`${JSON.stringify(selection, null, 2)}\n`);
  else {
    io.stderr(excludedLines(selection));
    io.stdout(renderText(selection, source.audience));
  }
  return command.strict && selection.excluded.length > 0 ? 1 : 0;
}

async function runVerdicts(command: VerdictsCommand, io: IO): Promise<number> {
  const selection = readSelection(await readJson(command.selection, "selection", io));
  const problems = checkVerdicts(selection, await readJson(command.verdicts, "verdicts", io));
  io.stdout(`${JSON.stringify({ problems }, null, 2)}\n`);
  return problems.length === 0 ? 0 : 1;
}

async function readJson(source: string, what: string, io: IO): Promise<unknown> {
  let text: string;
  if (source === "-") text = await io.stdin();
  else {
    try {
      text = readFileSync(source, "utf8");
    } catch {
      throw new InputError(`cannot read ${what}: ${source}`);
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InputError(`${what} is not JSON: ${source === "-" ? "stdin" : source}`);
  }
}

function governedRepo(command: SelectCommand): string | null {
  if (command.noRepo) return null;
  if (command.repo !== null) {
    const root = findRepoRoot(resolve(command.repo));
    if (root === null) throw new InputError(`--repo ${command.repo} is not in a git working copy`);
    return root;
  }
  let root: string | null;
  try {
    root = findRepoRoot(process.cwd());
  } catch (error) {
    if (error instanceof GitMissingError) throw new InputError(`${error.message}; pass --no-repo with --remote to run without it`);
    throw error;
  }
  if (root === null) throw new InputError("no git working copy here: pass --repo or --no-repo");
  return root;
}

function changeRoot(command: CheckCommand): string {
  if (command.repo !== null && !isDirectory(resolve(command.repo))) {
    throw new InputError(`lore check needs a git working copy: ${command.repo} is not in one`);
  }
  let root: string | null;
  try {
    root = findRepoRoot(command.repo === null ? process.cwd() : resolve(command.repo));
  } catch (error) {
    if (error instanceof GitMissingError) throw new InputError(`${error.message}; lore check needs it`);
    throw error;
  }
  if (root !== null) return root;
  if (command.repo !== null) throw new InputError(`lore check needs a git working copy: ${command.repo} is not in one`);
  throw new InputError("lore check needs a git working copy: run it inside one or pass --repo");
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
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

export async function main(argv: string[], io: IO): Promise<number> {
  try {
    return await run(argv, io);
  } catch (error) {
    io.stderr(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    return 70;
  }
}

if (require.main === module) {
  main(process.argv.slice(2), {
    stdin: readStdin,
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    isTTY: process.stdout.isTTY === true,
  }).then((code) => {
    process.exitCode = code;
  });
}
