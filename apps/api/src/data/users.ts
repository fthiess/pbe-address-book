import type { Role } from "@pbe/shared";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * The `users` collection — private per-user state (role + stars), keyed by the
 * brother's Constitution ID (DATABASE-SCHEMA §6.1). Book holds its own role
 * table independent of Ghost (ENGINEERING-DESIGN §2.4); a brother's record is
 * created on their first successful sign-in.
 */
export interface UserRecord {
  /** = the brother's Constitution ID; also the document ID. */
  id: number;
  role: Role;
  /** Brother IDs this user has personally starred. */
  stars: number[];
}

const COLLECTION = "users";

/**
 * Read a user's record, or null if they have never signed in. Used by `/api/me`
 * to surface the caller's role and stars.
 */
export async function getUser(db: Firestore, profileId: number): Promise<UserRecord | null> {
  const snapshot = await db.collection(COLLECTION).doc(String(profileId)).get();
  return snapshot.exists ? (snapshot.data() as UserRecord) : null;
}

/**
 * Read the user's record, creating it as a `brother` if absent (finding R20).
 * Runs in a transaction so two near-simultaneous first logins cannot both create
 * the document and race — the loser re-reads the just-created record. This is the
 * create-if-absent semantics the auth bridge needs (ENGINEERING-DESIGN §2.1).
 */
export async function ensureUser(db: Firestore, profileId: number): Promise<UserRecord> {
  const ref = db.collection(COLLECTION).doc(String(profileId));
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      return snapshot.data() as UserRecord;
    }
    const record: UserRecord = { id: profileId, role: "brother", stars: [] };
    tx.set(ref, record);
    return record;
  });
}

/**
 * Add `starId` to a user's private star list and return the resulting list
 * (API-SPEC §4, `PUT /api/me/stars/{id}`). Implemented as a Firestore
 * **`arrayUnion`** so the write is idempotent — a repeat add is a no-op (finding
 * R17) — and **scoped to the `stars` field exclusively**, so this path can never
 * touch `role` or `id` on the shared `users` doc (D106).
 */
export function addStar(db: Firestore, profileId: number, starId: number): Promise<number[]> {
  return mutateStars(db, profileId, FieldValue.arrayUnion(starId), starId, true);
}

/**
 * Remove `starId` from a user's private star list and return the resulting list
 * (API-SPEC §4, `DELETE /api/me/stars/{id}`). Implemented as a Firestore
 * **`arrayRemove`** so removing an absent id is a no-op (finding R17), scoped to
 * the `stars` field only (D106).
 */
export function removeStar(db: Firestore, profileId: number, starId: number): Promise<number[]> {
  return mutateStars(db, profileId, FieldValue.arrayRemove(starId), starId, false);
}

/**
 * Apply a `stars`-only `arrayUnion`/`arrayRemove` and read back the resulting
 * list. The `users` doc normally already exists (created at first sign-in by
 * {@link ensureUser}); the create-if-absent fallback covers the edge where a star
 * write arrives before that record exists, creating a minimal `brother` record
 * rather than failing the toggle.
 */
async function mutateStars(
  db: Firestore,
  profileId: number,
  op: FieldValue,
  starId: number,
  add: boolean,
): Promise<number[]> {
  const ref = db.collection(COLLECTION).doc(String(profileId));
  try {
    await ref.update({ stars: op });
  } catch {
    await ref.set({ id: profileId, role: "brother", stars: add ? [starId] : [] });
  }
  const snapshot = await ref.get();
  return (snapshot.data() as UserRecord | undefined)?.stars ?? [];
}
