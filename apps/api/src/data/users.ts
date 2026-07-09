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
 * resets an existing admin/manager to `role: "brother"` and wipes their star list
 * (D5/D82 make role the single visibility gate, so that is a silent privilege
 * downgrade — OFC-98).
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
    // Genuinely absent → create the minimal brother record with just this star.
    await ref.set({ id: profileId, role: "brother", stars: add ? [starId] : [] });
  }
  const snapshot = await ref.get();
  return (snapshot.data() as UserRecord | undefined)?.stars ?? [];
}

/**
 * Raised when a role change would demote the **only remaining admin** — the
 * server-enforced last-admin invariant (API-SPEC §5; D51). Mapped to `409
 * last_admin` by the role route.
 */
export class LastAdminError extends Error {
  constructor() {
    super("The only remaining admin cannot be demoted.");
    this.name = "LastAdminError";
  }
}

/** The result of a role change: the role the target held **before** it (for audit, D106). */
export interface RoleChangeResult {
  /** `brother` for a created-if-absent doc — the role a first sign-in would have given (N44). */
  before: Role;
}

/**
 * The admin-only `users`-collection operations behind 4c-2's privileged actions:
 * the **Change role** function (`PUT /api/users/{id}/role`, with the last-admin
 * invariant and create-if-absent, N44) and the two reference cleanups the admin
 * **delete** needs (`DELETE /api/profiles/{id}`, D98). Grouped as one injected
 * seam so tests drive them against an in-memory double, mirroring `ProfileStore`.
 * The star toggle and first-sign-in create paths stay as the loose functions
 * above — this seam is only the privileged surface.
 */
export interface AdminUserStore {
  /**
   * Set the target's role, enforcing the last-admin invariant **atomically** and
   * creating the `users` doc if absent (N44). Returns the prior role (`brother`
   * for a created doc). Throws {@link LastAdminError} if the change would demote
   * the only admin.
   */
  setRole(id: number, role: Role): Promise<RoleChangeResult>;
  /**
   * The target's current role — `brother` if they have no `users` document yet (a
   * never-signed-in brother, R20/N44). Read by the admin Role control so it can
   * show which role is active (the segmented control's highlighted segment).
   */
  getRole(id: number): Promise<Role>;
  /**
   * Whether deleting `id` would remove the **last remaining admin** — the delete
   * path's dual of the {@link AdminUserStore.setRole} last-admin invariant (D106).
   * True iff `id` is currently an admin and the total admin count is 1. The delete
   * route checks this **before** the Ghost-first step, so a rejection (`409
   * last_admin`) leaves Ghost, GCS, and Book untouched.
   */
  isLastAdmin(id: number): Promise<boolean>;
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

/** The real {@link AdminUserStore}: transactional role changes + reference scrubs over Firestore. */
export class FirestoreAdminUserStore implements AdminUserStore {
  constructor(private readonly db: Firestore) {}

  async setRole(id: number, role: Role): Promise<RoleChangeResult> {
    const ref = this.db.collection(COLLECTION).doc(String(id));
    // One transaction so the admin-count read and the write are atomic: two
    // concurrent demotions of the last two admins can't both observe count == 2
    // and each proceed, leaving zero admins (the invariant D51 exists to hold).
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const before: Role = snapshot.exists ? (snapshot.data() as UserRecord).role : "brother";
      // Demoting an admin: reject if this is the last admin. The count query runs
      // inside the transaction so it's consistent with the write below.
      if (before === "admin" && role !== "admin") {
        const admins = await tx.get(this.db.collection(COLLECTION).where("role", "==", "admin"));
        if (admins.size <= 1) {
          throw new LastAdminError();
        }
      }
      if (snapshot.exists) {
        // Scope the write to `role` only — never touch the caller's stars/id (D106).
        tx.update(ref, { role });
      } else {
        // Create-if-absent (N44): the never-signed-in brother is promotable.
        tx.set(ref, { id, role, stars: [] } satisfies UserRecord);
      }
      return { before };
    });
  }

  async getRole(id: number): Promise<Role> {
    const doc = await this.db.collection(COLLECTION).doc(String(id)).get();
    return doc.exists ? (doc.data() as UserRecord).role : "brother";
  }

  async isLastAdmin(id: number): Promise<boolean> {
    const doc = await this.db.collection(COLLECTION).doc(String(id)).get();
    const role = doc.exists ? (doc.data() as UserRecord).role : undefined;
    if (role !== "admin") {
      return false;
    }
    // A `users where role == admin` count, like setRole's invariant check. Not inside
    // a transaction — the delete spans Ghost/GCS/Firestore and is not one atomic
    // write — but at `--max-instances=1` with delete a rare action, this pre-check is
    // the pragmatic delete-path dual of D106; a concurrent demotion in the narrow
    // window is negligible (and the role path's own transaction still holds).
    const admins = await this.db.collection(COLLECTION).where("role", "==", "admin").get();
    return admins.size <= 1;
  }

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
