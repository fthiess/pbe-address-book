/**
 * PRODUCTION entry point.
 *
 * This file wires ONLY the real Ghost identity provider. It must never import
 * the dev provider, its routes, or its guard — that exclusion is D108's
 * load-bearing first layer: the production bundle (built by esbuild starting
 * here) does not contain the dev provider's code, so it cannot be instantiated
 * even under a misconfiguration. The CI assertion (D108 layer 3) verifies this.
 *
 * On cold start the in-memory cache hydrates from Firestore before the server
 * accepts traffic, so the first request is served from a warm cache (D7/D83).
 * Sessions and login nonces persist in Firestore, so the same cold start does
 * not invalidate live sessions (D125).
 */
import { FirestoreBackupSource } from "./data/backup.js";
import { FirestoreBannerStore } from "./data/banner.js";
import { FirestoreBugReportStore } from "./data/bug-reports.js";
import { ProfileCache } from "./data/cache.js";
import { getDb } from "./data/firestore.js";
import { FirestoreProfileStore } from "./data/profiles.js";
import { FirestoreAdminUserStore, addStar, ensureUser, getUser, removeStar } from "./data/users.js";
import { createGhostKeyResolver } from "./identity/ghost-jwks.js";
import { GhostIdentityProvider } from "./identity/ghost-provider.js";
import { NonceStore } from "./identity/nonce-store.js";
import { SessionStore } from "./identity/session-store.js";
import { buildServer } from "./server.js";
import { resolveApiVersion } from "./version.js";

const port = Number(process.env.PORT ?? 8080);

/** The Ghost members JWKS endpoint (key set the bridge verifies tokens against). */
const GHOST_JWKS_URL =
  process.env.GHOST_JWKS_URL ?? "https://pbe400.org/members/.well-known/jwks.json";
/**
 * Expected `iss`/`aud` of the Ghost members JWT. Defaults are Ghost Pro's
 * members-API conventions for pbe400.org; both are env-overridable and the
 * actual values are confirmed against a live token during the staging bring-up.
 */
const GHOST_JWT_ISSUER = process.env.GHOST_JWT_ISSUER ?? "https://pbe400.org/members/api";
const GHOST_JWT_AUDIENCE = process.env.GHOST_JWT_AUDIENCE ?? "https://pbe400.org/members/api";
/** The relay page on the live Ghost site, and which callback the relay routes to. */
const GHOST_BRIDGE_URL = process.env.GHOST_BRIDGE_URL ?? "https://pbe400.org/book";
const GHOST_BRIDGE_TARGET = process.env.GHOST_BRIDGE_TARGET ?? "prod";

async function main(): Promise<void> {
  const db = getDb();
  const profileCache = new ProfileCache();
  await profileCache.hydrateFromFirestore(db);

  const sessionStore = new SessionStore(db);
  const nonceStore = new NonceStore(db);

  const provider = new GhostIdentityProvider({
    keyResolver: createGhostKeyResolver(GHOST_JWKS_URL),
    issuer: GHOST_JWT_ISSUER,
    audience: GHOST_JWT_AUDIENCE,
    nonceStore,
    cache: profileCache,
    ensureUser: (profileId) => ensureUser(db, profileId),
    // Optional override (comma-separated); defaults to the asymmetric RS family.
    algorithms: process.env.GHOST_JWT_ALGS?.split(",").map((a) => a.trim()),
  });

  const app = await buildServer({
    identityProvider: provider,
    profileCache,
    profileStore: new FirestoreProfileStore(db),
    adminUsers: new FirestoreAdminUserStore(db),
    bannerStore: new FirestoreBannerStore(db),
    backupSource: new FirestoreBackupSource(db),
    bugReportStore: new FirestoreBugReportStore(db),
    apiVersion: resolveApiVersion(),
    sessionStore,
    nonceStore,
    getStars: async (profileId) => (await getUser(db, profileId))?.stars ?? [],
    addStar: (profileId, starId) => addStar(db, profileId, starId),
    removeStar: (profileId, starId) => removeStar(db, profileId, starId),
    cookie: { secure: true },
    ghostBridge: { url: GHOST_BRIDGE_URL, target: GHOST_BRIDGE_TARGET },
  });

  const address = await app.listen({ port, host: "0.0.0.0" });
  console.log(
    `Book API (production) listening at ${address} — ${profileCache.size} profiles cached; ` +
      `Ghost iss=${GHOST_JWT_ISSUER} aud=${GHOST_JWT_AUDIENCE} bridge=${GHOST_BRIDGE_URL} target=${GHOST_BRIDGE_TARGET}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
