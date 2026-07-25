import { KeyObject, type webcrypto } from "node:crypto";
import { createRemoteJWKSet } from "jose";
import {
  JWT_CLOCK_SKEW_SEC,
  JwtKeyResolutionError,
  type JwtKeyResolver,
  JwtVerifyError,
  verifyRsJwt,
} from "./jwt-verify.js";

/**
 * Google service-account OIDC verification — Book's auth path for **callers that
 * are services, not browsers** (DECISIONS D58/D78; ENGINEERING-DESIGN §5.2). Such a
 * caller authenticates with a short-lived **Google-signed** identity token (not the
 * Ghost session cookie), and the route verifies it **in-code**, requiring
 * `iss` = Google, `aud` = Book, **and `sub` = the exact pinned service account** —
 * the subject pin is essential, since issuer + audience alone would accept any
 * Google-issued token for that audience.
 *
 * TWO CONSUMERS, ONE VERIFIER. The pattern was established by the PBE News Linter's
 * roster feed (`GET /api/roster`, D58/D78) and is now also how Cloud Scheduler
 * authenticates the nightly backup job (`POST /api/internal/backup`, D63/7b-2).
 * They differ only in *which* service account is pinned and which audience is
 * expected — both configured per instance — so this module is deliberately generic
 * and names nothing after either caller. A second copy of these claim checks is
 * exactly the drift OFC-225 consolidated away.
 *
 * The signature + algorithm pin + kid-resolve are the **shared** {@link verifyRsJwt}
 * skeleton (OFC-225), the same one the Ghost members check uses, so the security-
 * critical logic cannot drift between the auth paths. Only the registered-claim
 * checks live here. Google signs identity tokens with RS256 over 2048-bit keys.
 */

/** Google's OIDC discovery values. */
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** The key-resolver shape (an alias of the shared {@link JwtKeyResolver}). */
export type GoogleKeyResolver = JwtKeyResolver;

/** Build the Google JWKS key resolver (fetch/cache/rotate via jose's remote set). */
export function createGoogleKeyResolver(jwksUrl: string = GOOGLE_JWKS_URL): GoogleKeyResolver {
  const jwks = createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 30_000 });
  return {
    async resolve(header) {
      const key = (await jwks(header)) as KeyObject | webcrypto.CryptoKey;
      return key instanceof KeyObject ? key : KeyObject.from(key);
    },
  };
}

/** The seam a service-authenticated route depends on: verify a bearer token or throw. */
export interface ServiceIdentityVerifier {
  /** Resolve if the token is a valid, subject-pinned Google identity token; else throw. */
  verify(token: string): Promise<void>;
}

export interface GoogleOidcVerifierDeps {
  keyResolver: GoogleKeyResolver;
  /** Expected `aud` — the audience this Book endpoint was configured with. */
  audience: string;
  /**
   * Expected `sub` — the exact calling service account (the essential pin, D78).
   *
   * ⚠ A Google OIDC token's `sub` is the service account's **numeric unique ID**,
   * not its email — `gcloud iam service-accounts describe SA --format='value(uniqueId)'`.
   * Configuring the email here fails every token with "unexpected subject".
   */
  subject: string;
  /** Accepted issuers; defaults to Google's two canonical forms. */
  issuers?: string[];
  /** Allowed algorithms; defaults to `["RS256"]`. */
  algorithms?: string[];
}

/** Thrown on a genuine verification failure (bad token); routes map it to `401`. */
export class ServiceIdentityAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceIdentityAuthError";
  }
}

/**
 * Thrown on a **transient** failure to resolve Google's signing key (JWKS
 * unreachable / rate-limited); routes map it to a retryable `503` so the caller
 * backs off and retries rather than treating a valid token as permanently rejected
 * (OFC-223).
 */
export class ServiceIdentityUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceIdentityUnavailableError";
  }
}

export class GoogleOidcVerifier implements ServiceIdentityVerifier {
  constructor(private readonly deps: GoogleOidcVerifierDeps) {}

  async verify(token: string): Promise<void> {
    // Signature + alg pin + kid-resolve via the shared verifier. A key-resolution
    // failure is transient (→ 503, OFC-223); any other failure is a bad token (→ 401).
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await verifyRsJwt(token, {
        keyResolver: this.deps.keyResolver,
        allowedAlgs: this.deps.algorithms ?? ["RS256"],
      }));
    } catch (error) {
      if (error instanceof JwtKeyResolutionError) {
        throw new ServiceIdentityUnavailableError(error.message);
      }
      if (error instanceof JwtVerifyError) {
        throw new ServiceIdentityAuthError(error.message);
      }
      throw error;
    }

    // Registered-claim checks: iss / aud / sub (the pin) / exp / nbf.
    const issuers = this.deps.issuers ?? GOOGLE_ISSUERS;
    if (typeof payload.iss !== "string" || !issuers.includes(payload.iss)) {
      throw new ServiceIdentityAuthError("unexpected issuer");
    }
    const aud = payload.aud;
    const audMatches = Array.isArray(aud)
      ? aud.includes(this.deps.audience)
      : aud === this.deps.audience;
    if (!audMatches) {
      throw new ServiceIdentityAuthError("unexpected audience");
    }
    if (payload.sub !== this.deps.subject) {
      throw new ServiceIdentityAuthError("unexpected subject");
    }
    const nowSec = Date.now() / 1000;
    if (typeof payload.exp !== "number" || payload.exp + JWT_CLOCK_SKEW_SEC < nowSec) {
      throw new ServiceIdentityAuthError("token expired");
    }
    if (typeof payload.nbf === "number" && payload.nbf - JWT_CLOCK_SKEW_SEC > nowSec) {
      throw new ServiceIdentityAuthError("token not yet valid");
    }
  }
}
