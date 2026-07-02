import { verify as cryptoVerify } from "node:crypto";
import { type Role, formatCanonicalName, normalizeEmail } from "@pbe/shared";
import type { ProfileCache } from "../data/cache.js";
import type { KeyResolver } from "./ghost-jwks.js";
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

/** Tolerance for clock skew between Book and Ghost when checking `exp`/`nbf`. */
const CLOCK_SKEW_SEC = 60;

/**
 * The allowed JWT signing algorithms, mapped to the Node digest each one uses.
 * Ghost's members API signs with an **asymmetric RS-family** key (currently
 * RS512), so only RSASSA-PKCS1-v1_5 variants appear here. The security-critical
 * property (D104) is what is *excluded*: `alg:none` and every **symmetric**
 * algorithm — the two classic forges (an unsigned token; an `HS256` token HMAC'd
 * with the RSA public key). Because verification only ever feeds an RSA public
 * key into an RSA digest, there is no code path that could perform a symmetric
 * verification at all.
 */
const ALG_TO_DIGEST: Record<string, string> = {
  RS256: "RSA-SHA256",
  RS512: "RSA-SHA512",
};

const DEFAULT_ALGS = ["RS256", "RS512"];

export interface GhostProviderDeps {
  /** Resolver for Ghost's JWKS key by `kid` (see `ghost-jwks.ts`). */
  keyResolver: KeyResolver;
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
 *     (Ghost uses RS512 over a 1024-bit key), which rejects `alg:none` and every
 *     symmetric algorithm (the two classic forges, D104). The signature is
 *     checked with Node `crypto` rather than jose, because jose rejects Ghost's
 *     1024-bit key (see `ghost-jwks.ts`).
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

    // 2. Resolve the verified email to a single profile, failing closed. This runs
    //    BEFORE the nonce is consumed (OFC-81): a denied account (unlinked /
    //    ambiguous / de-brothered) must not burn the one-time `state` token, so the
    //    denial checks gate first and the nonce is spent only once the sign-in is
    //    actually going to succeed. (No current client can retry a spent nonce —
    //    AuthCallback guards that — but a check should never consume a one-time
    //    token before it has decided to proceed.)
    const resolution = this.deps.cache.resolveByEmail(email);
    if (resolution.kind === "none") {
      throw new AuthError(403, "unlinked_member", "no profile matches this email");
    }
    if (resolution.kind === "ambiguous") {
      throw new AuthError(403, "ambiguous_member", "email matches more than one profile");
    }
    const profile = resolution.profile;

    // De-brother denial (D115; ENGINEERING-DESIGN §2.1): a resolved-but-
    // de-brothered profile is denied a session. The de-brothering already
    // deleted the Ghost member (§5.1); this Book-side check is the
    // belt-and-suspenders half that blocks any lingering token.
    if (profile.debrothered.isDebrothered) {
      throw new AuthError(403, "debrothered", "this member has been de-brothered");
    }

    // 3. Bind the callback to a Book-initiated flow; consume the nonce once — only
    //    now that every denial check has passed, so a rejected sign-in leaves the
    //    nonce unspent (OFC-81).
    const nonceOk = await this.deps.nonceStore.consume(state);
    if (!nonceOk) {
      throw new AuthError(401, "invalid_state", "missing or replayed state nonce");
    }

    // 4. Establish the Book role (create-if-absent as brother).
    const { role } = await this.deps.ensureUser(profile.id);

    const identity: Identity = {
      subject: email,
      profileId: profile.id,
      email,
      role,
      displayName: formatCanonicalName(profile, false),
    };
    const ttl = this.deps.sessionTtlMs ?? FOUR_HOURS_MS;
    return { identity, expiresAt: Date.now() + ttl };
  }

  /**
   * Verify the compact JWT and return its normalized subject email, or throw an
   * `AuthError`. Done with Node's `crypto.verify` (not jose) so it accepts
   * Ghost's 1024-bit RSA key — see `ghost-jwks.ts`. Every D104 property is
   * preserved: the algorithm is pinned to the asymmetric RS family (so
   * `alg:none` and all symmetric algorithms are rejected before any key is
   * touched), the `kid` is required and resolved against the JWKS, and `iss`,
   * `aud`, and `exp` are checked explicitly.
   */
  private async verifyAndExtractEmail(token: string): Promise<string> {
    const parts = token.split(".");
    const headerB64 = parts[0];
    const payloadB64 = parts[1];
    const signatureB64 = parts[2];
    if (
      parts.length !== 3 ||
      headerB64 === undefined ||
      payloadB64 === undefined ||
      signatureB64 === undefined
    ) {
      throw new AuthError(401, "invalid_token", "malformed JWT");
    }

    const header = decodeSegment(headerB64);
    const payload = decodeSegment(payloadB64);

    // Algorithm pin (D104): only the configured asymmetric RS algorithms. An
    // unknown/none/symmetric `alg` never reaches a verify call.
    const allowed = this.deps.algorithms ?? DEFAULT_ALGS;
    const alg = typeof header.alg === "string" ? header.alg : "";
    const digest = ALG_TO_DIGEST[alg];
    if (!digest || !allowed.includes(alg)) {
      throw new AuthError(401, "invalid_token", `disallowed algorithm: ${alg || "none"}`);
    }
    if (typeof header.kid !== "string" || header.kid.length === 0) {
      throw new AuthError(401, "invalid_token", "token header has no kid");
    }

    // Resolve the signing key by kid (fetching/rotating via the JWKS) and verify.
    let verified = false;
    try {
      const key = await this.deps.keyResolver.resolve({ alg, kid: header.kid });
      if (key.asymmetricKeyType !== "rsa") {
        throw new AuthError(401, "invalid_token", "JWKS key is not RSA");
      }
      verified = cryptoVerify(
        digest,
        Buffer.from(`${headerB64}.${payloadB64}`),
        key,
        Buffer.from(signatureB64, "base64url"),
      );
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      throw new AuthError(
        401,
        "invalid_token",
        `signature verification failed: ${describe(error)}`,
      );
    }
    if (!verified) {
      throw new AuthError(401, "invalid_token", "bad signature");
    }

    // Registered-claim checks (iss / aud / exp / nbf), with a small clock skew.
    const nowSec = Date.now() / 1000;
    if (payload.iss !== this.deps.issuer) {
      throw new AuthError(401, "invalid_token", "unexpected issuer");
    }
    const aud = payload.aud;
    const audMatches = Array.isArray(aud)
      ? aud.includes(this.deps.audience)
      : aud === this.deps.audience;
    if (!audMatches) {
      throw new AuthError(401, "invalid_token", "unexpected audience");
    }
    if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SEC < nowSec) {
      throw new AuthError(401, "invalid_token", "token expired");
    }
    if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_SEC > nowSec) {
      throw new AuthError(401, "invalid_token", "token not yet valid");
    }

    // Ghost carries the member email in `sub` (ENGINEERING-DESIGN §2.1).
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new AuthError(401, "invalid_token", "token has no subject email");
    }
    return normalizeEmail(payload.sub);
  }
}

/** Decode a base64url JWT segment to its JSON object, or throw `AuthError`. */
function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    const value = JSON.parse(json);
    if (value === null || typeof value !== "object") {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new AuthError(401, "invalid_token", "unparseable JWT segment");
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
