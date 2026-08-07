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

/**
 * One entry in the Relationships section, in one of **three** genuinely distinct
 * states (D168, OFC-392). Before the split there were two — resolved, or a single
 * `?? "View his profile"` fallback standing in for both "the roster hasn't loaded
 * yet" and "this brother is withheld from you". Conflating them produced the
 * reported bug twice over: the placeholder invited the viewer to open a profile
 * he is not allowed to see, and because {@link Avatar} derives its initials from
 * the *name* it is handed, the string "View his profile" rendered as the invented
 * initials "VP" over a stranger's avatar.
 *
 * - `known` — resolved from the roster; render the real thumbnail and name.
 * - `private` — the brother exists but is withheld (`unlisted` D124 or
 *   `debrothered` D115 — deliberately indistinguishable). Render a nameless
 *   avatar and "Info is private", and **do not link**: the only destination is a
 *   page saying the same thing.
 * - `pending` — the roster is still in flight, so nothing is known yet. Still a
 *   link, because for the overwhelmingly common visible brother it is a real one;
 *   claiming privacy here would be a lie that corrects itself a second later.
 *
 * `id` is null on a private Little Brother: the server sends only a count, never
 * the withheld ids (there is nothing to address, since the entry does not link).
 */
export type RelationshipEntry =
  | { kind: "known"; id: number; name: string; profile: DirectoryProfile }
  | { kind: "private"; id: number | null }
  | { kind: "pending"; id: number };

/**
 * The Big-Brother entry for a record, or null when it names none. Unlike the
 * Little-Brother edge this needs no server help: `bigBrotherId` is a `public`
 * field on the record being read, so the pointer survives even when its target
 * does not — which is exactly why an absent target means "withheld", not "gone".
 */
export function bigBrotherEntry(
  roster: readonly DirectoryProfile[] | null,
  names: Map<number, string> | null,
  bigBrotherId: number | null | undefined,
): RelationshipEntry | null {
  if (bigBrotherId == null) {
    return null;
  }
  if (roster == null || names == null) {
    return { kind: "pending", id: bigBrotherId };
  }
  const profile = rosterMember(roster, bigBrotherId);
  if (!profile) {
    return { kind: "private", id: bigBrotherId };
  }
  return {
    kind: "known",
    id: bigBrotherId,
    name: names.get(bigBrotherId) ?? `#${bigBrotherId}`,
    profile,
  };
}

/**
 * The Little-Brother entries: the visible ones the roster yields, name-sorted as
 * before, followed by one nameless placeholder per brother the server reports as
 * hidden (`hiddenLittleBrothers`). The placeholders sort last because they have
 * no name to sort on — and putting them after the named ones keeps the visible
 * list's order identical to what it was before D168.
 *
 * Empty while the roster is still loading: the placeholders alone would be honest
 * but would render in the wrong place and then reflow once the named ones arrive.
 */
export function littleBrotherEntries(
  roster: readonly DirectoryProfile[] | null,
  names: Map<number, string> | null,
  id: number,
  hiddenCount: number | undefined,
): RelationshipEntry[] {
  if (roster == null || names == null) {
    return [];
  }
  const known: RelationshipEntry[] = littleBrothers(roster, names, id).map((little) => ({
    kind: "known",
    id: little.id,
    name: little.name,
    profile: little.profile,
  }));
  const hidden: RelationshipEntry[] = Array.from({ length: Math.max(0, hiddenCount ?? 0) }, () => ({
    kind: "private",
    id: null,
  }));
  return [...known, ...hidden];
}
