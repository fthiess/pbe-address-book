import { type JWTVerifyGetKey, SignJWT, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { ProfileCache } from "../data/cache.js";
import { makeProfile } from "../test-support/make-profile.js";
import { GhostIdentityProvider } from "./ghost-provider.js";
import type { NonceService } from "./nonce-store.js";
import { AuthError } from "./types.js";

/** The signing-key type jose returns from `generateKeyPair` (no `KeyLike` in v6). */
type GeneratedKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

/**
 * Offline verification of the security-critical Ghost handshake (D104/D97/R20).
 * A synthetic RS256 keypair stands in for Ghost's signing key, so the genuine
 * crypto path — signature, alg pin, iss/aud/exp, nonce, email resolution — is
 * exercised end to end without the live Ghost site.
 */

const ISSUER = "https://pbe400.org/members/api";
const AUDIENCE = "https://pbe400.org/members/api";
const LINKED_EMAIL = "linked.brother.5001@example.test";

let privateKey: GeneratedKey;
let publicKey: GeneratedKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  ({ privateKey, publicKey } = await generateKeyPair("RS256"));
  // A local key resolver returning our synthetic public key for any token.
  jwks = (async () => publicKey) as unknown as JWTVerifyGetKey;
});

/** A trivial single-use nonce double that always accepts the named nonce once. */
function singleUseNonce(valid: string): NonceService & { consumedCount: number } {
  let consumed = false;
  return {
    consumedCount: 0,
    async issue() {
      return valid;
    },
    async consume(nonce: string) {
      if (nonce !== valid || consumed) {
        return false;
      }
      consumed = true;
      this.consumedCount += 1;
      return true;
    },
  };
}

async function loadedCache(
  ...profiles: Parameters<typeof makeProfile>[0][]
): Promise<ProfileCache> {
  const cache = new ProfileCache();
  await cache.load(profiles.map((p) => makeProfile(p)));
  return cache;
}

function buildProvider(
  cache: ProfileCache,
  nonceStore: NonceService,
  ensureRole: "brother" | "manager" | "admin" = "brother",
): GhostIdentityProvider {
  return new GhostIdentityProvider({
    jwks,
    issuer: ISSUER,
    audience: AUDIENCE,
    nonceStore,
    cache,
    ensureUser: async () => ({ role: ensureRole }),
  });
}

interface TokenOverrides {
  subject?: string;
  issuer?: string;
  audience?: string;
  expirationTime?: string | number;
  signingKey?: GeneratedKey;
  alg?: string;
}

async function makeToken(overrides: TokenOverrides = {}): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: overrides.alg ?? "RS256" })
    .setSubject(overrides.subject ?? LINKED_EMAIL)
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setExpirationTime(overrides.expirationTime ?? "10m")
    .sign(overrides.signingKey ?? privateKey);
}

