export interface InputFile { path: string; content: string }
export interface GivenFolder { folder: string; files: InputFile[] }
export interface LoreInput { repo: InputFile[]; given: GivenFolder[]; remotes: string[] }
export interface Position { line: number; character: number }
export interface Range { start: Position; end: Position }
export interface Diagnostic { name: string; file: string; entry: string | null; line: number; range?: Range }
export interface Scope { files: string[]; ignores: string[] }
export interface Check { lang: string; body: string }
export interface Entry {
  kind: "rule" | "context"; id: string; file: string;
  category: string | null; severity: "blocking" | "advisory" | null; disabled: boolean;
  scopes: Scope[]; when: Record<string, string[]> | null; checks: Check[];
  meta: Record<string, unknown> | null; summary: string; prose: string; src: string | null;
}
export interface DocumentModel { entries: Entry[]; errors: Diagnostic[]; warnings: Diagnostic[] }
export interface AddedLine { line: number; text: string }
export type ChangedFile =
  | { kind: "A" | "M" | "D"; path: string; added: AddedLine[] }
  | { kind: "R"; oldPath: string; path: string; added: AddedLine[] };
export interface Change { files: ChangedFile[] }
export interface Hit { rule: string; file: string; line: number; text: string }
export interface EligibilityResult { eligible: string[]; hits: Hit[]; excluded: Diagnostic[]; warnings: Diagnostic[] }
export type Capability = "regex" | "ast-grep";
export interface SelectOptions { capabilities?: Capability[]; astGrepBinary?: string | null }
