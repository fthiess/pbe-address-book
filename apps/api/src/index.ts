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
import { diagnosticLog } from "./audit/diagnostic-log.js";
import { FirestoreBackupSource } from "./data/backup.js";
import { FirestoreBannerStore } from "./data/banner.js";
import { FirestoreBugReportStore } from "./data/bug-reports.js";
import { ProfileCache } from "./data/cache.js";
import { getDb } from "./data/firestore.js";
import { FirestoreProfileStore } from "./data/profiles.js";
import { FirestoreAdminUserStore, addStar, ensureUser, getUser, removeStar } from "./data/users.js";
import { GhostAdminLifecycle } from "./identity/ghost-admin.js";
import { createGhostKeyResolver } from "./identity/ghost-jwks.js";
import type { GhostLifecycle } from "./identity/ghost-lifecycle.js";
import { GhostIdentityProvider } from "./identity/ghost-provider.js";
import {
  GhostAdminReader,
  type GhostMemberLookup,
  type GhostReader,
} from "./identity/ghost-reader.js";
import {
  GoogleOidcVerifier,
  type RosterVerifier,
  createGoogleKeyResolver,
} from "./identity/google-oidc.js";
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

/**
 * The Ghost **Admin** API (the Book→Ghost write path, N65/N67). The key is
 * `{id}:{secret}` and lives in Secret Manager — never the tree. When it is absent
 * the lifecycle falls back to the succeed-and-log stub, so an unconfigured
 * deployment still runs (writes just never reach Ghost). `GHOST_NEWSLETTER_ID`
 * attaches a subscribed member to the newsletter (Ghost v5 models subscription as
 * a relation; must-verify, N67).
 */
const GHOST_ADMIN_API_URL = process.env.GHOST_ADMIN_API_URL;
const GHOST_ADMIN_API_KEY = process.env.GHOST_ADMIN_API_KEY;
const GHOST_NEWSLETTER_ID = process.env.GHOST_NEWSLETTER_ID;

/**
 * The Linter roster's subject-pinned Google-OIDC identity (D58/D78). Both must be
 * set for `GET /api/roster` to accept a token; otherwise the route fails closed.
 */
const ROSTER_AUDIENCE = process.env.ROSTER_AUDIENCE;
const ROSTER_LINTER_SUBJECT = process.env.ROSTER_LINTER_SUBJECT;

/**
 * Build the real Ghost Admin client when configured, else undefined (→ stub). When
 * the Admin key IS set, `GHOST_NEWSLETTER_ID` must be too — the `GhostAdminLifecycle`
 * constructor throws without it, so a half-configured deploy fails fast at startup
 * rather than silently pushing newsletter *unsubscribes* (OFC-219).
 */
function resolveGhostLifecycle(): GhostLifecycle | undefined {
  if (!GHOST_ADMIN_API_URL || !GHOST_ADMIN_API_KEY) {
    return undefined;
  }
  if (!GHOST_NEWSLETTER_ID) {
    throw new Error(
      "GHOST_ADMIN_API_URL/KEY are set but GHOST_NEWSLETTER_ID is not — refusing to start (OFC-219).",
    );
  }
  return new GhostAdminLifecycle({
    apiUrl: GHOST_ADMIN_API_URL,
    adminApiKey: GHOST_ADMIN_API_KEY,
    newsletterId: GHOST_NEWSLETTER_ID,
  });
}

/**
 * Build the read-only Ghost client (the admin alignment audit + bounce report,
 * 5b-2) when the Admin API is configured, else undefined (→ the routes `503`).
 * Reads need no `GHOST_NEWSLETTER_ID`, so this gates only on URL + key.
 *
 * Returned as **both** read seams it satisfies: the report surfaces take
 * {@link GhostReader}, and sign-in takes the one-method {@link GhostMemberLookup}
 * for the analytics uuid (D137, OFC-287). One instance, so there is a single
 * Admin-API config and a single transport — the two consumers are separate
 * *interfaces*, not separate clients. When the Admin API is unconfigured, both
 * degrade as documented: the reports `503`, sign-in mints uuid-less sessions.
 */
function resolveGhostReader(): (GhostReader & GhostMemberLookup) | undefined {
  if (!GHOST_ADMIN_API_URL || !GHOST_ADMIN_API_KEY) {
    return undefined;
  }
  return new GhostAdminReader({ apiUrl: GHOST_ADMIN_API_URL, adminApiKey: GHOST_ADMIN_API_KEY });
}

/** Build the roster verifier when the Linter identity is configured, else undefined. */
function resolveRosterVerifier(): RosterVerifier | undefined {
  if (!ROSTER_AUDIENCE || !ROSTER_LINTER_SUBJECT) {
    return undefined;
  }
  return new GoogleOidcVerifier({
    keyResolver: createGoogleKeyResolver(),
    audience: ROSTER_AUDIENCE,
    subject: ROSTER_LINTER_SUBJECT,
  });
}

async function main(): Promise<void> {
  const db = getDb();
  const profileCache = new ProfileCache();
  await profileCache.hydrateFromFirestore(db);

  const sessionStore = new SessionStore(db);
  const nonceStore = new NonceStore(db);
  // One client, two seams (see `resolveGhostReader`): the report routes and sign-in.
  const ghostReader = resolveGhostReader();

  const provider = new GhostIdentityProvider({
    keyResolver: createGhostKeyResolver(GHOST_JWKS_URL),
    issuer: GHOST_JWT_ISSUER,
    audience: GHOST_JWT_AUDIENCE,
    nonceStore,
    cache: profileCache,
    ensureUser: (profileId) => ensureUser(db, profileId),
    memberLookup: ghostReader,
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
    ghostLifecycle: resolveGhostLifecycle(),
    ghostReader,
    rosterVerifier: resolveRosterVerifier(),
  });

  const address = await app.listen({ port, host: "0.0.0.0" });
  // Startup banner on the diagnostic stream at INFO (progress → stdout). Config
  // only — issuer/audience/bridge URLs and a count, no member PII.
  diagnosticLog.info(
    `Book API (production) listening at ${address} — ${profileCache.size} profiles cached; ` +
      `Ghost iss=${GHOST_JWT_ISSUER} aud=${GHOST_JWT_AUDIENCE} bridge=${GHOST_BRIDGE_URL} target=${GHOST_BRIDGE_TARGET}; ` +
      `ghost-admin=${GHOST_ADMIN_API_URL ? "configured" : "stub"} roster=${ROSTER_AUDIENCE ? "configured" : "unconfigured"}`,
  );
}

main().catch((error) => {
  // Last-ditch fatal handler: a structured ERROR with the scrubbed detail/stack.
  diagnosticLog.error("fatal startup error", {
    detail: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
