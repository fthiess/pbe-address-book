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
 */
import { ProfileCache } from "./data/cache.js";
import { getDb } from "./data/firestore.js";
import { GhostIdentityProvider } from "./identity/ghost-provider.js";
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);

async function main(): Promise<void> {
  const profileCache = new ProfileCache();
  await profileCache.hydrateFromFirestore(getDb());

  const app = buildServer({
    identityProvider: new GhostIdentityProvider(),
    profileCache,
  });

  const address = await app.listen({ port, host: "0.0.0.0" });
  console.log(
    `Book API (production) listening at ${address} — ${profileCache.size} profiles cached`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
