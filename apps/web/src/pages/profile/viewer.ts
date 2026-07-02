import { type PrivacyFlags, type Role, canWriteField } from "@pbe/shared";
import type { ProfileRecord } from "../../lib/types.js";

/**
 * Who is looking, relative to the record on screen — the small context the
 * Profile page threads through its sections to choose between an editable, a
 * locked, a private-marked, or an absent rendering (§5.7.2). Derived once in the
 * container from `/api/me` and the record's `id`.
 */
export interface Viewer {
  role: Role;
  isOwner: boolean;
}

/**
 * May this viewer enter edit mode at all? Owner, managers, and admins (§5.7).
 * Derived from the shared capability matrix — "may write any ordinary directory
 * field" (the `editable` rule, of which `firstName` is representative) — so it
 * can't drift from the server's authoritative rules (OFC-121).
 */
export function canEdit(viewer: Viewer): boolean {
  return canWriteField(viewer.role, viewer.isOwner, "firstName");
}

/**
 * Whether a manager should see the **"this field is private" marker** for a
 * toggle field (§5.7.2): a manager, on someone else's record, whose owner has the
 * governing share-flag *off*. The value itself never reached the client (the
 * projection omitted it); the manager still receives the `privacy` flags, so the
 * UI can show that the field exists and is private without revealing it. Peers get
 * neither the value nor the marker; the owner and admins see the value itself.
 */
export function managerSeesPrivate(
  record: ProfileRecord,
  viewer: Viewer,
  flag: keyof PrivacyFlags,
): boolean {
  return (
    viewer.role === "manager" &&
    !viewer.isOwner &&
    record.privacy !== undefined &&
    record.privacy[flag] === false
  );
}

/** Whether the restricted block (consent + verification) is visible at all (§5.7.2). */
export function seesRestricted(viewer: Viewer): boolean {
  return viewer.isOwner || viewer.role === "manager" || viewer.role === "admin";
}
