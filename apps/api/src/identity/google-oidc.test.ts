import { type KeyObject, sign as cryptoSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type GoogleKeyResolver, GoogleOidcVerifier, RosterAuthError } from "./google-oidc.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const AUDIENCE = "https://book.pbe400.org";
const SUBJECT = "112233445566778899000"; // the pinned Linter service-account subject
const ISSUER = "https://accounts.google.com";

/** A resolver that always returns our local public key (no network). */
const resolver: GoogleKeyResolver = { resolve: async () => publicKey };

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Mint a signed token with overridable header/payload for the negative cases. */
function mintToken(
  payload: Record<string, unknown>,
  opts: { alg?: string; kid?: string; sign?: boolean; key?: KeyObject } = {},
): string {
  const header = { alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature =
    opts.sign === false
      ? // A non-empty garbage segment so an alg:none forge reaches the alg pin
        // (rather than being rejected earlier as a malformed 2-segment token).
        b64url("forged")
      : b64url(cryptoSign("RSA-SHA256", Buffer.from(signingInput), opts.key ?? privateKey));
  return `${signingInput}.${signature}`;
}

const validPayload = () => ({
  iss: ISSUER,
  aud: AUDIENCE,
  sub: SUBJECT,
  exp: Math.floor(Date.now() / 1000) + 300,
});

function verifier(overrides: Partial<{ audience: string; subject: string }> = {}) {
  return new GoogleOidcVerifier({
    keyResolver: resolver,
    audience: overrides.audience ?? AUDIENCE,
    subject: overrides.subject ?? SUBJECT,
  });
}

describe("GoogleOidcVerifier (subject-pinned roster auth, D58/D78)", () => {
  it("accepts a valid, correctly-pinned Google identity token", async () => {
    await expect(verifier().verify(mintToken(validPayload()))).resolves.toBeUndefined();
  });

  it("rejects a token whose subject is not the pinned service account", async () => {
    const token = mintToken({ ...validPayload(), sub: "999999999" });
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(RosterAuthError);
  });

  it("rejects a wrong audience", async () => {
    const token = mintToken({ ...validPayload(), aud: "https://someone-else" });
    await expect(verifier().verify(token)).rejects.toThrow(/audience/);
  });

  it("rejects a wrong issuer", async () => {
    const token = mintToken({ ...validPayload(), iss: "https://evil.example" });
    await expect(verifier().verify(token)).rejects.toThrow(/issuer/);
  });

  it("rejects alg:none (unsigned forge)", async () => {
    const token = mintToken(validPayload(), { alg: "none", sign: false });
    await expect(verifier().verify(token)).rejects.toThrow(/algorithm/);
  });

  it("rejects a symmetric algorithm", async () => {
    const token = mintToken(validPayload(), { alg: "HS256" });
    await expect(verifier().verify(token)).rejects.toThrow(/algorithm/);
  });

  it("rejects an expired token", async () => {
    const token = mintToken({ ...validPayload(), exp: Math.floor(Date.now() / 1000) - 3600 });
    await expect(verifier().verify(token)).rejects.toThrow(/expired/);
  });

  it("rejects a signature from the wrong key", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const token = mintToken(validPayload(), { key: other });
    await expect(verifier().verify(token)).rejects.toThrow(/signature|bad/);
  });

  it("rejects a token with no kid", async () => {
    const token = mintToken(validPayload(), { kid: "" });
    await expect(verifier().verify(token)).rejects.toThrow(/kid/);
  });
});
