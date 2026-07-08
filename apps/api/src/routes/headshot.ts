import { type Profile, canActOnProfile, headshotObjectKey, thumbnailObjectKey } from "@pbe/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { ProfileCache } from "../data/cache.js";
import { ImageBucketUnconfiguredError, type ImageStore } from "../data/images.js";
import { MissingProfileError, type ProfileStore } from "../data/profiles.js";
import { effectiveRole } from "../identity/types.js";
import { UnprocessableImageError, encodeHeadshot } from "../images/encode.js";
import { writeRateLimit } from "../security/rate-limit.js";
import type { Clock } from "./profiles.js";
import type { RecordLock } from "./record-lock.js";
import { runRecordWrite } from "./record-write.js";
import { traceId } from "./trace.js";

/** The content type of every object this pipeline stores. */
const WEBP = "image/webp";

/** The upload route's body ceiling (8 MB, N42): a downscaled client upload is well under 2 MB. */
const UPLOAD_BODY_LIMIT = 8 * 1024 * 1024;

/** The audited action for each endpoint (used for both the ok and denied entries). */
type HeadshotAction = "headshot.update" | "headshot.remove";

/** The collaborators the headshot sub-resource needs. */
export interface HeadshotRouteDeps {
  cache: ProfileCache;
  gate: preHandlerHookHandler;
  /** The profile write path — the headshot uses its **unconditional** pointer advance (N42). */
  store: ProfileStore;
  /** The private-bucket image store (D126); headshot/thumbnail objects live here. */
  imageStore: ImageStore;
  audit: AuditLog;
  clock: Clock;
  /**
   * Mint the opaque, collision-free `headshotVersion` token (N42/R16). Injected so
   * tests are deterministic and so it can never be a guessable sequential counter.
   */
  mintVersion: () => string;
  /**
   * The shared per-record write serializer (OFC-220). The headshot pointer write
   * advances the profile's concurrency token, so it must serialize with the
   * Ghost-gated writes (PATCH/deceased/debrother) — a pointer advance landing
   * during a PATCH's awaited Ghost push would otherwise 412 that PATCH after Ghost
   * was already mutated.
   */
  recordLock: RecordLock;
}

/**
 * The headshot sub-resource: `PUT`/`DELETE /api/profiles/{id}/headshot` (API-SPEC
 * §6; DECISIONS D17/D47/D94/D98/N42). The **image slice** of the Profile page.
 *
 * Registered inside an **encapsulated Fastify plugin scope** (OFC-131) so the raw-
 * image content-type parser applies only to these routes — a Fastify parser on the
 * root instance is global, which would make `Content-Type: image/png` yield a raw
 * Buffer body on unrelated routes (e.g. PATCH).
 *
 * Both endpoints authorize on the same object-level predicate as PATCH (owner,
 * manager, or admin at the caller's **effective** role — N31) but carry **no
 * `If-Match`**: the headshot is a singleton sub-resource written unconditionally,
 * and its write advances the profile document's concurrency token, which the
 * response returns as a fresh `ETag` so the SPA's container does not go stale
 * mid-Save (N42).
 *
 *  - **`PUT`** validates the bytes by magic-byte inspection (never the declared
 *    type — D107), re-encodes to a 512² headshot + 96² thumbnail WEBP, writes the
 *    objects **first** and advances the `headshotVersion` pointer **last** (D98),
 *    then purges the superseded prior version's objects (D94). Serialized through
 *    a concurrency-1 semaphore so a decode spike cannot OOM the single instance.
 *  - **`DELETE`** flips `hasHeadshot` off **first**, then purges the objects — the
 *    safe order for a removal (the pointer never names deleted objects).
 *
 * Neither touches verification — the D28 coupling is a PATCH-path side-effect
 * only (N42).
 */
