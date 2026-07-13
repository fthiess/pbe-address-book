import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * The `users` collection — **private, per-viewer** state, keyed by the brother's
 * Constitution ID (DATABASE-SCHEMA §6.1). Now holds only `stars`: `role` used to
 * live here too but moved onto the `Profile` document (OFC-139), because a role
 * is a property *of the brother* (like class year), not per-viewer state — only
 * `stars` is genuinely per-viewer. A record is created on first sign-in (for
 * stars) or lazily on the first star.
 */
export interface UserRecord {
  /** = the brother's Constitution ID; also the document ID. */
  id: number;
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
 * Read the user's record, creating an empty-stars record if absent (finding R20).
 * Runs in a transaction so two near-simultaneous first logins cannot both create
 * the document and race — the loser re-reads the just-created record. This is the
 * create-if-absent semantics the auth bridge needs (ENGINEERING-DESIGN §2.1). The
 * caller's *role* is no longer established here — it lives on the profile (OFC-139).
 */
export async function ensureUser(db: Firestore, profileId: number): Promise<UserRecord> {
  const ref = db.collection(COLLECTION).doc(String(profileId));
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      return snapshot.data() as UserRecord;
    }
    const record: UserRecord = { id: profileId, stars: [] };
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

/** gRPC status code for a missing document — what `update()` throws on an absent doc. */
const GRPC_NOT_FOUND = 5;

/** Whether a thrown Firestore error is specifically "document does not exist". */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: number }).code === GRPC_NOT_FOUND
  );
}

/**
 * Apply a `stars`-only `arrayUnion`/`arrayRemove` and read back the resulting
 * list. The `users` doc normally already exists (created at first sign-in by
 * {@link ensureUser}); the create-if-absent fallback covers the edge where a star
 * write arrives before that record exists, creating a minimal `brother` record
 * rather than failing the toggle.
 *
 * The fallback is scoped strictly to the **document-absent** case (gRPC
 * `NOT_FOUND`): any other failure — a transient `ABORTED`/`UNAVAILABLE`/
 * `DEADLINE_EXCEEDED`, a network blip — is **re-thrown**, never swallowed. A blind
 * catch here would let a transient error fall into a full-document `set()` that
 * wipes an existing star list (OFC-98). (Role no longer lives in this doc since
 * OFC-139, so the fallback can no longer downgrade a privilege — but the star-loss
 * hazard remains, so the strict NOT_FOUND scoping stands.)
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
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
    // Genuinely absent → create the minimal record with just this star.
    await ref.set({ id: profileId, stars: add ? [starId] : [] } satisfies UserRecord);
  }
  const snapshot = await ref.get();
  return (snapshot.data() as UserRecord | undefined)?.stars ?? [];
}

/**
 * The admin-only `users`-collection operations behind the admin **delete**
 * (`DELETE /api/profiles/{id}`, D98): the two reference cleanups plus the orphan
 * audit. Grouped as one injected seam so tests drive them against an in-memory
 * double, mirroring `ProfileStore`. The star toggle and first-sign-in create
 * paths stay as the loose functions above — this seam is only the privileged
 * surface. (Role change and the last-admin invariant used to live here too; they
 * moved to the profile-write path and an in-memory `ProfileCache.adminCount()`
 * once `role` moved onto the profile — OFC-139.)
 */
export interface AdminUserStore {
  /** Delete the target's `users` doc — idempotent, the Book-side delete step (D98). */
  deleteUser(id: number): Promise<void>;
  /** Remove `id` from every user's `stars` list — the delete's inbound-reference scrub (D98). */
  removeStarFromAll(id: number): Promise<void>;
  /**
   * Every `users` document id (= Constitution ID). Read by the reconciliation
   * audit (D99) to find a `users` doc with no live profile — a `bookInternalOrphan`
   * (D98), typically the residue of a partial delete.
   */
  listUserIds(): Promise<number[]>;
}

/** The real {@link AdminUserStore}: the delete-path reference scrubs over Firestore. */
export class FirestoreAdminUserStore implements AdminUserStore {
  constructor(private readonly db: Firestore) {}

  async deleteUser(id: number): Promise<void> {
    // Idempotent, like the profile delete — a re-run completes a partial delete (D98).
    await this.db.collection(COLLECTION).doc(String(id)).delete();
  }

  async listUserIds(): Promise<number[]> {
    // Doc ids only (no field reads): the audit just needs the id set to diff
    // against live profiles. Firestore's `select()` with no fields returns
    // reference-only documents, so this stays cheap even as the collection grows.
    const snap = await this.db.collection(COLLECTION).select().get();
    return snap.docs.map((doc) => Number(doc.id)).filter((id) => Number.isInteger(id));
  }

  async removeStarFromAll(id: number): Promise<void> {
    // Only the users who actually starred `id` need touching; arrayRemove is a
    // no-op on the rest, and a repeat run is idempotent (R17/D98).
    const holders = await this.db.collection(COLLECTION).where("stars", "array-contains", id).get();
    if (holders.empty) {
      return;
    }
    const batch = this.db.batch();
    for (const doc of holders.docs) {
      batch.update(doc.ref, { stars: FieldValue.arrayRemove(id) });
    }
    await batch.commit();
  }
}
