/**
 * The `IdentityProvider` seam (DECISIONS D20/D21). Book's two auth paths sit
 * behind this one interface: the real Ghost auth bridge in production
 * (verifying the Ghost-issued JWT against Ghost's JWKS — Phase 1) and the
 * `DevIdentityProvider` for Ghost-free, role-switchable local/staging login
 * (D72). Keeping both behind a single seam is what lets UAT and local dev run
 * without Ghost while production uses the real handshake.
 */

import type { Role } from "@pbe/shared";

/** Who the caller is, once authenticated. */
export interface Identity {
  /** Stable subject id (the Ghost member id in production; synthetic in dev). */
  subject: string;
  email: string;
  role: Role;
  displayName: string;
}

/** A Book session. */
export interface Session {
  identity: Identity;
  /**
   * Absolute expiry, epoch milliseconds. In production this is the 4-hour
   * absolute cap, persisted in Firestore so a scale-to-zero cold start does
   * not invalidate it (D22/D125).
   */
  expiresAt: number;
}

/** Inputs to {@link IdentityProvider.createSession}. */
export interface SessionRequest {
  /** Dev only: the role to assume (defaults to "brother"). Ignored in production. */
  role?: Role;
  /** Production: the raw credential to verify (the Ghost JWT). Wired in Phase 1. */
  token?: string;
}

export interface IdentityProvider {
  /** Human-readable provider name, surfaced in diagnostics. */
  readonly name: string;
  /**
   * Establish a session. Production verifies request credentials (Phase 1);
   * development mints a session for the requested role.
   */
  createSession(request: SessionRequest): Promise<Session>;
}
