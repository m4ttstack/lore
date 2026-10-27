import { parse, type Diagnostic, type LoreInput } from "@lore/parser";
import { DiagnosticSeverity, type Diagnostic as LspDiagnostic } from "vscode-languageserver/node";
import registry from "../../../spec/errors.json";

const SOURCE = "lore";
const DESCRIPTIONS: ReadonlyMap<string, string> = new Map(registry.map(({ name, description }) => [name, description]));

export function registryDescription(name: string): string {
  return DESCRIPTIONS.get(name) ?? name;
}

// Keyed by the parser's file name: a repository path, or `external:` and a path for a given folder's file.
export function diagnose(input: LoreInput): Map<string, LspDiagnostic[]> {
  const model = parse(input);
  const byFile = new Map<string, LspDiagnostic[]>();
  const add = (diagnostic: Diagnostic, severity: DiagnosticSeverity) => {
    const list = byFile.get(diagnostic.file) ?? [];
    byFile.set(diagnostic.file, list);
    list.push(toLsp(diagnostic, severity));
  };
  for (const error of model.errors) add(error, DiagnosticSeverity.Error);
  for (const warning of model.warnings) add(warning, DiagnosticSeverity.Warning);
  return byFile;
}

function toLsp(diagnostic: Diagnostic, severity: DiagnosticSeverity): LspDiagnostic {
  const line = diagnostic.line - 1;
  return {
    range: diagnostic.range ?? { start: { line, character: 0 }, end: { line: line + 1, character: 0 } },
    severity,
    code: diagnostic.name,
    source: SOURCE,
    message: registryDescription(diagnostic.name),
  };
}
