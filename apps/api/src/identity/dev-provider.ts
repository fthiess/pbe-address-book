import type { Role } from "@pbe/shared";
import { assertDevProviderAllowed } from "./dev-guard.js";
import type { Identity, IdentityProvider, Session, SessionRequest } from "./types.js";

/**
 * A unique sentinel string. It exists for one reason: the D108 layer-3 CI
 * assertion greps the built *production* bundle for this exact literal and
 * fails the build if it is present. Because the production entry point never
 * imports this module, the sentinel must never appear in `dist/server.js`.
 * Do not reference this constant from any code reachable by `index.ts`.
 */
export const DEV_IDENTITY_PROVIDER_SENTINEL = "__BOOK_DEV_IDENTITY_PROVIDER_PRESENT__";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

const DISPLAY_NAME: Record<Role, string> = {
  brother: "Dev Brother",
  manager: "Dev Manager",
  admin: "Dev Admin",
};

/**
 * The test/dev implementation of the `IdentityProvider` seam (D72): mints a
 * Ghost-free session for any chosen role, for local development, the Playwright
 * suite, and ephemeral staging UAT. Locked out of production by the four
 * independent D108 layers — see `dev-guard.ts`.
 */
export class DevIdentityProvider implements IdentityProvider {
  readonly name = "dev";

  constructor(env: NodeJS.ProcessEnv = process.env) {
    // D108 layers 2 + 4: refuse, loudly, under a production-like configuration.
    assertDevProviderAllowed(env);
  }

  async createSession(request: SessionRequest): Promise<Session> {
    const role: Role = request.role ?? "brother";
    const identity: Identity = {
      subject: `dev-${role}`,
      email: `dev-${role}@example.test`,
      role,
      displayName: DISPLAY_NAME[role],
    };
    return { identity, expiresAt: Date.now() + FOUR_HOURS_MS };
  }
}