export function registerHeadshotRoutes(app: FastifyInstance, deps: HeadshotRouteDeps): void {
  const { cache, gate, store, imageStore, audit, clock, mintVersion, recordLock } = deps;

  // An encapsulated child scope (OFC-131): the raw-image parser and the 8 MB
  // per-route body limit live here and do not shadow body parsing for any route
  // outside this plugin. The default JSON parser cannot read image bytes, and the
  // default 1 MB limit would 413 a real photo; an unsupported *declared*
  // Content-Type never matches this parser, so Fastify returns `415` before the
  // body is read (the spec's "unsupported type" path).
  app.register(async (scope) => {
    scope.addContentTypeParser(
      ["image/jpeg", "image/png"],
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );

    // Uploads run one-at-a-time (N42): the instance holds the whole profile cache at
    // --max-instances=1, so a burst of concurrent sharp decodes is a whole-app OOM
    // risk. Uploads are rare; queueing them behind this mutex is invisible.
    const uploads = new Mutex();

    scope.put(
      "/api/profiles/:id/headshot",
      { preHandler: gate, bodyLimit: UPLOAD_BODY_LIMIT, config: writeRateLimit() },
      async (request, reply) => {
        const gateContext = authorize(request, reply, cache, audit, clock, "headshot.update");
        if (gateContext === null) {
          return reply;
        }
        const { actorId, id, stored, trace } = gateContext;

        const body = request.body;
        if (!Buffer.isBuffer(body)) {
          return reply
            .code(400)
            .send({ error: "bad_request", message: "Expected raw image bytes." });
        }

        // Validate + transcode under the upload semaphore (magic-byte + ~40 MP cap).
        let encoded: Awaited<ReturnType<typeof encodeHeadshot>>;
        try {
          encoded = await uploads.run(() => encodeHeadshot(body));
        } catch (error) {
          if (error instanceof UnprocessableImageError) {
            return reply.code(422).send({ error: "unprocessable_image", message: error.message });
          }
          throw error;
        }

        const version = mintVersion();
        const headshotKey = headshotObjectKey(id, version);
        const thumbnailKey = thumbnailObjectKey(id, version);

        // Objects FIRST (D98): the pointer must never name objects that don't exist.
        // The two writes are independent — D98 only requires both to exist before the
        // pointer advance, not an order between them — so run them together (OFC-132).
        try {
          await Promise.all([
            imageStore.put(headshotKey, encoded.headshot, WEBP),
            imageStore.put(thumbnailKey, encoded.thumbnail, WEBP),
          ]);
        } catch (error) {
          if (error instanceof ImageBucketUnconfiguredError) {
            return reply.code(503).send({ error: "image_bucket_unconfigured" });
          }
          throw error;
        }

        // Pointer LAST — the unconditional advance (N42) that mints the fresh ETag.
        // Only the pointer write + cache update take the per-record lock (OFC-220);
        // the slow encode and object puts above deliberately stay outside it, so a
        // decode spike never holds the lock (and thus never blocks a concurrent PATCH
        // on the same record for its whole duration). The lock is held only across
        // the quick token-advancing write, which is what must serialize.
        const now = clock();
        const set: Partial<Profile> = {
          hasHeadshot: true,
          headshotVersion: version,
          lastModified: now.toISOString(),
        };
        let token: string;
        try {
          token = await runRecordWrite(recordLock, id, {
            prepare: () => undefined,
            commit: async () => {
              const t = await store.updateUnconditional(id, { set, remove: [] });
              // Merge the pointer onto the CURRENT cached record, not the pre-encode
              // `stored` snapshot (OFC-125): a `PATCH` on the same record can commit
              // during the slow encode, so spreading `stored` would revert that text
              // in the read model. `headshotVersion` is `protected`, so a concurrent
              // PATCH never touches it; `stored`'s prior version is still the right one
              // to purge below.
              const current = cache.getById(id) ?? stored;
              await cache.applyUpdate({ ...current, ...set }, t);
              return t;
            },
          });
        } catch (error) {
          if (error instanceof MissingProfileError) {
            // The record vanished between the existence check and the write: undo the
            // objects we just wrote so no orphan is left referencing a gone record.
            await purge(imageStore, [headshotKey, thumbnailKey]);
            return reply.code(404).send({ error: "not_found", message: "No such brother." });
          }
          throw error;
        }

        // Purge the superseded prior version's objects (D94). Best-effort: a failed
        // cleanup leaves an orphan the bucket's versioning + 90-day lifecycle still
        // recovers, and must not fail an otherwise-successful upload.
        if (stored.hasHeadshot && stored.headshotVersion && stored.headshotVersion !== version) {
          await purge(imageStore, [
            headshotObjectKey(id, stored.headshotVersion),
            thumbnailObjectKey(id, stored.headshotVersion),
          ]);
        }

        audit.record(
          {
            action: "headshot.update",
            actorId,
            targetId: id,
            outcome: "ok",
            fields: ["headshot"],
            trace,
          },
          now.toISOString(),
        );
        return reply
          .header("Cache-Control", "no-store")
          .header("ETag", `"${token}"`)
          .send({ hasHeadshot: true, headshotVersion: version });
      },
    );

    scope.delete(
      "/api/profiles/:id/headshot",
      { preHandler: gate, config: writeRateLimit() },
      async (request, reply) => {
        const gateContext = authorize(request, reply, cache, audit, clock, "headshot.remove");
        if (gateContext === null) {
          return reply;
        }
        const { actorId, id, stored, trace } = gateContext;

        // No headshot to remove → a no-op: no write, no audit, current token returned
        // so the client's held ETag stays valid (mirrors the PATCH no-op short-circuit).
        if (!stored.hasHeadshot) {
          return reply
            .header("Cache-Control", "no-store")
            .header("ETag", `"${cache.concurrencyToken(id) ?? ""}"`)
            .send({ hasHeadshot: false });
        }

        const priorVersion = stored.headshotVersion;
        const now = clock();
        const set: Partial<Profile> = { hasHeadshot: false, lastModified: now.toISOString() };

        // Pointer FIRST for a removal: flip `hasHeadshot` off (and drop the version)
        // before deleting the objects, so the pointer never references gone objects.
        // Under the shared per-record lock (OFC-220), like the PUT pointer write.
        let token: string;
        try {
          token = await runRecordWrite(recordLock, id, {
            prepare: () => undefined,
            commit: async () => {
              const t = await store.updateUnconditional(id, { set, remove: ["headshotVersion"] });
              // Merge onto the CURRENT cached record (OFC-125, same interleave concern
              // as PUT), dropping `headshotVersion` (destructure-omit, not `delete`).
              const current = cache.getById(id) ?? stored;
              const { headshotVersion: _removed, ...withoutVersion } = current;
              await cache.applyUpdate({ ...withoutVersion, ...set }, t);
              return t;
            },
          });
        } catch (error) {
          if (error instanceof MissingProfileError) {
            return reply.code(404).send({ error: "not_found", message: "No such brother." });
          }
          throw error;
        }

        if (priorVersion) {
          await purge(imageStore, [
            headshotObjectKey(id, priorVersion),
            thumbnailObjectKey(id, priorVersion),
          ]);
        }

        audit.record(
          {
            action: "headshot.remove",
            actorId,
            targetId: id,
            outcome: "ok",
            fields: ["headshot"],
            trace,
          },
          now.toISOString(),
        );
        return reply
          .header("Cache-Control", "no-store")
          .header("ETag", `"${token}"`)
          .send({ hasHeadshot: false });
      },
    );
  });
}

