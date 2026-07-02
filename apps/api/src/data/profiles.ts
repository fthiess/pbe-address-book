import type { Profile } from "@pbe/shared";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";

/**
 * The profile write path (API-SPEC §1.4/§3; ENGINEERING-DESIGN §2.6; DECISIONS
 * D25). Reads flow through the in-memory cache (`cache.ts`); **writes** flow
 * through here, as a single **conditional** Firestore operation keyed on the
 * server-authoritative `updateTime` concurrency token. This is optimistic
 * concurrency done the strong way: Firestore enforces the precondition natively,
 * so the check is one atomic conditional write with no read-modify-write race.
 *
 * The token is surfaced to clients as an opaque **`ETag`** and required back as
 * **`If-Match`**; a write whose token no longer matches the stored record is
 * rejected as a {@link StaleWriteError} (→ HTTP `412`). The store is an injected
 * interface so route tests can drive the whole PATCH flow — including the 412
 * path — against an in-memory double, while a Firestore-emulator test proves the
 * *real* `lastUpdateTime` precondition semantics.
 */

/** Raised when the `If-Match` token no longer matches the stored record (→ 412). */
export class StaleWriteError extends Error {
  constructor() {
    super("The record changed since it was read.");
    this.name = "StaleWriteError";
  }
}

/** Raised when the target document is gone at write time (TOCTOU; → 404). */
export class MissingProfileError extends Error {
  constructor() {
    super("No such profile.");
    this.name = "MissingProfileError";
  }
}

/**
 * One conditional write: the top-level fields to set, the top-level fields to
 * delete (the verification clear, D28), and the expected concurrency token.
 * Modeled as set/remove rather than a full record so the write touches only what
 * changed and a removed field is genuinely removed (not left at its old value).
 */
export interface ProfileWrite {
  /** Top-level `Profile` fields to set to the given values. */
  readonly set: Partial<Profile>;
  /** Top-level `Profile` field names to delete from the document. */
  readonly remove: readonly (keyof Profile)[];
  /** The concurrency token the caller read the record at (the `If-Match` value). */
  readonly precondition: string;
}

/** The write seam injected into the server (real = Firestore; tests = in-memory). */
export interface ProfileStore {
  /**
   * Apply a conditional write to profile `id`, returning the **new** concurrency
   * token. Throws {@link StaleWriteError} if the precondition no longer holds and
   * {@link MissingProfileError} if the document is gone.
   */
  update(id: number, write: ProfileWrite): Promise<string>;
}

const COLLECTION = "profiles";

/**
 * The concurrency token a record carries before it has been written through this
 * store — assigned by `ProfileCache.load` for the test/seed paths (the
 * Firestore-hydrated path uses each document's real `updateTime` instead). The
 * in-memory test double seeds the same value so a freshly loaded record's cache
 * token and store token agree, exactly as they do via Firestore in production.
 */
export const INITIAL_CONCURRENCY_TOKEN = "0.0";

/**
 * Encode a Firestore `updateTime` as an opaque ETag token. Full nanosecond
 * precision is preserved (not `toMillis()`), so two writes inside the same
 * millisecond cannot collide into one token.
 */
export function encodeToken(updateTime: Timestamp): string {
  return `${updateTime.seconds}.${updateTime.nanoseconds}`;
}

/** The exact shape {@link encodeToken} emits: `<seconds>.<nanoseconds>`, digits only. */
const TOKEN_RE = /^\d+\.\d+$/u;

/**
 * Decode an ETag token back to the `Timestamp` Firestore wants as a
 * precondition, or `null` if the token is not a well-formed `<sec>.<nanos>`.
 * A client-supplied `If-Match` that is any other opaque value (`"abc"`, a quoted
 * tag, `*`) would otherwise yield `Timestamp(NaN, NaN)`, whose constructor throws
 * an error carrying no gRPC `.code` — so the store's catch (which maps only
 * FAILED_PRECONDITION/NOT_FOUND) would rethrow it as a 500 instead of the
 * intended 412 stale-write reconcile (OFC-90). Returning `null` lets the store
 * treat a malformed token as a failed precondition.
 */
export function decodeToken(token: string): Timestamp | null {
  if (!TOKEN_RE.test(token)) {
    return null;
  }
  const [seconds, nanoseconds] = token.split(".");
  return new Timestamp(Number(seconds), Number(nanoseconds));
}

/** Firestore/gRPC status codes the write path maps onto HTTP outcomes. */
const GRPC_NOT_FOUND = 5;
const GRPC_FAILED_PRECONDITION = 9;

/** The real store: a conditional `update()` against the live `profiles` doc. */
export class FirestoreProfileStore implements ProfileStore {
  constructor(private readonly db: Firestore) {}

  async update(id: number, write: ProfileWrite): Promise<string> {
    const ref = this.db.collection(COLLECTION).doc(String(id));
    // A field listed in `remove` becomes a delete sentinel; everything in `set`
    // is written as-is. `update()` replaces named fields and leaves the rest, so
    // a structured field (e.g. `address`) carried whole in `set` is replaced
    // whole — the PATCH semantics the SPA sends (changed fields, full sub-objects).
    const precondition = decodeToken(write.precondition);
    // A malformed token never matched any record we issued — treat it as a stale
    // write (→ 412 reconcile), not a 500 (OFC-90).
    if (precondition === null) {
      throw new StaleWriteError();
    }
    const data: Record<string, unknown> = { ...write.set };
    for (const field of write.remove) {
      data[field] = FieldValue.delete();
    }
    try {
      const result = await ref.update(data, { lastUpdateTime: precondition });
      return encodeToken(result.writeTime);
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === GRPC_FAILED_PRECONDITION) {
        throw new StaleWriteError();
      }
      if (code === GRPC_NOT_FOUND) {
        throw new MissingProfileError();
      }
      throw error;
    }
  }
}
