import type { ValidationIssue } from "@pbe/shared";
import type { FastifyReply } from "fastify";
import { MissingProfileError, StaleWriteError } from "../data/profiles.js";
import { GhostDuplicateEmailError } from "../identity/ghost-lifecycle.js";
import { GhostStepError } from "./ghost-push.js";
import type { RecordLock } from "./record-lock.js";

/**
 * The single enforcement point for the N65 Ghost-first ordering (OFC-220/226).
 *
 * Every write that advances a record's concurrency token — `PATCH`, the status
 * actions (`verify` / `deceased` / `debrother`), and the headshot pointer write —
 * runs through {@link runRecordWrite}, so they all **serialize on the record id**.
 * That closes the divergence OFC-220 found: without it, a concurrent
 * token-advancing write (a verify, a headshot) could commit *during* another
 * write's awaited Ghost push, invalidating its `If-Match` and forcing a `412`
 * **after** Ghost was already mutated — Ghost ahead of Book, the exact window N65
 * claims to close. Because they now serialize, nothing commits between a Ghost push
 * and its Book commit.
 *
 * The wrapper owns the ordering `prepare → ghostStep → commit`:
 *  - `prepare` runs first, **inside the lock** — the place to (re-)read current
 *    state and build the write, so a consent snapshot or a pushed-field diff
 *    reflects any write that committed before this task acquired the lock
 *    (OFC-221). It may throw a mapped error (e.g. {@link StaleWriteError} for a
 *    failed `If-Match` preflight, {@link WriteValidationError} for a 422) to abort
 *    before any Ghost call.
 *  - `ghostStep` (optional) is the Ghost-first mutation; it throws
 *    {@link GhostStepError} to abort clean with a `502`. Writes with no Ghost
 *    coupling (verify, headshot) omit it and still serialize.
 *  - `commit` is the Book write; its `StaleWriteError` / `MissingProfileError`
 *    propagate for the caller to map.
 *
 * The caller maps any thrown error with {@link replyWriteError}, keeping the
 * status-code mapping identical across all four handlers.
 */
export async function runRecordWrite<P, T>(
  lock: RecordLock,
  id: number,
  steps: {
    prepare: () => Promise<P> | P;
    ghostStep?: (prepared: P) => Promise<void>;
    commit: (prepared: P) => Promise<T>;
  },
): Promise<T> {
  return lock.run(id, async () => {
    const prepared = await steps.prepare();
    if (steps.ghostStep) {
      await steps.ghostStep(prepared);
    }
    return steps.commit(prepared);
  });
}

/** Thrown from a `prepare` step to abort a write with a `422` carrying field issues. */
export class WriteValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super("validation_failed");
    this.name = "WriteValidationError";
  }
}

/**
 * Map a write-path error to its HTTP reply, identically for every record-write
 * handler (OFC-226): an email colliding with an existing Ghost member → `422` on
 * `email` (OFC-232, Option B — a permanent collision, not a retryable outage); a
 * Ghost-step failure → `502 { error: code }` (Book untouched, N65); a stale
 * `If-Match` / precondition → `412`; a vanished record → `404`; a validation
 * failure → `422` with the field issues. Anything else is rethrown so the server
 * error handler genericizes it (OFC-149).
 */
export function replyWriteError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof GhostDuplicateEmailError) {
    return reply.code(422).send({
      error: "validation_failed",
      issues: [
        {
          field: "email",
          message:
            "This email address already exists in PBE News (Ghost) under an account not linked to Book. An administrator must reconcile it before it can be added here.",
        },
      ],
    });
  }
  if (error instanceof GhostStepError) {
    return reply.code(502).send({ error: error.code });
  }
  if (error instanceof StaleWriteError) {
    return reply
      .code(412)
      .send({ error: "stale_write", message: "This record changed since you loaded it." });
  }
  if (error instanceof MissingProfileError) {
    return reply.code(404).send({ error: "not_found", message: "No such brother." });
  }
  if (error instanceof WriteValidationError) {
    return reply.code(422).send({ error: "validation_failed", issues: error.issues });
  }
  throw error;
}
