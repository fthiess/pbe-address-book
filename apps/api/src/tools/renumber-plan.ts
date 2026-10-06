import { headshotObjectKey, thumbnailObjectKey } from "@pbe/shared";
import type { BackupData, CollectionSnapshot } from "../data/backup.js";

/**
 * The pure half of the one-off Constitution-ID renumber (OFC-463, D195): close a
 * one-number gap by shifting every id above it down by one, across every place a
 * snapshot carries a brother's id.
 *
 * WHY THIS EXISTS AT ALL. N6 makes the Constitution ID immutable, and nothing in
 * Book can change one. But the genesis roster carried a non-initiate at #1437, so
 * every brother after him sat one number above his line in the signed Constitution.
 * He was removed by the ordinary admin delete; this closes the gap he left. It runs
 * over a backup snapshot and the result goes back in through the offline restore
 * (D101), so the restore's own validation, safety snapshot and forensic entry all
 * apply — the only new code that touches data is this function, and it touches no
 * database.
 *
 * WHAT CARRIES AN ID (the inventory, verified against the code 2026-10-06; every
 * `BrotherId`-typed field in `@pbe/shared` plus the two collections keyed by one):
 * - `profiles`: the doc key, `id`, `bigBrotherId`, `verifiedBy`, and the
 *   `verifiedBy` inside `deceasedConsentSnapshot` / `debrotherConsentSnapshot`;
 * - `users`: the doc key, `id`, and every entry of `stars`;
 * - `config/systemBanner`: `updatedBy`.
 * Outside the snapshot, and so not this function's job: the image objects (the
 * copy list it returns), `sessions` (purged, not remapped) and `bugReports`
 * (left as is, Forrest's call — transient triage data no backup carries, N61).
 *
 * WHAT IT REFUSES. Anything that would make the shift ambiguous: a profile still
 * at the gap, any reference to the gap (it would silently become a reference to
 * the brother who moves into it), a doc key that disagrees with its `id`, or a
 * shifted range that is not exactly `gap+1 … gap+expectShifted`. The operator
 * states the expected count up front, so a wrong `--gap` cannot pass unnoticed.
 */

export interface RenumberOptions {
  /** The id that was vacated; every id above it moves down by one. */
  readonly gap: number;
  /** How many profiles the operator expects to move (the run refuses otherwise). */
  readonly expectShifted: number;
}

/** One brother's move. */
export interface IdMove {
  readonly from: number;
  readonly to: number;
}

/** One image object to copy to its new id's prefix. The version token is unchanged. */
export interface ImageCopy {
  readonly from: string;
  readonly to: string;
}

/**
 * A string field that names a shifted id in a URL Book itself mints. Reported,
 * never rewritten: free text belongs to the person who wrote it. Carries the
 * document and field path only — never the value (D61).
 */
export interface FreeTextHit {
  readonly collection: "profiles" | "config";
  readonly docId: string;
  readonly path: string;
}

/** Counts of every field the transform changed, for the operator's report. */
export interface RenumberCounts {
  profilesMoved: number;
  bigBrotherIds: number;
  verifiedBy: number;
  consentSnapshotVerifiedBy: number;
  usersMoved: number;
  stars: number;
  bannerUpdatedBy: number;
}

export type RenumberResult =
  | {
      readonly ok: true;
      readonly collections: BackupData;
      readonly moves: IdMove[];
      readonly imageCopies: ImageCopy[];
      readonly freeTextHits: FreeTextHit[];
      readonly counts: RenumberCounts;
    }
  | { readonly ok: false; readonly errors: string[] };

const CONSENT_SNAPSHOT_FIELDS = ["deceasedConsentSnapshot", "debrotherConsentSnapshot"] as const;

/** URL shapes Book mints that carry an id: `/brother/1450`, `?near=brother:1450`, `constitutionId=1450`. */
const ID_IN_URL = /(?:\/brother\/|near=brother(?::|%3A)|constitutionId=)(\d+)/giu;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Close the gap at `options.gap` in a snapshot's collections. Pure: the input is
 * not mutated, and every document the shift does not touch is returned as the
 * same object.
 */
