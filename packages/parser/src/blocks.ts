import { validateGlob, type GlobPlace } from "./glob";
import { validateRegex } from "./regex";
import type { BlockProblem } from "./yaml";

export const CATEGORY = /^[a-z][a-z0-9_]*$/;
export const ID = /^[a-z][a-z0-9-]*$/;
export const SEVERITIES = ["blocking", "advisory"];
export const FIXED_CATEGORIES: ReadonlySet<string> = new Set([
  "functional_correctness", "test_coverage", "security", "performance", "accessibility",
  "observability", "backwards_compatibility", "documentation", "code_style",
]);
const CONDITIONS = ["addedContains", "addedMatches", "changed", "unchanged"] as const;

export function checkDefaults(value: unknown, line: number): BlockProblem | null {
  const invalid = { name: "invalid-defaults", line };
  if (!isMapping(value)) return invalid;
  for (const [key, field] of Object.entries(value)) {
    if (key === "category" && typeof field === "string" && CATEGORY.test(field)) continue;
    if (key === "severity" && typeof field === "string" && SEVERITIES.includes(field)) continue;
    return invalid;
  }
  return null;
}

export function checkScope(value: unknown, line: number): BlockProblem | null {
  if (!isMapping(value)) return { name: "invalid-scope", line };
  for (const [key, field] of Object.entries(value)) {
    if ((key !== "files" && key !== "ignores") || !isStringList(field)) return { name: "invalid-scope", line };
  }
  const files = (value.files as string[] | undefined) ?? null;
  const ignores = (value.ignores as string[] | undefined) ?? [];
  if (files !== null && files.length === 0) return { name: "empty-files", line };
  const globs: [string, GlobPlace][] = [
    ...(files ?? []).map((glob): [string, GlobPlace] => [glob, "files"]),
    ...ignores.map((glob): [string, GlobPlace] => [glob, "ignores"]),
  ];
  for (const [glob, place] of globs) {
    const name = validateGlob(glob, place);
    if (name !== null) return { name, line };
  }
  return null;
}

export function checkWhen(value: unknown, line: number): BlockProblem | null {
  if (!isMapping(value)) return { name: "invalid-when", line };
  const keys = Object.keys(value);
  if (keys.length === 0) return { name: "empty-when", line };
  if (keys.some((key) => !(CONDITIONS as readonly string[]).includes(key))) return { name: "unknown-condition", line };
  for (const condition of CONDITIONS) {
    if (!Object.hasOwn(value, condition)) continue;
    const items = value[condition];
    if (!isStringList(items)) return { name: "invalid-when", line };
    if (condition === "addedContains" && items.some((s) => s === "" || /[\n\r]/.test(s))) {
      return { name: "invalid-when", line };
    }
    for (const item of items) {
      const name = condition === "addedMatches" ? validateRegex(item)
        : condition === "addedContains" ? null
        : validateGlob(item, condition);
      if (name !== null) return { name, line };
    }
  }
  return null;
}

export function checkMeta(value: unknown, line: number): BlockProblem | null {
  return isMapping(value) ? null : { name: "invalid-meta", line };
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
