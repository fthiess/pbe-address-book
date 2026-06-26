import { type Role, normalizeEmail } from "@pbe/shared";
import { type JWTVerifyGetKey, jwtVerify } from "jose";
import type { ProfileCache } from "../data/cache.js";
import type { NonceService } from "./nonce-store.js";
import {
  AuthError,
  type Identity,
  type IdentityProvider,
  type Session,
  type SessionRequest,
} from "./types.js";

/** The 4-hour absolute session cap (DECISIONS D22; ENGINEERING-DESIGN §2.3). */
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * The allowed JWT signing algorithms. Ghost's members API signs with an
 * **asymmetric RS-family** key (currently RS512, verified via the JWKS), so this
 * allowlist names only RSA-SHA2 variants. The security-critical property (D104)
 * is what it *excludes*: `alg:none` and every **symmetric** algorithm — the two
 * classic forges (an unsigned token; an `HS256` token HMAC'd with the RSA public
 * key). Pinning to asymmetric-only forecloses both. Overridable per-deployment.
 */
const DEFAULT_ALGS = ["RS256", "RS512"];

export interface GhostProviderDeps {
  /** Resolver for Ghost's JWKS (see `ghost-jwks.ts`). */
  jwks: JWTVerifyGetKey;
  /** Expected `iss` of the Ghost members JWT. */
  issuer: string;
  /** Expected `aud` of the Ghost members JWT. */
  audience: string;
  /** The single-use callback nonce store (D104/D125). */
  nonceStore: NonceService;
  /** The in-memory dataset, for email→profile resolution. */
  cache: ProfileCache;
  /** Create-if-absent the caller's `users` doc and return their role (R20). */
  ensureUser: (profileId: number) => Promise<{ role: Role }>;
  /** Session lifetime; defaults to the 4-hour cap. */
  sessionTtlMs?: number;
  /** Allowed signing algorithms; defaults to the asymmetric RS family (D104). */
  algorithms?: string[];
}

/**
 * The production identity provider: the real Ghost auth bridge (ENGINEERING-DESIGN
 * §2.1; DECISIONS D20/D21/D104/D97/D115). It is the only provider compiled into
 * the production bundle — the dev provider is excluded entirely (D108).
 *
 * `createSession` is the security-critical heart of the handshake:
 *  1. Verify the Ghost-issued JWT against Ghost's JWKS — signature, `iss`,
 *     `aud`, `exp` — with the **algorithm pinned to the asymmetric RS family**
 *     (Ghost uses RS512), which rejects `alg:none` and every symmetric algorithm
 *     (the two classic forges, D104).
 *  2. Verify and **consume the single-use `state` nonce** (D104) — replay-proof.
 *  3. Extract the member email from `sub`, **normalize it** (D97), and resolve it
 *     against the in-memory email index. Resolution **fails closed**: no match →
 *     `unlinked_member`; multiple matches → `ambiguous_member` (never a guess).
 *  4. Create-if-absent the brother's `users` document and read their role (R20).
 *
 * Every failure throws an {@link AuthError} carrying the API-SPEC §2 status/code.
 */
export class GhostIdentityProvider implements IdentityProvider {
  readonly name = "ghost";

  constructor(private readonly deps: GhostProviderDeps) {}

  async createSession(request: SessionRequest): Promise<Session> {
    const { token, state } = request;
    if (!token) {
      throw new AuthError(401, "invalid_token", "no token supplied");
    }
    if (!state) {
      throw new AuthError(401, "invalid_state", "no state nonce supplied");
    }

    // 1. Cryptographically verify the Ghost JWT (alg/iss/aud/exp pinned).
    const email = await this.verifyAndExtractEmail(token);

    // 2. Bind the callback to a Book-initiated flow; consume the nonce once.
    const nonceOk = await this.deps.nonceStore.consume(state);
    if (!nonceOk) {
      throw new AuthError(401, "invalid_state", "missing or replayed state nonce");
    }

    // 3. Resolve the verified email to a single profile, failing closed.
    const resolution = this.deps.cache.resolveByEmail(email);
    if (resolution.kind === "none") {
      throw new AuthError(403, "unlinked_member", "no profile matches this email");
    }
    if (resolution.kind === "ambiguous") {
      throw new AuthError(403, "ambiguous_member", "email matches more than one profile");
    }
    const profile = resolution.profile;

    // De-brother denial (D115): a resolved-but-de-brothered profile is denied a
    // session. The `debrothered` sub-type lands in Phase 2; the hook is here so
    // the belt-and-suspenders Book-side check is enforced the moment it exists.

    // 4. Establish the Book role (create-if-absent as brother).
    const { role } = await this.deps.ensureUser(profile.constitutionId);

    const identity: Identity = {
      subject: email,
      profileId: profile.constitutionId,
      email,
      role,
      displayName: profile.canonicalName,
    };
    const ttl = this.deps.sessionTtlMs ?? FOUR_HOURS_MS;
    return { identity, expiresAt: Date.now() + ttl };
  }

  /** Verify the JWT and return its normalized subject email, or throw `AuthError`. */
  private async verifyAndExtractEmail(token: string): Promise<string> {
    let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
    try {
      ({ payload } = await jwtVerify(token, this.deps.jwks, {
        issuer: this.deps.issuer,
        audience: this.deps.audience,
        algorithms: this.deps.algorithms ?? DEFAULT_ALGS,
      }));
    } catch (error) {
      throw new AuthError(401, "invalid_token", `JWT verification failed: ${describe(error)}`);
    }
    // Ghost carries the member email in `sub` (ENGINEERING-DESIGN §2.1).
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new AuthError(401, "invalid_token", "token has no subject email");
    }
    return normalizeEmail(payload.sub);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
