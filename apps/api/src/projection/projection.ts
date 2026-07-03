/**
 * The server-side privacy projection — Book's single visibility-enforcement
 * point (DECISIONS D5/D82; ENGINEERING-DESIGN §1.4/§2.4). Every response
 * carrying profile data passes through here and is reduced to the fields the
 * caller's role and the record's privacy settings permit; the backend *omits*
 * disallowed fields rather than returning a value the caller may not see, so a
 * DevTools/network inspection cannot recover what the projection withheld.
 *
 * PHASE 2b. This is the full taxonomy across all three roles. The per-field
 * classification is the shared `FIELD_VISIBILITY` table (DATABASE-SCHEMA §9);
 * this module only *executes* it — iterating that table so a field which is not
 * classified there cannot be emitted, and a field added to `Profile` later
 * cannot leak until it is deliberately classified (the table is exhaustive over
 * `keyof Profile`). Two record-level rules sit above the field loop: the
 * whole-record hide for `unlisted`/`debrothered` records (D124/D115), and the
 * split read (D82) — the bulk projection is **caller-independent**, so it never
 * consults caller identity, and a caller's own full record is delivered
 * out-of-band by {@link projectSelf}.
 */

import { FIELD_VISIBILITY, type Profile, type Role, fieldVisibleToRole } from "@pbe/shared";

/**
 * A profile as projected onto the wire: the shared `Profile` shape with the
 * fields the caller may not see omitted (D3 — one type, the server's only
 * transformation is omission). `id` is always present (public, required), so it
 * is the one guaranteed key; every other field is present only if both visible
 * to the role and set on the record.
 */
export type ProjectedProfile = Partial<Profile> & Pick<Profile, "id">;

/**
 * The caller's own record in full, the out-of-band half of the split read (D82,
 * `GET /api/me`). The owner sees their **entire** record — including their own
 * off-toggle contact values and their own restricted settings — **except**
 * `adminNote` (the staff-internal note the brother must not see, §9) and the
 * `system-internal` fields (`ghostMemberId` and the two D80 consent snapshots),
 * which are never sent to any client. The whole-record hide never applies to
 * one's own record: unlisting/de-brothering hides you from *others*, not from
 * yourself. The omit list mirrors `projectSelf`'s runtime strip (both driven by
 * the exhaustive visibility table) so the type matches what actually ships.
 */
export type SelfProfile = Omit<
  Profile,
  "adminNote" | "ghostMemberId" | "deceasedConsentSnapshot" | "debrotherConsentSnapshot"
>;

/** The `keyof Profile` list, derived once from the exhaustive visibility table. */
const PROFILE_FIELDS = Object.keys(FIELD_VISIBILITY) as (keyof Profile)[];

/**
 * Project the whole dataset to one role's **bulk** view (D82): a uniform,
 * caller-independent per-role projection of every record. Brothers do not see
 * records hidden as a whole (`unlisted` D124 / `debrothered` D115); managers and
 * admins see every record (with those flags set, so their UI can badge/strike
 * them). Within a visible record, each field is included per the shared
 * taxonomy. Because nothing here depends on *who* is calling, two callers of the
 * same role receive byte-identical output — the cross-caller isolation invariant
 * that closes review finding S1.
 */
export function projectForRole(profiles: readonly Profile[], role: Role): ProjectedProfile[] {
  const projected: ProjectedProfile[] = [];
  for (const profile of profiles) {
    if (role === "brother" && hiddenFromBrothers(profile)) {
      continue;
    }
    projected.push(projectFields(profile, role));
  }
  return projected;
}

/**
 * Whether a record is hidden from brothers as a whole (D124 unlisted / D115
 * de-brothered). Exported as Book's **one** definition of the whole-record hide
 * so the bulk projection here and the single-record read in `routes/profiles.ts`
 * enforce byte-identical visibility — the drift D5/D82 exist to prevent (OFC-75).
 */
export function hiddenFromBrothers(profile: Profile): boolean {
  return profile.unlisted || profile.debrothered.isDebrothered;
}

