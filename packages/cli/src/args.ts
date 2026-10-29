import type { Capability } from "@lore/parser";
import { UsageError } from "./errors";

export interface SelectCommand {
  name: "select";
  repo: string | null;
  noRepo: boolean;
  remotes: string[];
  rulesRef: string | null;
  given: string[];
  diff: string;
  format: "text" | "json" | null;
  capabilities: Capability[];
  strict: boolean;
}
export interface CheckCommand extends Omit<SelectCommand, "name" | "diff"> {
  name: "check";
  commit: string | null;
  base: string | null;
}
export interface VerdictsCommand { name: "verdicts"; selection: string; verdicts: string }
export type Command =
  | SelectCommand
  | CheckCommand
  | VerdictsCommand
  | { name: "help" }
  | { name: "version" };

const NOT_YET = ["--paths", "--change", "--base", "--head"];
const CAPABILITIES: Capability[] = ["regex", "ast-grep"];
const VALUE_FLAGS = ["--repo", "--remote", "--rules-ref", "--given", "--diff", "--format", "--capabilities"];
const REPEATABLE = ["--remote", "--given"];

export function parseCommand(argv: string[]): Command {
  const [first, ...rest] = argv;
  if (first === undefined) throw new UsageError("missing command: expected select, check or verdicts (see lore --help)");
  if (first === "--help") return { name: "help" };
  if (first === "--version") return { name: "version" };
  if (first === "select" || first === "check") return parseChangeCommand(first, rest);
  if (first === "verdicts") return parseVerdicts(rest);
  throw new UsageError(`unknown command: ${first} (see lore --help)`);
}

function parseChangeCommand(name: "select" | "check", args: string[]): Command {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (flag === "--help") return { name: "help" };
    if (NOT_YET.includes(flag) && !(name === "check" && flag === "--base")) throw new UsageError(`${flag} is not available yet`);
    if (flag === "--no-repo" || flag === "--strict") {
      if (eq !== -1) throw new UsageError(`${flag} takes no value`);
      flags.add(flag);
      continue;
    }
    if (!arg.startsWith("--")) {
      if (name === "select") throw new UsageError(`unexpected argument: ${arg}`);
      positional.push(arg);
      continue;
    }
    if (name === "check" && flag === "--diff") throw new UsageError("lore check builds the change itself; use lore select --diff for a diff");
    if (!VALUE_FLAGS.includes(flag) && !(name === "check" && flag === "--base")) throw new UsageError(`unknown option: ${arg}`);
    let value: string;
    if (eq !== -1) value = arg.slice(eq + 1);
    else if (i + 1 < args.length && !args[i + 1]!.startsWith("--")) value = args[++i]!;
    else throw new UsageError(`${flag} needs a value`);
    const seen = values.get(flag) ?? [];
    if (seen.length > 0 && !REPEATABLE.includes(flag)) throw new UsageError(`${flag} given more than once`);
    values.set(flag, [...seen, value]);
  }

  const one = (flag: string): string | null => values.get(flag)?.[0] ?? null;
  const noRepo = flags.has("--no-repo");
  if (noRepo && one("--rules-ref") !== null) throw new UsageError("--rules-ref cannot be used with --no-repo");
  if (name === "select" && noRepo && one("--repo") !== null) throw new UsageError("--repo cannot be used with --no-repo");
  if (positional.length > 1) throw new UsageError("give at most one commit");
  if (positional.length > 0 && one("--base") !== null) throw new UsageError("give a commit or --base, not both");

  const format = one("--format");
  if (format !== null && format !== "text" && format !== "json") throw new UsageError(`--format must be text or json, not ${format}`);
  const shared: Omit<CheckCommand, "name" | "commit" | "base"> = {
    repo: one("--repo"),
    noRepo,
    remotes: values.get("--remote") ?? [],
    rulesRef: one("--rules-ref"),
    given: values.get("--given") ?? [],
    format,
    capabilities: parseCapabilities(one("--capabilities") ?? CAPABILITIES.join(",")),
    strict: flags.has("--strict"),
  };
  if (name === "check") return { name, commit: positional[0] ?? null, base: one("--base"), ...shared };
  const diff = one("--diff");
  if (diff === null) throw new UsageError("give a change: --diff <file|->");
  return { name, diff, ...shared };
}

function parseCapabilities(list: string): Capability[] {
  const names = list.split(",").map((name) => name.trim()).filter((name) => name !== "");
  const unknown = names.find((name) => !CAPABILITIES.includes(name as Capability));
  if (unknown !== undefined) throw new UsageError(`unknown capability: ${unknown} (expected regex or ast-grep)`);
  return names as Capability[];
}

function parseVerdicts(args: string[]): Command {
  let selection: string | null = null;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help") return { name: "help" };
    if (arg === "--selection") {
      if (i + 1 >= args.length || args[i + 1]!.startsWith("--")) throw new UsageError("--selection needs a value");
      selection = args[++i]!;
    } else if (arg.startsWith("--selection=")) selection = arg.slice("--selection=".length);
    else if (arg.startsWith("--")) throw new UsageError(`unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (selection === null) throw new UsageError("give the selection: --selection <file>");
  if (positional.length > 1) throw new UsageError("give at most one verdicts file");
  const verdicts = positional[0] ?? "-";
  if (selection === "-" && verdicts === "-") throw new UsageError("stdin can supply only one of the selection and the verdicts");
  return { name: "verdicts", selection, verdicts };
}
