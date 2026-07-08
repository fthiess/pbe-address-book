import { KeyObject, verify as cryptoVerify, type webcrypto } from "node:crypto";
import { createRemoteJWKSet } from "jose";

/**
 * Google service-account OIDC verification for the Linter roster endpoint
 * (DECISIONS D58/D78; ENGINEERING-DESIGN §5.2). The Linter authenticates with a
 * short-lived **Google-signed** identity token (not the Ghost session cookie); the
 * roster endpoint verifies it **in-code** against Google's JWKS, requiring
 * `iss` = Google, `aud` = Book, **and `sub` = the exact pinned Linter service
 * account** — the subject pin is essential, since issuer + audience alone would
 * accept any Google-issued token for that audience.
 *
 * The shape deliberately mirrors the Ghost JWKS check (`ghost-provider.ts`): the
 * algorithm is pinned (RS256 — Google's signing alg, 2048-bit keys), `alg:none`
 * and every symmetric algorithm are rejected before any key is touched, the `kid`
 * is required and resolved against the JWKS, and `iss`/`aud`/`sub`/`exp`/`nbf` are
 * checked explicitly. The signature is checked with Node `crypto.verify`.
 */

/** Google's OIDC discovery values. */
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** Google signs identity tokens with RS256; only that maps to a digest here. */
const ALG_TO_DIGEST: Record<string, string> = { RS256: "RSA-SHA256" };

/** Clock-skew tolerance on `exp`/`nbf`, matching the Ghost verifier. */
const CLOCK_SKEW_SEC = 60;

/** Resolves a JWKS key by `kid` to a Node `KeyObject`. Injectable for tests. */
export interface GoogleKeyResolver {
  resolve(header: { alg: string; kid?: string }): Promise<KeyObject>;
}

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

/** Thrown on any verification failure; the roster route maps it to `401`. */
export class RosterAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterAuthError";
  }
}

export class GoogleOidcVerifier implements RosterVerifier {
  constructor(private readonly deps: GoogleOidcVerifierDeps) {}

  async verify(token: string): Promise<void> {
    const parts = token.split(".");
    const [headerB64, payloadB64, signatureB64] = parts;
    if (parts.length !== 3 || !headerB64 || !payloadB64 || !signatureB64) {
      throw new RosterAuthError("malformed JWT");
    }

    const header = decodeSegment(headerB64);
    const payload = decodeSegment(payloadB64);

    // Algorithm pin: only the configured asymmetric RS algorithm(s).
    const allowed = this.deps.algorithms ?? ["RS256"];
    const alg = typeof header.alg === "string" ? header.alg : "";
    const digest = ALG_TO_DIGEST[alg];
    if (!digest || !allowed.includes(alg)) {
      throw new RosterAuthError(`disallowed algorithm: ${alg || "none"}`);
    }
    if (typeof header.kid !== "string" || header.kid.length === 0) {
      throw new RosterAuthError("token header has no kid");
    }

    // Resolve the signing key by kid and verify the signature.
    let verified: boolean;
    try {
      const key = await this.deps.keyResolver.resolve({ alg, kid: header.kid });
      if (key.asymmetricKeyType !== "rsa") {
        throw new RosterAuthError("JWKS key is not RSA");
      }
      verified = cryptoVerify(
        digest,
        Buffer.from(`${headerB64}.${payloadB64}`),
        key,
        Buffer.from(signatureB64, "base64url"),
      );
    } catch (error) {
      if (error instanceof RosterAuthError) {
        throw error;
      }
      throw new RosterAuthError(`signature verification failed: ${describe(error)}`);
    }
    if (!verified) {
      throw new RosterAuthError("bad signature");
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
    if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SEC < nowSec) {
      throw new RosterAuthError("token expired");
    }
    if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_SEC > nowSec) {
      throw new RosterAuthError("token not yet valid");
    }
  }
}

/** Decode a base64url JWT segment to its JSON object, or throw `RosterAuthError`. */
function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (value === null || typeof value !== "object") {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new RosterAuthError("unparseable JWT segment");
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
