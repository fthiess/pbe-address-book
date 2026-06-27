import { NICKNAME_GROUPS } from "./nickname-data.js";

/**
 * The bidirectional common-nickname expansion (D123). At module load the curated
 * {@link NICKNAME_GROUPS} are flattened into one map from each name to the union
 * of every group it belongs to, so a name in several groups (e.g. "al" → albert,
 * alan, alfred) expands to all of them. Built once, then a per-token O(1) lookup.
 */
function buildExpansionMap(): Map<string, ReadonlySet<string>> {
  const sets = new Map<string, Set<string>>();
  for (const group of NICKNAME_GROUPS) {
    for (const name of group) {
      let set = sets.get(name);
      if (!set) {
        set = new Set<string>();
        sets.set(name, set);
      }
      for (const other of group) {
        set.add(other);
      }
    }
  }
  return sets;
}

const EXPANSION: ReadonlyMap<string, ReadonlySet<string>> = buildExpansionMap();

/**
 * Expand one folded given-name token into its nickname group, *including the
 * token itself* (so callers can treat the result as the full match set). A token
 * with no known nicknames returns just itself.
 */
export function expandNickname(token: string): string[] {
  const group = EXPANSION.get(token);
  if (!group) {
    return [token];
  }
  // The token is already a member of its own group(s), so the set covers it.
  return [...group];
}
