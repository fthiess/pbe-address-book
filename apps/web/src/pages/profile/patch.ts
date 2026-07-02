import { type Profile, type Role, canWriteField } from "@pbe/shared";
import type { ProfileRecord } from "../../lib/types.js";

/**
 * The edit form's diff engine (§5.7.9). A Save sends a **`PATCH` of only the
 * fields that actually changed** — never the whole record — so the server's
 * verification side-effect (D28) and audit (D61) see exactly what the brother
 * touched, and an unchanged field can never be needlessly re-validated or
 * re-written.
 *
 * Two guards beyond "did it change": the field must be **writable by this role**
 * (the client mirror of the capability matrix, `capabilities.ts` — the server
 * re-checks, but filtering here keeps a 403 from a stray protected/locked field
 * out of the normal path), and equality is **structural** so editing one nested
 * value (a single privacy flag, one address line) diffs correctly.
 */

/** Structural deep equality over the JSON-shaped `Profile` values. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => valuesEqual(value, b[index]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => valuesEqual(aObj[key], bObj[key]));
}

/**
 * Build the minimal patch from `original` → `draft`: every key whose value
 * changed and that the caller's role may write. `original` is what the server
 * sent (the projection or the owner's full record); `draft` is the editing copy.
 */
export function buildPatch(
  original: ProfileRecord,
  draft: ProfileRecord,
  role: Role,
  isOwner: boolean,
): Partial<Profile> {
  const patch: Partial<Profile> = {};
  const keys = new Set<keyof Profile>([
    ...(Object.keys(original) as (keyof Profile)[]),
    ...(Object.keys(draft) as (keyof Profile)[]),
  ]);
  for (const key of keys) {
    if (key === "id" || !canWriteField(role, isOwner, key)) {
      continue;
    }
    if (!valuesEqual(original[key], draft[key])) {
      // Encode a cleared optional field (draft value `undefined`) as an explicit
      // `null` sentinel. `JSON.stringify` drops `undefined`-valued keys, so a
      // removal sent as `undefined` never reaches the wire (OFC-107); `null`
      // survives, and the server funnels a null-valued clearable key into its
      // remove set. A non-cleared value — including a genuine `null` on the
      // null-typed fields (`classYear` unknown, `bigBrotherId` none) — is sent
      // as-is, and the server stores those as values, not removals.
      const value = draft[key];
      (patch as Record<string, unknown>)[key] = value === undefined ? null : value;
    }
  }
  return patch;
}

/** Whether the draft differs from the original in any writable field (the dirty bit). */
export function isDirty(
  original: ProfileRecord,
  draft: ProfileRecord,
  role: Role,
  isOwner: boolean,
): boolean {
  return Object.keys(buildPatch(original, draft, role, isOwner)).length > 0;
}
