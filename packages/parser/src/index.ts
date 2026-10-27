import type { Change, EligibilityResult, LoreInput, SelectOptions } from "./types";

export type * from "./types";
export type { DecodedText } from "./text";
export type {
  Attribute, AttributeList, BlockNode, ChildNode, CommentNode, EntryNode, LoreFile, RawAttributes, TextNode, TopNode,
} from "./scan";
export { parseFile, readAttributes } from "./scan";
export { dedent, dedentEntry } from "./indent";
export { parse } from "./model";
export { collect, disabledFor, type Collected, type CollectedFile, type ConfigFile, type Tree, type TreeInfo } from "./collect";
export { normalizeRemote, type DisableItem } from "./loreconfig";
export { disjoint, matchFromBase, matchGlob, resolveGlob, validateGlob, type GlobPlace } from "./glob";

export async function select(
  _input: LoreInput,
  _change: Change,
  _options?: SelectOptions,
): Promise<EligibilityResult> {
  throw new Error("not implemented");
}
