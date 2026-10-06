import { headshotObjectKey, parseImageObjectKey, thumbnailObjectKey } from "@pbe/shared";

/**
 * The pure half of `images:sweep` (OFC-463/OFC-448, D195): find the live image
 * objects no profile points at, so they can be deleted.
 *
 * WHY. A brother's headshot is the pair of objects his profile's
 * `hasHeadshot`/`headshotVersion` pointer names (D9/D98). Every other live object
 * under `headshots/` and `thumbnails/` is an orphan: the photos the composite load
 * replaced and kept for its undo (D182, OFC-448), a brother's objects left behind
 * at his old id by the renumber's copy (D195), a hard-deleted brother's older
 * versions, or the leftovers of a write that failed between its objects and its
 * pointer (D98). Superseded in-app uploads are purged as they are replaced (D94);
 * nothing else ever cleans up.
 *
 * ⚠ AN ORPHAN IS STILL SERVABLE. `/img/*` checks only that the id in the key exists
 * and that its record is visible — not that the version is the current one. So an
 * object left at an old id stays readable under whoever holds that id now, by
 * anyone who has its URL. That is the privacy reason to sweep, not just tidiness.
 *
 * Deleting a live object in Book's versioned bucket makes it noncurrent, and the
 * bucket keeps noncurrent versions 90 days (D8/D94): a sweep is undoable for that
 * long, object by object, by restoring the generation recorded in the plan.
 *
 * A RACE THIS MUST NOT LOSE. An upload writes its objects FIRST and moves the
 * pointer LAST (D98). Swept with Book serving, an object written a moment before
 * the listing could look orphaned until its pointer lands. Two guards: the plan
 * skips anything created within `minAgeMs`, and the apply re-reads the pointers
 * and deletes only what is still unreferenced, at the exact generation planned.
 */

/** One live object, as listed. */
export interface LiveObject {
  readonly key: string;
  /** The object's GCS generation — the apply deletes exactly this one. */
  readonly generation: string;
  /** ISO 8601 creation time. */
  readonly created: string;
}

/** Each profile's current photo version, or null when it has no headshot. */
export type PointerMap = ReadonlyMap<number, string | null>;

export type OrphanReason = "no-profile" | "not-current";

export interface Orphan {
  readonly key: string;
  readonly generation: string;
  readonly reason: OrphanReason;
}

export interface SweepPlan {
  readonly orphans: Orphan[];
  /** Live objects a profile points at. */
  readonly referenced: number;
  /**
   * Orphan-looking objects younger than the minimum age, or whose age or
   * generation the listing did not give — left alone this run (fail safe: an
   * unknown age could be an upload mid-flight, and without a generation the
   * apply's delete would not be conditional).
   */
  readonly tooNew: string[];
  /** Keys under the image prefixes that are not a well-formed image key — never deleted. */
  readonly unrecognized: string[];
  /** Objects a profile points at that do not exist (the integrity job's concern; reported). */
  readonly missing: string[];
}

/** Why `key` is unreferenced under `pointers`, or null if a profile points at it. */
export function orphanReason(key: string, pointers: PointerMap): OrphanReason | null {
  const parsed = parseImageObjectKey(key);
  if (parsed === null) {
    return null;
  }
  if (!pointers.has(parsed.id)) {
    return "no-profile";
  }
  return pointers.get(parsed.id) === parsed.version ? null : "not-current";
}

export function planSweep(
  objects: readonly LiveObject[],
  pointers: PointerMap,
  now: Date,
  minAgeMs: number,
): SweepPlan {
  const orphans: Orphan[] = [];
  const tooNew: string[] = [];
  const unrecognized: string[] = [];
  const live = new Set<string>();
  let referenced = 0;
  for (const object of objects) {
    live.add(object.key);
    if (parseImageObjectKey(object.key) === null) {
      unrecognized.push(object.key);
      continue;
    }
    const reason = orphanReason(object.key, pointers);
    if (reason === null) {
      referenced++;
    } else if (!oldEnough(object, now, minAgeMs)) {
      tooNew.push(object.key);
    } else {
      orphans.push({ key: object.key, generation: object.generation, reason });
    }
  }
  const missing = missingKeys(pointers, live);
  orphans.sort((a, b) => a.key.localeCompare(b.key));
  return { orphans, referenced, tooNew, unrecognized, missing };
}

/** Keys a profile points at that the listing did not contain. */
function missingKeys(pointers: PointerMap, live: ReadonlySet<string>): string[] {
  const missing: string[] = [];
  for (const [id, version] of pointers) {
    if (version === null) {
      continue;
    }
    for (const key of [headshotObjectKey(id, version), thumbnailObjectKey(id, version)]) {
      if (!live.has(key)) {
        missing.push(key);
      }
    }
  }
  return missing;
}

/** True only when the object is known to be older than `minAgeMs` and has a generation. */
function oldEnough(object: LiveObject, now: Date, minAgeMs: number): boolean {
  const age = now.getTime() - Date.parse(object.created);
  return object.generation !== "" && Number.isFinite(age) && age >= minAgeMs;
}
