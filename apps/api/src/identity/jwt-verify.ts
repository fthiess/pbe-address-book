import { type KeyObject, verify as cryptoVerify } from "node:crypto";

/**
 * The shared RS-family JWT signature-verification skeleton (OFC-225), used by BOTH
 * the Ghost members verifier (`ghost-provider.ts`) and the Linter roster verifier
 * (`google-oidc.ts`) so the security-critical alg-pin-and-verify logic exists in ONE
 * place and cannot drift between the two auth paths. It owns only the crypto: parse,
 * **algorithm pin**, `kid`-resolve, and signature check. The registered-claim checks
 * (`iss`/`aud`/`sub`/`exp`/`nbf`) stay with each caller, because they differ (Ghost
 * extracts the member email from `sub`; the roster pins `sub` to a service account).
 *
 * The signature is checked with Node `crypto.verify` rather than jose, because jose
 * rejects Ghost's 1024-bit RSA key (see `ghost-jwks.ts`). The security property is
 * what is **excluded**: only RSASSA-PKCS1-v1_5 (`RS*`) algorithms map to a digest, so
 * `alg:none` and every symmetric algorithm are rejected before any key is touched —
 * there is no code path that could feed a key into a symmetric verification (D104).
 */

/** RS-family algorithm → the Node digest it uses. No symmetric or `none` entry exists. */
export const RS_ALG_TO_DIGEST: Record<string, string> = {
  RS256: "RSA-SHA256",
  RS512: "RSA-SHA512",
};

/** Clock-skew tolerance (seconds) the callers apply to `exp`/`nbf`. */
export const JWT_CLOCK_SKEW_SEC = 60;

/** Resolves a JWKS key by `kid` to a Node `KeyObject`. Injectable so tests avoid network. */
export interface JwtKeyResolver {
  resolve(header: { alg: string; kid?: string }): Promise<KeyObject>;
}

/**
 * A genuine verification failure — a malformed, forged, wrong-algorithm, or
 * bad-signature token. The token is not acceptable; callers map this to `401`.
 */
export class JwtVerifyError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "JwtVerifyError";
  }
}

/**
 * A **transient** key-resolution / transport failure — the JWKS endpoint was
 * unreachable, rate-limited, or otherwise failed to yield the key. This is an
 * availability problem, not a bad token, so callers may map it to a retryable `5xx`
 * rather than a `401` that a client would treat as permanent bad credentials
 * (OFC-223).
 */
export class JwtKeyResolutionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "JwtKeyResolutionError";
  }
}

export interface VerifiedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/**
 * Verify a compact JWS's signature under the RS-family algorithm pin and return its
 * decoded header + payload for the caller's claim checks. Throws
 * {@link JwtKeyResolutionError} if the signing key cannot be resolved (transient),
 * else {@link JwtVerifyError} for any malformed / disallowed-alg / bad-signature
 * token.
 */
export async function verifyRsJwt(
  token: string,
  options: { keyResolver: JwtKeyResolver; allowedAlgs: readonly string[] },
): Promise<VerifiedJwt> {
  const parts = token.split(".");
  const [headerB64, payloadB64, signatureB64] = parts;
  if (parts.length !== 3 || !headerB64 || !payloadB64 || !signatureB64) {
    throw new JwtVerifyError("malformed JWT");
  }

  const header = decodeSegment(headerB64);
  const payload = decodeSegment(payloadB64);

  // Algorithm pin: only the configured RS-family algorithms reach a verify call.
  const alg = typeof header.alg === "string" ? header.alg : "";
  const digest = RS_ALG_TO_DIGEST[alg];
  if (!digest || !options.allowedAlgs.includes(alg)) {
    throw new JwtVerifyError(`disallowed algorithm: ${alg || "none"}`);
  }
  if (typeof header.kid !== "string" || header.kid.length === 0) {
    throw new JwtVerifyError("token header has no kid");
  }

  // Resolve the signing key by kid. A resolution failure is transient (OFC-223) —
  // distinct from a bad token — so it gets its own error type.
  let key: KeyObject;
  try {
    key = await options.keyResolver.resolve({ alg, kid: header.kid });
  } catch (error) {
    throw new JwtKeyResolutionError(describe(error));
  }
  if (key.asymmetricKeyType !== "rsa") {
    throw new JwtVerifyError("JWKS key is not RSA");
  }

  let verified: boolean;
  try {
    verified = cryptoVerify(
      digest,
      Buffer.from(`${headerB64}.${payloadB64}`),
      key,
      Buffer.from(signatureB64, "base64url"),
    );
  } catch (error) {
    throw new JwtVerifyError(`signature verification failed: ${describe(error)}`);
  }
  if (!verified) {
    throw new JwtVerifyError("bad signature");
  }

  return { header, payload };
}

/** Decode a base64url JWT segment to its JSON object, or throw {@link JwtVerifyError}. */
function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (value === null || typeof value !== "object") {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new JwtVerifyError("unparseable JWT segment");
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
