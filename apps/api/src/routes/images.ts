import type { FastifyInstance } from "fastify";
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
 * PHASE 1a SCOPE. The bucket name comes from the `IMAGE_BUCKET` env var. The
 * read is un-gated in this interim (like `GET /api/profiles`), which is safe
 * because every environment it runs in holds fake data only (D72). The session
 * gate and per-record visibility (an unlisted/de-brothered brother's image
 * returning 404 to a peer), and the full upload/derivation pipeline, arrive with
 * auth in Phase 1b and the Profile work in Phase 4.
 */
export function registerImageRoutes(app: FastifyInstance): void {
  const bucketName = process.env.IMAGE_BUCKET;

  app.get("/img/*", async (request, reply) => {
    if (!bucketName) {
      return reply.code(503).send({ error: "image_bucket_unconfigured" });
    }
    const objectPath = (request.params as Record<string, string>)["*"];
    if (!objectPath) {
      return reply.code(404).send({ error: "not_found" });
    }

    const file = getStorage().bucket(bucketName).file(objectPath);
    const [exists] = await file.exists();
    if (!exists) {
      return reply.code(404).send({ error: "not_found" });
    }

    const [metadata] = await file.getMetadata();
    reply
      .header("Content-Type", metadata.contentType ?? "application/octet-stream")
      // Versioned, immutable object URLs (D126): cache hard in the browser, but
      // `private` (a member photo is PII) so it never lands in a shared cache.
      .header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.send(file.createReadStream());
  });
}
