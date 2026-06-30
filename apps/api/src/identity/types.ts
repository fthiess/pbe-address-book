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
  /**
   * The caller's Book Constitution ID — the key for their `profiles` and
   * `users` documents. Resolved from the verified email in production
   * (ENGINEERING-DESIGN §2.1) and assigned a fixed fake id per role in dev.
   * `/api/me` and the directory's own-row overlay (D82) key off this.
   */
  profileId: number;
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
  /**
   * The **effective role** for "View as" impersonation (DECISIONS N31): a
   * step-**down** testing overlay an admin/manager sets to exercise a lower
   * projection. Absent ⇒ not impersonating, and the immutable real role
   * ({@link Identity.role}) governs. Stored on the *session*, never on identity:
   * who the caller is does not change, only which role the role-authorization
   * checks read. Persisted alongside the session so it survives a cold start, and
   * always a strict step-down ({@link "@pbe/shared".canImpersonate}) — it can only
   * ever restrict the view, never grant power the real role lacks.
   */
  effectiveRole?: Role;
}

/**
 * The role the role-authorization checks must read — the effective (impersonated)
 * role when one is set, otherwise the immutable real role. The single accessor
 * every projection/capability site goes through, so the N31 split (identity stays,
 * role steps down) lives in exactly one place.
 */
export function effectiveRole(session: Session): Role {
  return session.effectiveRole ?? session.identity.role;
}

/** Inputs to {@link IdentityProvider.createSession}. */
export interface SessionRequest {
  /** Dev only: the role to assume (defaults to "brother"). Ignored in production. */
  role?: Role;
  /** Production: the raw credential to verify (the Ghost JWT). */
  token?: string;
  /** Production: the single-use `state` nonce that binds the callback to a Book-initiated flow (D104). */
  state?: string;
}

export interface IdentityProvider {
  /** Human-readable provider name, surfaced in diagnostics. */
  readonly name: string;
  /**
   * Establish a session. Production verifies request credentials (the Ghost
   * JWT, the single-use nonce, and the email→profile resolution); development
   * mints a session for the requested role.
   *
   * On a credential/resolution failure it throws an {@link AuthError} carrying
   * the HTTP status and the API-SPEC §2 error code (`unlinked_member`,
   * `ambiguous_member`, `debrothered`, …) the route surfaces to the SPA.
   */
  createSession(request: SessionRequest): Promise<Session>;
}

/**
 * A failure in the auth handshake, carrying the HTTP status and the
 * machine-readable error code from API-SPEC §2 (`401`/`403` with
 * `unlinked_member` / `ambiguous_member` / `debrothered` / `invalid_state` /
 * `invalid_token`). The route handler maps it straight onto the JSON error body.
 */
export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AuthError";
  }
}
