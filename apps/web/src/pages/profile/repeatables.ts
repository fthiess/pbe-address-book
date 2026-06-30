import type { EmergencyContact, Link } from "@pbe/shared";
import type { ProfileRecord } from "../../lib/types.js";

/**
 * Repeatable-row helpers shared by the edit form's state engine
 * (`useProfileDraft`) and the progressive-disclosure editors (`RepeatableEditors`).
 * The editors keep a trailing **blank** row visible so the next link / contact can
 * be filled in place; that row is not data, so it is dropped — here, in one place —
 * before the shared validator, the patch diff, and the dirty check ever see it
 * (§5.7.5). Blank rows only ever sit at the end (the Add affordance is disabled
 * while one is open), so a kept row's sanitized index still matches its rendered
 * index and the per-row error lookup stays aligned.
 */

/** A link with neither a label nor a URL — an untouched "Add a link" row. */
export function isBlankLink(link: Link): boolean {
  return (link.label ?? "").trim() === "" && (link.url ?? "").trim() === "";
}

/** An emergency contact with no name, phone, or email — an untouched added row. */
export function isBlankContact(contact: EmergencyContact): boolean {
  return (
    (contact.name ?? "").trim() === "" &&
    (contact.phone ?? "").trim() === "" &&
    (contact.email ?? "").trim() === ""
  );
}

/** The draft with blank trailing link/contact rows removed (cleared → `undefined`). */
export function sanitizeRepeatables(draft: ProfileRecord): ProfileRecord {
  let next = draft;
  if (draft.links) {
    const kept = draft.links.filter((link) => !isBlankLink(link));
    if (kept.length !== draft.links.length) {
      next = { ...next, links: kept.length > 0 ? kept : undefined };
    }
  }
  if (draft.emergencyContacts) {
    const kept = draft.emergencyContacts.filter((contact) => !isBlankContact(contact));
    if (kept.length !== draft.emergencyContacts.length) {
      next = { ...next, emergencyContacts: kept.length > 0 ? kept : undefined };
    }
  }
  return next;
}
