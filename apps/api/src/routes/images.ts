import { parseImageObjectKey } from "@pbe/shared";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { ProfileCache } from "../data/cache.js";
import { ImageBucketUnconfiguredError, type ImageStore } from "../data/images.js";
import { effectiveRole } from "../identity/types.js";
import { hiddenFromBrothers } from "../projection/projection.js";

/**
 * `GET /img/*` — member headshots and thumbnails, served by the app from the
 * PRIVATE image bucket (decision D126: no Cloud CDN and no external load
 * balancer; the app is the access path). The path after `/img/` maps to the
 * object key — `/img/headshots/5247/3.webp` → object `headshots/5247/3.webp` —
 * and the object is streamed back with long-lived immutable browser caching (the
 * URLs are versioned, so a new upload yields a new URL, never a mutated one).
 *
 * TWO gates run before the bucket is ever touched:
 *
 *  1. **Session** (`gate`, Phase 1b): an image read requires a valid Book session,
 *     the same cookie that authenticates `/api/*`.
 *  2. **Shape + per-record visibility** (4c-1, DECISIONS N43): the path must parse
 *     to one of the two literal key shapes `headshots/{id}/{version}.webp` /
 *     `thumbnails/{id}/{version}.webp` (anything else → 404, which also forecloses
 *     reading any *other* bucket object through the rewrite), and the caller's
 *     **effective** role (View-as included, N31) must be able to see that record —
 *     an unlisted or de-brothered brother's image returns 404 to a brother-role
 *     caller, mirroring the record projection (D124/D115).
 */
export function registerImageRoutes(
  app: FastifyInstance,
  deps: { cache: ProfileCache; gate: preHandlerHookHandler; imageStore: ImageStore },
): void {
  const { cache, gate, imageStore } = deps;

  app.get("/img/*", { preHandler: gate }, async (request, reply) => {
    const objectPath = (request.params as Record<string, string>)["*"];
    if (typeof objectPath !== "string") {
      return reply.code(404).send({ error: "not_found" });
    }
    const parsed = parseImageObjectKey(objectPath);
    if (!parsed) {
      // Not a well-formed member image key → 404 (never reveal or read anything else).
      return reply.code(404).send({ error: "not_found" });
    }

    // Per-record visibility at the EFFECTIVE role (N43). Identity (own-record) stays
    // real; the effective role drives the brother-hidden 404 so a "View as brother"
    // admin is withheld exactly what a brother would be.
    const session = request.session;
    if (!session) {
      // The gate guarantees a session; this is a defensive 401, not a live path.
      return reply.code(401).send({ error: "unauthenticated" });
    }
    const stored = cache.getById(parsed.id);
    if (!stored) {
      return reply.code(404).send({ error: "not_found" });
    }
    const isOwner = session.identity.profileId === parsed.id;
    if (!isOwner && effectiveRole(session) === "brother" && hiddenFromBrothers(stored)) {
      return reply.code(404).send({ error: "not_found" });
    }

    let object: Awaited<ReturnType<ImageStore["read"]>>;
    try {
      object = await imageStore.read(objectPath);
    } catch (error) {
      if (error instanceof ImageBucketUnconfiguredError) {
        return reply.code(503).send({ error: "image_bucket_unconfigured" });
      }
      throw error;
    }
    if (object === null) {
      return reply.code(404).send({ error: "not_found" });
    }

    return (
      reply
        .header("Content-Type", object.contentType)
        // Versioned, immutable object URLs (D126): cache hard in the browser, but
        // `private` (a member photo is PII) so it never lands in a shared cache.
        .header("Cache-Control", "private, max-age=31536000, immutable")
        .send(object.body)
    );
  });
}