/** The authorized context both endpoints share once the front-half guards pass. */
interface HeadshotContext {
  actorId: number;
  id: number;
  stored: Profile;
  trace: string | undefined;
}

/**
 * The shared front-half guard sequence (identical for PUT and DELETE): session →
 * valid id → object-level predicate (the IDOR guard, at the **effective** role) →
 * record exists. Returns the context on success, or `null` after having sent the
 * appropriate error response (the caller returns `reply` unchanged).
 *
 * The `canActOnProfile` **403 denial is audited** as `outcome: "denied"` (OFC-126),
 * mirroring the PATCH route (`profiles.ts`) so an actor probing contiguous
 * Constitution IDs to overwrite/delete other brothers' photos leaves a trail. The
 * pre-auth 401 and the 400/404 shape errors are not security denials and — as on
 * the PATCH path — are not audited.
 */
function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  cache: ProfileCache,
  audit: AuditLog,
  clock: Clock,
  action: HeadshotAction,
): HeadshotContext | null {
  const session = request.session;
  if (!session) {
    reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
    return null;
  }
  const actor = session.identity;
  const role = effectiveRole(session);
  const raw = (request.params as { id?: string }).id;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    reply.code(400).send({ error: "bad_request", message: "Invalid profile id." });
    return null;
  }
  const trace = traceId(request);

  if (!canActOnProfile(role, actor.profileId, id)) {
    audit.record(
      { action, actorId: actor.profileId, targetId: id, outcome: "denied", trace },
      clock().toISOString(),
    );
    reply.code(403).send({ error: "forbidden", message: "You may not edit this record." });
    return null;
  }
  const stored = cache.getById(id);
  if (!stored) {
    reply.code(404).send({ error: "not_found", message: "No such brother." });
    return null;
  }
  return { actorId: actor.profileId, id, stored, trace };
}

/** Best-effort delete of a set of object keys — swallows failures (D94 recovery covers them). */
async function purge(imageStore: ImageStore, keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await imageStore.delete(key);
      } catch {
        // A failed purge leaves a recoverable orphan (versioning + lifecycle, D94);
        // never let it fail the request.
      }
    }),
  );
}

/** A minimal async mutex (concurrency 1): serialize uploads to bound peak memory. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    // Keep the chain alive even if a task rejects, so one failed upload does not
    // wedge the queue.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
