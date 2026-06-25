import type { IdentityProvider, Session, SessionRequest } from "./types.js";

/**
 * The production identity provider: the real Ghost auth bridge. It verifies a
 * Ghost-issued JWT against Ghost's JWKS and mints a Firestore-persisted Book
 * session (D125). This is the only provider compiled into the production
 * bundle (the dev provider is excluded entirely — D108).
 *
 * Phase 0 ships the class as the production wiring target; the JWKS
 * verification and session minting are implemented in Phase 1 (the walking
 * skeleton's auth bridge).
 */
export class GhostIdentityProvider implements IdentityProvider {
  readonly name = "ghost";

  async createSession(_request: SessionRequest): Promise<Session> {
    throw new Error(
      "GhostIdentityProvider.createSession is implemented in Phase 1 (the Ghost auth bridge).",
    );
  }
}
