/**
 * DEVELOPMENT entry point — local dev, the Playwright suite, and ephemeral
 * staging UAT (D72). This is the ONLY place the dev provider and its routes are
 * imported, so they are reachable only through this entry and never reach the
 * production bundle (D108 layer 1). Run with `npm run dev --workspace apps/api`.
 *
 * The cache, sessions, and nonces hydrate from whatever Firestore the
 * environment points at: the local emulator (set `FIRESTORE_EMULATOR_HOST`, seed
 * it first with the repo-root `npm run seed`), or staging's Firestore for UAT.
 * The default port is off the emulator's 8080 (firebase.json) so both can run
 * side by side. The session cookie is issued without `Secure` so it is sent over
 * the local plain-http dev server (never the case in any deployed environment).
 */
import { FirestoreBackupSource } from "./data/backup.js";
import { FirestoreBannerStore } from "./data/banner.js";
import { FirestoreBugReportStore } from "./data/bug-reports.js";
import { ProfileCache } from "./data/cache.js";
import { getDb } from "./data/firestore.js";
import { FirestoreProfileStore } from "./data/profiles.js";
import { FirestoreAdminUserStore, addStar, getUser, removeStar } from "./data/users.js";
import { DevIdentityProvider } from "./identity/dev-provider.js";
import { registerDevRoutes } from "./identity/dev-routes.js";
import { NonceStore } from "./identity/nonce-store.js";
import type { SessionCookieConfig } from "./identity/session-cookie.js";
import { SessionStore } from "./identity/session-store.js";
import { buildServer } from "./server.js";

// Constructing this asserts we are not in a production-like config (D108 layers 2 + 4).
const provider = new DevIdentityProvider();
const port = Number(process.env.PORT ?? 8787);
// Local dev runs over plain http, where a Secure cookie would not be sent.
const cookie: SessionCookieConfig = { secure: false };

async function main(): Promise<void> {
  const db = getDb();
  const profileCache = new ProfileCache();
  await profileCache.hydrateFromFirestore(db);

  const sessionStore = new SessionStore(db);
  const nonceStore = new NonceStore(db);

  // Shared between the production-shaped bulk read and the dev session route so
  // dev sign-in reports real starred state, not a hardcoded `[]` (OFC-78).
  const getStars = async (profileId: number) => (await getUser(db, profileId))?.stars ?? [];

  const app = await buildServer({
    identityProvider: provider,
    profileCache,
    profileStore: new FirestoreProfileStore(db),
    adminUsers: new FirestoreAdminUserStore(db),
    bannerStore: new FirestoreBannerStore(db),
    backupSource: new FirestoreBackupSource(db),
    bugReportStore: new FirestoreBugReportStore(db),
    sessionStore,
    nonceStore,
    getStars,
    addStar: (profileId, starId) => addStar(db, profileId, starId),
    removeStar: (profileId, starId) => removeStar(db, profileId, starId),
    cookie,
  });
  registerDevRoutes(app, provider, { sessionStore, cookie, getStars });

  const address = await app.listen({ port, host: "127.0.0.1" });
  console.log(
    `Book API (DEV — DevIdentityProvider active) listening at ${address} — ${profileCache.size} profiles cached`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
