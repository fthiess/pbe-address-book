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
 * Google service-account OIDC verification for the Linter roster endpoint
 * (DECISIONS D58/D78; ENGINEERING-DESIGN §5.2). The Linter authenticates with a
 * short-lived **Google-signed** identity token (not the Ghost session cookie); the
 * roster endpoint verifies it **in-code**, requiring `iss` = Google, `aud` = Book,
 * **and `sub` = the exact pinned Linter service account** — the subject pin is
 * essential, since issuer + audience alone would accept any Google-issued token for
 * that audience.
 *
 * The signature + algorithm pin + kid-resolve are the **shared** {@link verifyRsJwt}
 * skeleton (OFC-225), the same one the Ghost members check uses, so the security-
 * critical logic cannot drift between the two auth paths. Only the registered-claim
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

/** The seam the roster route depends on: verify a bearer token or throw. */
export interface RosterVerifier {
  /** Resolve if the token is a valid, subject-pinned Google identity token; else throw. */
  verify(token: string): Promise<void>;
}

export interface GoogleOidcVerifierDeps {
  keyResolver: GoogleKeyResolver;
  /** Expected `aud` — Book's roster audience. */
  audience: string;
  /** Expected `sub` — the exact Linter service account (the essential pin, D78). */
  subject: string;
  /** Accepted issuers; defaults to Google's two canonical forms. */
  issuers?: string[];
  /** Allowed algorithms; defaults to `["RS256"]`. */
  algorithms?: string[];
}

/** Thrown on a genuine verification failure (bad token); the roster route maps it to `401`. */
export class RosterAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterAuthError";
  }
}

/**
 * Thrown on a **transient** failure to resolve Google's signing key (JWKS
 * unreachable / rate-limited); the roster route maps it to a retryable `503` so the
 * Linter backs off and retries rather than treating a valid token as permanently
 * rejected (OFC-223).
 */
export class RosterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterUnavailableError";
  }
}

export class GoogleOidcVerifier implements RosterVerifier {
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
        throw new RosterUnavailableError(error.message);
      }
      if (error instanceof JwtVerifyError) {
        throw new RosterAuthError(error.message);
      }
      throw error;
    }

    // Registered-claim checks: iss / aud / sub (the pin) / exp / nbf.
    const issuers = this.deps.issuers ?? GOOGLE_ISSUERS;
    if (typeof payload.iss !== "string" || !issuers.includes(payload.iss)) {
      throw new RosterAuthError("unexpected issuer");
    }
    const aud = payload.aud;
    const audMatches = Array.isArray(aud)
      ? aud.includes(this.deps.audience)
      : aud === this.deps.audience;
    if (!audMatches) {
      throw new RosterAuthError("unexpected audience");
    }
    if (payload.sub !== this.deps.subject) {
      throw new RosterAuthError("unexpected subject");
    }
    const nowSec = Date.now() / 1000;
    if (typeof payload.exp !== "number" || payload.exp + JWT_CLOCK_SKEW_SEC < nowSec) {
      throw new RosterAuthError("token expired");
    }
    if (typeof payload.nbf === "number" && payload.nbf - JWT_CLOCK_SKEW_SEC > nowSec) {
      throw new RosterAuthError("token not yet valid");
    }
  }
}
