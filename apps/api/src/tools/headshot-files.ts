/**
 * The naming and versioning contract shared by `csv-to-snapshot.ts` (which stamps
 * `headshotVersion` into the snapshot) and `load-headshots.ts` (which uploads the
 * bytes under that version). Pure, so the agreement between the two is testable.
 */
import { createHash } from "node:crypto";

/**
 * A PRIMARY prepared headshot is `<NNNN>-<First>-<Last>-<YYYY>.png`, where the
 * photo pipeline writes `0` for an unknown class year (`roster.py`); alternates
 * carry a trailing `-<n>` before the extension and are ignored (the pipeline's
 * README: "the un-suffixed file is the primary"). Anything else that is a `.png`
 * is *unrecognised* and reported, never silently skipped.
 */
const PRIMARY_RE = /^(\d{4})-.+-(?:\d{4}|0)\.png$/u;
const ALTERNATE_RE = /^(\d{4})-.+-(?:\d{4}|0)-\d+\.png$/u;

/** The Constitution ID a primary headshot file belongs to, or null if not one. */
export function primaryHeadshotId(fileName: string): number | null {
  const match = PRIMARY_RE.exec(fileName);
  if (!match?.[1]) {
    return null;
  }
  return Number(match[1]);
}

export interface HeadshotFiles {
  /** id → file name, primaries only. */
  readonly primaries: Map<number, string>;
  /** Ids that have MORE than one primary — a refusal, the operator must pick. */
  readonly duplicates: number[];
  /** `.png` names that are neither a primary nor an alternate — reported, not used. */
  readonly unrecognised: string[];
}

/** Classify a directory listing by the naming contract above. */
export function classifyHeadshotFiles(names: readonly string[]): HeadshotFiles {
  const primaries = new Map<number, string>();
  const duplicates: number[] = [];
  const unrecognised: string[] = [];
  for (const name of names) {
    const id = primaryHeadshotId(name);
    if (id !== null) {
      if (primaries.has(id)) {
        duplicates.push(id);
      } else {
        primaries.set(id, name);
      }
    } else if (name.toLowerCase().endsWith(".png") && !ALTERNATE_RE.test(name)) {
      unrecognised.push(name);
    }
  }
  return { primaries, duplicates, unrecognised };
}

/**
 * The `headshotVersion` token for a photo: a content hash, so re-running either
 * tool on the same bytes yields the same object key (idempotent uploads), and a
 * changed photo changes the key (the image bucket's immutable-cache posture, D94).
 * Fits the object-key grammar `[A-Za-z0-9._-]+` (`parseImageObjectKey`).
 */
export function headshotVersionOf(bytes: Uint8Array): string {
  return `g${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
}
