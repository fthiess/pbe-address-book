import { isImageObjectKey } from "@pbe/shared";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { getStorage } from "firebase-admin/storage";

/**
 * `GET /img/*` — member headshots and thumbnails, served by the app from the
 * PRIVATE image bucket (decision D126: no Cloud CDN and no external load
 * balancer; the app is the access path). The path after `/img/` maps directly
 * to the object key — `/img/headshots/5247/3.webp` → object
 * `headshots/5247/3.webp` — and the object is streamed back with long-lived
 * immutable browser caching (the URLs are versioned, so a new upload yields a
 * new URL rather than mutating an old one).
 *
 * The bucket name comes from the `IMAGE_BUCKET` env var. PHASE 1b adds the
 * session `gate`, so an image read now requires a valid Book session — the same
 * cookie that authenticates `/api/*` (D126). Per-record visibility (an
 * unlisted/de-brothered brother's image returning 404 to a peer) and the full
 * upload/derivation pipeline arrive with the Profile work in Phase 4.
 *
 * The wildcard path is validated against the shared object-key allowlist
 * ({@link isImageObjectKey}) BEFORE the bucket is touched (OFC-71): the session
 * gate proves *a* member is signed in, but says nothing about *which* object they
 * may read, so without the shape check any session holder could stream any object
 * that happens to live in the bucket (e.g. an export CSV), not just a
 * `thumbnails/`/`headshots/` image. Sharing the predicate with the URL builder
 * and upload pipeline keeps the one path shape in a single place (no fourth copy).
 */
export function registerImageRoutes(app: FastifyInstance, gate: preHandlerHookHandler): void {
  const bucketName = process.env.IMAGE_BUCKET;

  app.get("/img/*", { preHandler: gate }, async (request, reply) => {
    if (!bucketName) {
      return reply.code(503).send({ error: "image_bucket_unconfigured" });
    }
    const objectPath = (request.params as Record<string, string>)["*"];
    if (!objectPath || !isImageObjectKey(objectPath)) {
      return reply.code(404).send({ error: "not_found" });
    }

    const file = getStorage().bucket(bucketName).file(objectPath);
    // One round trip (OFC-80): `getMetadata()` already 404s on a missing object,
    // so a prior `exists()` was both redundant and a TOCTOU window — a delete
    // between the two calls turned an honest 404 into a 500. Treat a `404` from
    // GCS as not-found and let any other error surface as a 500.
    try {
      const [metadata] = await file.getMetadata();
      reply
        .header("Content-Type", metadata.contentType ?? "application/octet-stream")
        // Versioned, immutable object URLs (D126): cache hard in the browser, but
        // `private` (a member photo is PII) so it never lands in a shared cache.
        .header("Cache-Control", "private, max-age=31536000, immutable");
      return reply.send(file.createReadStream());
    } catch (error) {
      if ((error as { code?: number }).code === 404) {
        return reply.code(404).send({ error: "not_found" });
      }
      throw error;
    }
  });
}