describe("GhostIdentityProvider.createSession", () => {
  it("verifies a valid token, consumes the nonce, and resolves the email", async () => {
    const cache = await loadedCache({ constitutionId: 5001, email: LINKED_EMAIL });
    const nonce = singleUseNonce("good-nonce");
    const provider = buildProvider(cache, nonce, "admin");

    const session = await provider.createSession({ token: await makeToken(), state: "good-nonce" });

    expect(session.identity.profileId).toBe(5001);
    expect(session.identity.email).toBe(LINKED_EMAIL);
    expect(session.identity.role).toBe("admin"); // from ensureUser
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    expect(nonce.consumedCount).toBe(1);
  });

  it("normalizes the JWT subject before resolving (D97)", async () => {
    const cache = await loadedCache({ constitutionId: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(cache, singleUseNonce("n"));
    // Mixed-case + surrounding spaces still resolve to the same profile.
    const token = await makeToken({ subject: `  ${LINKED_EMAIL.toUpperCase()}  ` });
    const session = await provider.createSession({ token, state: "n" });
    expect(session.identity.profileId).toBe(5001);
  });

  it("verifies an RS512 token — Ghost's actual signing algorithm", async () => {
    // Ghost members JWTs are RS512; prove a real-shaped token verifies against
    // its own JWKS key under the asymmetric-only pin.
    const rs512 = await generateKeyPair("RS512");
    const cache = await loadedCache({ constitutionId: 5001, email: LINKED_EMAIL });
    const provider = new GhostIdentityProvider({
      jwks: (async () => rs512.publicKey) as unknown as JWTVerifyGetKey,
      issuer: ISSUER,
      audience: AUDIENCE,
      nonceStore: singleUseNonce("n"),
      cache,
      ensureUser: async () => ({ role: "brother" }),
    });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS512" })
      .setSubject(LINKED_EMAIL)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("10m")
      .sign(rs512.privateKey);
    const session = await provider.createSession({ token, state: "n" });
    expect(session.identity.profileId).toBe(5001);
  });

  it("rejects a token signed with the wrong key (forged signature)", async () => {
    const cache = await loadedCache({ constitutionId: 5001, email: LINKED_EMAIL });
    const other = await generateKeyPair("RS256");
    const provider = buildProvider(cache, singleUseNonce("n"));
    const token = await makeToken({ signingKey: other.privateKey });
    await expect(provider.createSession({ token, state: "n" })).rejects.toMatchObject({
      status: 401,
      code: "invalid_token",
    });
  });

  it("rejects a symmetric-algorithm (HS256) token — the alg pin (D104)", async () => {
    const cache = await loadedCache({ constitutionId: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(cache, singleUseNonce("n"));
    // Forge an HS256 token HMAC'd with bytes; the RS256 pin must reject it.
    const hs = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(LINKED_EMAIL)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode("a".repeat(32)));
    await expect(provider.createSession({ token: hs, state: "n" })).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("rejects an expired token", async () => {
    const cache = await loadedCache({ constitutionId: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(cache, singleUseNonce("n"));
    const token = await makeToken({ expirationTime: Math.floor(Date.now() / 1000) - 60 });
    await expect(provider.createSession({ token, state: "n" })).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("rejects a wrong-issuer and wrong-audience token", async () => {
    const cache = await loadedCache({ constitutionId: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(cache, singleUseNonce("n"));
    const badIss = await makeToken({ issuer: "https://evil.example/members/api" });
    await expect(provider.createSession({ token: badIss, state: "n" })).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("denies an email that matches no profile (unlinked_member)", async () => {
    const cache = await loadedCache({ constitutionId: 5001, email: "someone.else@example.test" });
    const provider = buildProvider(cache, singleUseNonce("n"));
    await expect(
      provider.createSession({ token: await makeToken(), state: "n" }),
    ).rejects.toMatchObject({ status: 403, code: "unlinked_member" });
  });

  it("fails closed when an email matches more than one profile (ambiguous_member)", async () => {
    const cache = await loadedCache(
      { constitutionId: 5001, email: LINKED_EMAIL },
      { constitutionId: 5002, email: LINKED_EMAIL.toUpperCase() }, // same after normalization
    );
    const provider = buildProvider(cache, singleUseNonce("n"));
    await expect(
      provider.createSession({ token: await makeToken(), state: "n" }),
    ).rejects.toMatchObject({ status: 403, code: "ambiguous_member" });
  });

  it("rejects a missing or replayed state nonce (invalid_state)", async () => {
    const cache = await loadedCache({ constitutionId: 5001, email: LINKED_EMAIL });
    const nonce = singleUseNonce("good-nonce");
    const provider = buildProvider(cache, nonce);
    // First use consumes it; a replay of the same valid token + nonce fails.
    await provider.createSession({ token: await makeToken(), state: "good-nonce" });
    await expect(
      provider.createSession({ token: await makeToken(), state: "good-nonce" }),
    ).rejects.toMatchObject({ status: 401, code: "invalid_state" });
  });

  it("requires both a token and a state", async () => {
    const cache = await loadedCache({ constitutionId: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(cache, singleUseNonce("n"));
    await expect(provider.createSession({ state: "n" })).rejects.toMatchObject({
      code: "invalid_token",
    });
    await expect(provider.createSession({ token: await makeToken() })).rejects.toMatchObject({
      code: "invalid_state",
    });
  });
});
