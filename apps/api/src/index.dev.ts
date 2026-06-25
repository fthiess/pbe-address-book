/**
 * DEVELOPMENT entry point — local dev, the Playwright suite, and ephemeral
 * staging UAT (D72). This is the ONLY place the dev provider and its routes are
 * imported, so they are reachable only through this entry and never reach the
 * production bundle (D108 layer 1). Run with `npm run dev --workspace apps/api`.
 */
import { DevIdentityProvider } from "./identity/dev-provider.js";
import { registerDevRoutes } from "./identity/dev-routes.js";
import { buildServer } from "./server.js";

// Constructing this asserts we are not in a production-like config (D108 layers 2 + 4).
const provider = new DevIdentityProvider();
const app = buildServer({ identityProvider: provider });
registerDevRoutes(app, provider);

const port = Number(process.env.PORT ?? 8080);

app
  .listen({ port, host: "127.0.0.1" })
  .then((address) => {
    console.log(`Book API (DEV — DevIdentityProvider active) listening at ${address}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