export function renumberSnapshot(
  collections: BackupData,
  options: RenumberOptions,
): RenumberResult {
  const { gap, expectShifted } = options;
  if (!Number.isInteger(gap) || gap <= 0) {
    return { ok: false, errors: [`--gap must be a positive integer (got ${gap}).`] };
  }
  if (!Number.isInteger(expectShifted) || expectShifted <= 0) {
    return { ok: false, errors: [`--expect must be a positive integer (got ${expectShifted}).`] };
  }
  const errors = preconditionErrors(collections, gap, expectShifted);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const run: ShiftRun = {
    gap,
    counts: {
      profilesMoved: 0,
      bigBrotherIds: 0,
      verifiedBy: 0,
      consentSnapshotVerifiedBy: 0,
      usersMoved: 0,
      stars: 0,
      bannerUpdatedBy: 0,
    },
    moves: [],
    imageCopies: [],
  };
  const profiles = collections.profiles.map((doc) => shiftProfile(doc, run));
  const users = collections.users.map((doc) => shiftUser(doc, run));
  const config = collections.config.map((doc) => shiftBanner(doc, run));
  run.moves.sort((a, b) => a.from - b.from);

  return {
    ok: true,
    collections: { profiles, users, config },
    moves: run.moves,
    imageCopies: run.imageCopies,
    freeTextHits: findFreeTextHits(collections, gap),
    counts: run.counts,
  };
}

/** Everything that makes the shift ambiguous; empty when it is safe to run. */
function preconditionErrors(collections: BackupData, gap: number, expectShifted: number): string[] {
  const errors: string[] = [];
  for (const doc of [...collections.profiles, ...collections.users]) {
    const id = doc.data.id;
    if (typeof id !== "number" || !Number.isInteger(id) || String(id) !== doc.id) {
      errors.push(`Document "${doc.id}" does not carry a matching integer \`id\`.`);
    }
  }
  if (collections.profiles.some((doc) => doc.data.id === gap)) {
    errors.push(
      `Profile #${gap} still exists — delete it (Book's admin delete) before closing the gap.`,
    );
  }
  const shifted = collections.profiles
    .map((doc) => doc.data.id)
    .filter((id): id is number => isAbove(id, gap))
    .sort((a, b) => a - b);
  const contiguous = shifted.every((id, i) => id === gap + 1 + i);
  if (shifted.length !== expectShifted || !contiguous) {
    const found = shifted.length > 0 ? ` (#${shifted[0]}–#${shifted[shifted.length - 1]})` : "";
    errors.push(
      `Expected exactly #${gap + 1}–#${gap + expectShifted} (${expectShifted}) above the gap; found ${shifted.length}${found}${contiguous ? "" : ", not contiguous"}.`,
    );
  }
  for (const ref of references(collections)) {
    if (ref.value === gap) {
      errors.push(
        `${ref.where} still references #${gap}; it would silently move to the brother who takes that number.`,
      );
    }
  }
  return errors;
}

/** The accumulators one run threads through the per-document shifts. */
interface ShiftRun {
  readonly gap: number;
  readonly counts: RenumberCounts;
  readonly moves: IdMove[];
  readonly imageCopies: ImageCopy[];
}

function isAbove(value: unknown, gap: number): value is number {
  return typeof value === "number" && value > gap;
}

function shiftProfile(doc: CollectionSnapshot, run: ShiftRun): CollectionSnapshot {
  const { gap, counts } = run;
  const data = { ...doc.data };
  let changed = false;
  if (isAbove(data.id, gap)) {
    const from = data.id;
    data.id = from - 1;
    counts.profilesMoved++;
    run.moves.push({ from, to: from - 1 });
    changed = true;
    const version = data.headshotVersion;
    if (data.hasHeadshot === true && typeof version === "string") {
      run.imageCopies.push(
        { from: headshotObjectKey(from, version), to: headshotObjectKey(from - 1, version) },
        { from: thumbnailObjectKey(from, version), to: thumbnailObjectKey(from - 1, version) },
      );
    }
  }
  if (isAbove(data.bigBrotherId, gap)) {
    data.bigBrotherId = data.bigBrotherId - 1;
    counts.bigBrotherIds++;
    changed = true;
  }
  if (isAbove(data.verifiedBy, gap)) {
    data.verifiedBy = data.verifiedBy - 1;
    counts.verifiedBy++;
    changed = true;
  }
  for (const field of CONSENT_SNAPSHOT_FIELDS) {
    const snapshot = data[field];
    if (isPlainObject(snapshot) && isAbove(snapshot.verifiedBy, gap)) {
      data[field] = { ...snapshot, verifiedBy: snapshot.verifiedBy - 1 };
      counts.consentSnapshotVerifiedBy++;
      changed = true;
    }
  }
  return changed ? { id: String(data.id), data } : doc;
}

