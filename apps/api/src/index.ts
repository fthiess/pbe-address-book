/**
 * PRODUCTION entry point.
 *
 * This file wires ONLY the real Ghost identity provider. It must never import
 * the dev provider, its routes, or its guard — that exclusion is D108's
 * load-bearing first layer: the production bundle (built by esbuild starting
 * here) does not contain the dev provider's code, so it cannot be instantiated
 * even under a misconfiguration. The CI assertion (D108 layer 3) verifies this.
 */
import { GhostIdentityProvider } from "./identity/ghost-provider.js";
import { buildServer } from "./server.js";

const app = buildServer({ identityProvider: new GhostIdentityProvider() });
const port = Number(process.env.PORT ?? 8080);

app
  .listen({ port, host: "0.0.0.0" })
  .then((address) => {
    console.log(`Book API (production) listening at ${address}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
