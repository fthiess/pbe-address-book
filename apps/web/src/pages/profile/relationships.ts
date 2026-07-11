import { type CanonicalNameInput, resolveCanonicalNames } from "@pbe/shared";
import type { DirectoryProfile } from "../../lib/types.js";

/**
 * Relationship derivations over the cached roster (§5.7.4). Both are pure reads of
 * the in-memory dataset — nothing here is stored: Little Brothers are the reverse
 * edge of `bigBrotherId`, and the names come from the one shared Canonical-Name
 * function so they read identically to the Directory.
 */

/**
 * A roster member reduced to what the relationship UI shows: id + display name +
 * the roster record itself, so the relationship link can render the same
 * thumbnail the Directory does (OFC-203).
 */
export interface RosterName {
  id: number;
  name: string;
  profile: DirectoryProfile;
}

/** Map every roster id to its Canonical Name (ambiguous names get the `(#id)` tag). */
export function rosterNames(roster: readonly DirectoryProfile[]): Map<number, string> {
  const inputs: CanonicalNameInput[] = roster.map((p) => ({
    id: p.id,
    firstName: p.firstName ?? "",
    lastName: p.lastName ?? "",
    classYear: p.classYear ?? null,
  }));
  return resolveCanonicalNames(inputs);
}

/**
 * The brothers who name `id` as their Big Brother — the derived Little Brothers,
 * sorted by Canonical Name for a stable, readable list.
 */
export function littleBrothers(
  roster: readonly DirectoryProfile[],
  names: Map<number, string>,
  id: number,
): RosterName[] {
  return roster
    .filter((p) => p.bigBrotherId === id)
    .map((p) => ({ id: p.id, name: names.get(p.id) ?? `#${p.id}`, profile: p }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