/**
 * The field-level projection of a single record for one bulk role. Walks the
 * exhaustive `FIELD_VISIBILITY` table and copies a field only when the role may
 * see it (consulting the record's own privacy flags for toggle fields) and the
 * value is present — so the wire shape never carries `undefined` keys, and a
 * field absent from the table simply cannot be emitted.
 */
function projectFields(profile: Profile, role: Role): ProjectedProfile {
  const result = { id: profile.id } as ProjectedProfile;
  for (const field of PROFILE_FIELDS) {
    if (field === "id") {
      continue; // already set; always public
    }
    if (fieldVisibleToRole(FIELD_VISIBILITY[field], role, profile.privacy)) {
      copyField(profile, result, field);
    }
  }
  return result;
}

/**
 * Project a **single** record for one role's view — the single-record read
 * (`GET /api/profiles/{id}`) and the PATCH response (API-SPEC §3). This is the
 * field-level projection of one record, the same one the bulk read applies per
 * record. The **whole-record hide** (`unlisted`/`debrothered`) is *not* applied
 * here: it is a brother-bulk-listing rule (the record is omitted from the
 * directory), and the route enforces the single-record consequence — a brother
 * requesting a hidden record gets a `404`, while managers/admins project it
 * normally (badged in their UI). A caller viewing their **own** record uses
 * {@link projectSelf} instead, which never hides and reveals their own
 * off-toggle values.
 */
export function projectRecord(profile: Profile, role: Role): ProjectedProfile {
  return projectFields(profile, role);
}

/**
 * The staff-internal fields the owner nonetheless sees on his **own** record.
 * `unlisted`/`debrothered` are classified `staff-internal` for the *bulk* read
 * (they hide the record from peers, N10), but a brother sees and sets his own
 * listing/status state via the self read. `adminNote` — the other staff-internal
 * field — is deliberately absent, so it stays hidden from the owner (§9).
 */
const OWNER_VISIBLE_STAFF_FIELDS: ReadonlySet<keyof Profile> = new Set(["unlisted", "debrothered"]);

/**
 * Whether the owner sees a field on his own self read. Driven off the exhaustive
 * table so the safe default is *inverted* correctly (OFC-97): `public`/`toggle`/
 * `restricted` are owner-visible (his own data, incl. off-toggle values), a
 * `staff-internal` field is owner-visible only if explicitly allow-listed above,
 * and `system-internal` is never sent to any client. A newly-added `Profile`
 * field therefore cannot leak into `/api/me` by being forgotten — a new
 * staff-internal/system-internal field stays hidden until deliberately opted in.
 */
function ownerSeesField(field: keyof Profile): boolean {
  switch (FIELD_VISIBILITY[field].cls) {
    case "public":
    case "toggle":
    case "restricted":
      return true;
    case "staff-internal":
      return OWNER_VISIBLE_STAFF_FIELDS.has(field);
    case "system-internal":
      return false;
  }
}

/**
 * Project a caller's **own** record for the out-of-band self read (D82). Returns
 * the full record save `adminNote` and `ghostMemberId` — see {@link SelfProfile}.
 * Table-walked (not spread-with-omit) so the exhaustive-table safe default
 * protects this path too: unlike a `{ ...profile }` minus a hard-coded omit list,
 * a new non-owner-visible field cannot ship to the owner unless it is
 * deliberately classified owner-visible (OFC-97). The companion test asserts
 * (against the table) that the excluded classes stay excluded.
 */
export function projectSelf(profile: Profile): SelfProfile {
  const result = { id: profile.id } as ProjectedProfile;
  for (const field of PROFILE_FIELDS) {
    if (field === "id") {
      continue; // always present
    }
    if (ownerSeesField(field)) {
      copyField(profile, result, field);
    }
  }
  return result as SelfProfile;
}

/** Copy an optional field onto the projection only when it is present on the source. */
function copyField<K extends keyof Profile>(
  source: Profile,
  target: ProjectedProfile,
  key: K,
): void {
  const value = source[key];
  if (value !== undefined) {
    (target[key] as Profile[K]) = value;
  }
}
