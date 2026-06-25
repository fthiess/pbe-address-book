/**
 * Shared domain types — the one source of truth imported by both the SPA and
 * the backend (DECISIONS D3, "one shared `Profile` type").
 *
 * NOTE (Phase 0): this is a deliberately partial first cut. The full `Profile`
 * schema, its sub-types, and the field-visibility taxonomy land in Phase 2,
 * built directly from `docs/initial-build/DATABASE-SCHEMA.md`. What is here is
 * enough to (a) prove the shared package is importable by every workspace and
 * (b) give the deterministic fake-data generator (D65) a real shape to target.
 * Expect this file to grow — not change shape arbitrarily — in Phase 2.
 */

/** The three roles in the capability matrix (D19). */
export type Role = "brother" | "manager" | "admin";

/**
 * Field-visibility classes (D16 / D44 / D56). Placeholder enumeration for
 * Phase 0; the per-field taxonomy and the server-side projection that enforces
 * it are Phase 2 work.
 */
export type VisibilityClass =
  | "public"
  | "toggle"
  | "restricted"
  | "private"
  | "staff-internal"
  | "system-internal";

/**
 * A brother's profile. First-cut field set for Phase 0 (see the file note).
 * The Constitution signature-page facts (full name, class year, Constitution
 * ID) are the only immutable, required data; everything else is editable.
 */
export interface Profile {
  /** Firestore document id. */
  readonly id: string;
  /** The Constitution signing number — immutable (DATABASE-SCHEMA §1). */
  readonly constitutionId: number;
  /** Display name as constructed per the Canonical Name rules (D15; Phase 2). */
  canonicalName: string;
  firstName: string;
  lastName: string;
  /** Four-digit pledge/initiation class year, e.g. 1984. */
  classYear: number;
  email: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  /** Whether the brother has passed away (In Memoriam handling, D36/D49). */
  deceased: boolean;
  /** Whole-record hide from the brother projection (D124); managers/admins still see it. */
  unlisted: boolean;
  /** Consent flag: brothers may reach this member by email (D45). */
  allowDirectoryEmail: boolean;
  /** Monotonic headshot version; null when no headshot has been uploaded (D17/D47). */
  headshotVersion: number | null;
}
