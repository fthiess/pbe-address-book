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

/**
 * The roster record for a given id, or null — the Big-Brother lookup, kept in this
 * module so both relationship resolutions (Big via id, Little via the reverse
 * edge) read from one place rather than a raw inline `.find` in the view (OFC-203).
 */
export function rosterMember(
  roster: readonly DirectoryProfile[] | null,
  id: number | null | undefined,
): DirectoryProfile | null {
  if (roster == null || id == null) {
    return null;
  }
  return roster.find((p) => p.id === id) ?? null;
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
