/**
 * DEVELOPMENT entry point — local dev, the Playwright suite, and ephemeral
 * staging UAT (D72). This is the ONLY place the dev provider and its routes are
 * imported, so they are reachable only through this entry and never reach the
 * production bundle (D108 layer 1). Run with `npm run dev --workspace apps/api`.
 *
 * The cache hydrates from whatever Firestore the environment points at: the
 * local emulator (set `FIRESTORE_EMULATOR_HOST`, seed it first with the
 * repo-root `npm run seed`), or staging's Firestore for UAT. The default port
 * is off the emulator's 8080 (firebase.json) so both can run side by side.
 */
import { ProfileCache } from "./data/cache.js";
import { getDb } from "./data/firestore.js";
import { DevIdentityProvider } from "./identity/dev-provider.js";
import { registerDevRoutes } from "./identity/dev-routes.js";
import { buildServer } from "./server.js";

// Constructing this asserts we are not in a production-like config (D108 layers 2 + 4).
const provider = new DevIdentityProvider();
const port = Number(process.env.PORT ?? 8787);

async function main(): Promise<void> {
  const profileCache = new ProfileCache();
  await profileCache.hydrateFromFirestore(getDb());

  const app = buildServer({ identityProvider: provider, profileCache });
  registerDevRoutes(app, provider);

  const address = await app.listen({ port, host: "127.0.0.1" });
  console.log(
    `Book API (DEV — DevIdentityProvider active) listening at ${address} — ${profileCache.size} profiles cached`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