function shiftUser(doc: CollectionSnapshot, run: ShiftRun): CollectionSnapshot {
  const { gap, counts } = run;
  const data = { ...doc.data };
  let changed = false;
  if (isAbove(data.id, gap)) {
    data.id = data.id - 1;
    counts.usersMoved++;
    changed = true;
  }
  if (Array.isArray(data.stars) && data.stars.some((star) => isAbove(star, gap))) {
    data.stars = data.stars.map((star) => {
      if (!isAbove(star, gap)) {
        return star;
      }
      counts.stars++;
      return star - 1;
    });
    changed = true;
  }
  return changed ? { id: String(data.id), data } : doc;
}

function shiftBanner(doc: CollectionSnapshot, run: ShiftRun): CollectionSnapshot {
  const updatedBy = doc.data.updatedBy;
  if (doc.id !== "systemBanner" || !isAbove(updatedBy, run.gap)) {
    return doc;
  }
  run.counts.bannerUpdatedBy++;
  return { id: doc.id, data: { ...doc.data, updatedBy: updatedBy - 1 } };
}

function findFreeTextHits(collections: BackupData, gap: number): FreeTextHit[] {
  const hits: FreeTextHit[] = [];
  const scan = (collection: FreeTextHit["collection"], docs: readonly CollectionSnapshot[]) => {
    for (const doc of docs) {
      scanStrings(doc.data, "", (path, value) => {
        if (mentionsShiftedId(value, gap)) {
          hits.push({ collection, docId: doc.id, path });
        }
      });
    }
  };
  scan("profiles", collections.profiles);
  scan("config", collections.config);
  return hits;
}

/** Every id-valued reference in a snapshot, labelled for an error message. */
function* references(collections: BackupData): Generator<{ where: string; value: unknown }> {
  for (const doc of collections.profiles) {
    yield { where: `Profile "${doc.id}" \`bigBrotherId\``, value: doc.data.bigBrotherId };
    yield { where: `Profile "${doc.id}" \`verifiedBy\``, value: doc.data.verifiedBy };
    for (const field of CONSENT_SNAPSHOT_FIELDS) {
      const snapshot = doc.data[field];
      if (isPlainObject(snapshot)) {
        yield { where: `Profile "${doc.id}" \`${field}.verifiedBy\``, value: snapshot.verifiedBy };
      }
    }
  }
  for (const doc of collections.users) {
    yield { where: `\`users\` document "${doc.id}"`, value: doc.data.id };
    if (Array.isArray(doc.data.stars)) {
      for (const star of doc.data.stars) {
        yield { where: `\`users\` document "${doc.id}" \`stars\``, value: star };
      }
    }
  }
  for (const doc of collections.config) {
    yield { where: `\`config\` document "${doc.id}" \`updatedBy\``, value: doc.data.updatedBy };
  }
}

function mentionsShiftedId(value: string, gap: number): boolean {
  for (const match of value.matchAll(ID_IN_URL)) {
    if (Number(match[1]) >= gap) {
      return true;
    }
  }
  return false;
}

/** Visit every string in a JSON value, with its dotted/indexed path. */
function scanStrings(
  value: unknown,
  path: string,
  visit: (path: string, value: string) => void,
): void {
  if (typeof value === "string") {
    visit(path, value);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => scanStrings(item, `${path}[${i}]`, visit));
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      scanStrings(item, path === "" ? key : `${path}.${key}`, visit);
    }
  }
}
