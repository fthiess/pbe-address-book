import type { Role } from "@pbe/shared";
import type { Firestore } from "firebase-admin/firestore";

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
