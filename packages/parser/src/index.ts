import type { Change, DocumentModel, EligibilityResult, LoreInput, SelectOptions } from "./types";

export type * from "./types";

export function parse(_input: LoreInput): DocumentModel {
  throw new Error("not implemented");
}

export async function select(
  _input: LoreInput,
  _change: Change,
  _options?: SelectOptions,
): Promise<EligibilityResult> {
  throw new Error("not implemented");
}
