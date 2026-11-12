export type EntryKind = "rule" | "context";

export const TOP_LEVEL_TAGS = ["rule", "context", "defaults", "scope"] as const;
export const CHILD_TAGS: Readonly<Record<EntryKind, readonly string[]>> = {
  rule: ["meta", "scope", "when", "source", "check"],
  context: ["meta", "scope", "when"],
};
export const SINGLE_CHILDREN: ReadonlySet<string> = new Set(["meta", "scope", "when", "source"]);
// Tags written with attributes; the others take none.
export const TAG_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  rule: ["id", "category", "severity", "disabled"],
  context: ["id", "src", "disabled"],
  check: ["lang"],
};
export const BARE_ATTRIBUTES: ReadonlySet<string> = new Set(["disabled"]);
export const SEVERITIES = ["blocking", "advisory"] as const;
export const CHECK_LANGUAGES = ["regex", "ast-grep"] as const;
export const WHEN_KEYS = ["addedContains", "addedMatches", "removedContains", "removedMatches", "droppedContains", "droppedMatches", "changed", "unchanged"] as const;
export const SOURCE_KEYS = ["file", "heading", "phrase"] as const;

export const TAG_DOCS: Readonly<Record<string, string>> = {
  rule: "One thing a team expects every change to follow, with an id, a category, a severity and prose for the reviewer.",
  context: "A pointer to a prose document a reviewer reads when the context is eligible; it gets no verdict.",
  defaults: "A file block giving every rule in the file a `category` and a `severity` to fall back on.",
  scope: "The files an entry covers: `files` globs a file must match and `ignores` globs it must not, resolved from the base.",
  meta: "A free-form YAML mapping recording what a team wants about an entry, such as an owner or links; it never changes eligibility.",
  when: "Conditions on the change; an entry with a `<when>` is eligible only when every condition holds.",
  source: "The files the rule was written from, each a mapping with a `file` and an optional `heading` and `phrase`; `lore audit` checks they still hold.",
  check: "A search run over the rule's counted files whose hits point the reviewer at lines, never a verdict.",
};

export const ATTRIBUTE_DOCS: Readonly<Record<string, string>> = {
  id: "The entry's id, in kebab-case and unique across everything collected.",
  category: "A category known for the file: a fixed one or one a `.loreconfig` adds.",
  severity: "`blocking` or `advisory`; a rule without one falls back to `<defaults>`, then to `advisory`.",
  disabled: "Written bare, it keeps the entry in the model but never eligible.",
  src: "A relative path to the document a reviewer reads for this context, resolved from the base or from the file's folder.",
  lang: "The check's language, `regex` when left out; `ast-grep` is the other language this specification defines.",
};

export const WHEN_DOCS: Readonly<Record<string, string>> = {
  addedContains: "Holds when an added line of a counted file contains one of the strings, case-sensitive. In a rule, each such line is a hit.",
  addedMatches: "Holds when an added line of a counted file matches one of the patterns in the regex dialect. In a rule, each such line is a hit.",
  removedContains: "Holds when a removed line of a counted file contains one of the strings, case-sensitive. In a rule, each such line is a hit on the old side.",
  removedMatches: "Holds when a removed line of a counted file matches one of the patterns in the regex dialect. In a rule, each such line is a hit on the old side.",
  droppedContains: "Holds when a removed line of a counted file contains one of the strings, case-sensitive, and no added line of the same edit (changed lines with no unchanged line between them) contains that string. In a rule, each such line is a hit on the old side.",
  droppedMatches: "Holds when a removed line of a counted file matches one of the patterns in the regex dialect, and no added line of the same edit (changed lines with no unchanged line between them) matches that pattern. In a rule, each such line is a hit on the old side.",
  changed: "Holds when a changed file anywhere in the change matches one of the globs.",
  unchanged: "Holds when no changed file anywhere in the change matches any of the globs.",
};

export const SOURCE_DOCS: Readonly<Record<string, string>> = {
  file: "One file the rule was written from, resolved from the base, from the rule file's folder when it starts `./` or `../`, or when it starts `/` from the governed repo's root (in a loose folder, from the folder's root).",
  heading: "A heading in the file, given as its text or its slug; the source is that heading's section. Only when `file` ends in `.md`, `.mdx` or `.markdown`.",
  phrase: "Text that appears in the file, or in the heading's section when `heading` is given.",
};
