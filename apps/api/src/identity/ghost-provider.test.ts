import { type KeyObject, sign as cryptoSign, generateKeyPairSync } from "node:crypto";
import { errors as joseErrors } from "jose";
import { describe, expect, it } from "vitest";
import { ProfileCache } from "../data/cache.js";
import { makeProfile } from "../test-support/make-profile.js";
import type { KeyResolver } from "./ghost-jwks.js";
import { GhostIdentityProvider } from "./ghost-provider.js";
import type { GhostMemberLookup } from "./ghost-reader.js";
import { JwtKeyResolutionError } from "./jwt-verify.js";
import type { NonceService } from "./nonce-store.js";
import { AuthError } from "./types.js";

/**
 * Offline verification of the security-critical Ghost handshake (D104/D97/R20).
 * Tokens are built and signed with Node crypto (the same path the provider
 * verifies with), so the genuine signature/alg-pin/iss/aud/exp/nonce/resolution
 * flow is exercised end to end without the live Ghost site — including the
 * regression case that broke against the real instance: **RS512 over a 1024-bit
 * key**, which jose rejects but Ghost actually uses.
 */

const ISSUER = "https://staging.pbe400.org/members/api";
const AUDIENCE = "https://staging.pbe400.org/members/api";
const LINKED_EMAIL = "linked.brother.5001@example.test";

const b64u = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

/** A resolver that returns one public key for any kid (tests don't rotate keys). */
function resolverFor(publicKey: KeyObject): KeyResolver {
  return { resolve: async () => publicKey };
}

/** A single-use nonce double that accepts the named nonce exactly once. */
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

interface TokenOptions {
  privateKey: KeyObject;
  alg?: string;
  digest?: string;
  kid?: string | null;
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  signKey?: KeyObject;
}

/** Build a signed compact JWT with Node crypto. */
function makeToken(opts: TokenOptions): string {
  const alg = opts.alg ?? "RS512";
  const header: Record<string, unknown> = { alg, typ: "JWT" };
  if (opts.kid !== null) {
    header.kid = opts.kid ?? "test-kid";
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: opts.sub ?? LINKED_EMAIL,
    iss: opts.iss ?? ISSUER,
    aud: opts.aud ?? AUDIENCE,
    iat: now,
    exp: opts.exp ?? now + 600,
  };
  if (opts.nbf !== undefined) {
    payload.nbf = opts.nbf;
  }
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const digest = opts.digest ?? (alg === "RS256" ? "RSA-SHA256" : "RSA-SHA512");
  const signature = cryptoSign(digest, Buffer.from(signingInput), opts.signKey ?? opts.privateKey);
  return `${signingInput}.${b64u(signature)}`;
}

async function loadedCache(
  ...profiles: Parameters<typeof makeProfile>[0][]
): Promise<ProfileCache> {
  const cache = new ProfileCache();
  await cache.load(profiles.map((p) => makeProfile(p)));
  return cache;
}

function buildProvider(
  publicKey: KeyObject,
  cache: ProfileCache,
  nonceStore: NonceService,
  memberLookup?: GhostMemberLookup,
): GhostIdentityProvider {
  return new GhostIdentityProvider({
    keyResolver: resolverFor(publicKey),
    issuer: ISSUER,
    audience: AUDIENCE,
    nonceStore,
    cache,
    // Role now comes from the resolved profile (OFC-139), not this call; ensureUser
    // only guarantees the private `users` doc (stars) exists.
    ensureUser: async () => ({ stars: [] }),
    // Omitted by default: the uuid lookup (D137) is optional, and every test above
    // this line predates it and must keep passing with no Ghost HTTP dependency.
    memberLookup,
  });
}

describe("GhostIdentityProvider.createSession", () => {
  it("verifies a valid token, consumes the nonce, and resolves the email", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL, role: "admin" });
    const nonce = singleUseNonce("good-nonce");
    const provider = buildProvider(publicKey, cache, nonce);

    const session = await provider.createSession({
      token: makeToken({ privateKey }),
      state: "good-nonce",
    });

    expect(session.identity.profileId).toBe(5001);
    expect(session.identity.email).toBe(LINKED_EMAIL);
    expect(session.identity.role).toBe("admin"); // snapshotted from the profile (OFC-139)
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    expect(nonce.consumedCount).toBe(1);
  });

  it("verifies an RS512 token over a 1024-bit key — Ghost's real key (regression)", async () => {
    // Ghost signs member JWTs RS512 with a 1024-bit RSA key; jose rejects that
    // key length, which is why the verifier uses Node crypto. This must pass.
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    const session = await provider.createSession({
      token: makeToken({ privateKey, alg: "RS512" }),
      state: "n",
    });
    expect(session.identity.profileId).toBe(5001);
  });

  it("normalizes the JWT subject before resolving (D97)", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    const token = makeToken({ privateKey, sub: `  ${LINKED_EMAIL.toUpperCase()}  ` });
    const session = await provider.createSession({ token, state: "n" });
    expect(session.identity.profileId).toBe(5001);
  });

  it("rejects a token signed with the wrong key (forged signature)", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    const token = makeToken({ privateKey: other.privateKey, signKey: other.privateKey });
    await expect(provider.createSession({ token, state: "n" })).rejects.toMatchObject({
      status: 401,
      code: "invalid_token",
    });
  });

  it("tags a JWKS key-resolution failure `jwks`, keeping the client-facing 401 invalid_token (7a-3a)", async () => {
    // Ghost's JWKS endpoint is unreachable / can't yield the key: the resolver throws
    // a JwtKeyResolutionError (OFC-223). The client still sees 401 invalid_token, but
    // the AuthError is categorized so the route can audit it as `auth.jwks` — an
    // infrastructure fault, not a credential denial.
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = new GhostIdentityProvider({
      keyResolver: {
        resolve: async () => {
          throw new JwtKeyResolutionError("JWKS endpoint unreachable");
        },
      },
      issuer: ISSUER,
      audience: AUDIENCE,
      nonceStore: singleUseNonce("n"),
      cache,
      ensureUser: async () => ({ stars: [] }),
    });

    await expect(
      provider.createSession({ token: makeToken({ privateKey }), state: "n" }),
    ).rejects.toMatchObject({ status: 401, code: "invalid_token", category: "jwks" });
  });

  it("classifies an unknown-`kid` (no matching key) as a DENIAL, not a JWKS infra fault (7a-3a)", async () => {
    // jose's createRemoteJWKSet throws JWKSNoMatchingKey when a token's `kid` is present
    // but resolves to no key — even after its refetch (the D87 rotation robustness). A
    // still-unresolved kid is therefore a bogus / rotated-away key id: a forged or stale
    // TOKEN, not an availability fault. It must be a plain `invalid_token` denial (audited
    // `auth.signin denied`), NOT tagged `jwks` (which would hide a token-forgery burst from
    // the sign-in-denial alert and pollute the JWKS-availability alert). Contrast the
    // transport-failure case above, which stays `jwks`.
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = new GhostIdentityProvider({
      keyResolver: {
        resolve: async () => {
          throw new joseErrors.JWKSNoMatchingKey();
        },
      },
      issuer: ISSUER,
      audience: AUDIENCE,
      nonceStore: singleUseNonce("n"),
      cache,
      ensureUser: async () => ({ stars: [] }),
    });

    const error = await provider
      .createSession({ token: makeToken({ privateKey }), state: "n" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 401, code: "invalid_token" });
    // The crux: NOT categorized as an infrastructure fault.
    expect((error as AuthError).category).toBeUndefined();
  });

  it("rejects a symmetric-algorithm (HS256) token — the alg pin (D104)", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    // Hand-build an HS256-headed token; the alg pin rejects it before any verify.
    const header = b64u(JSON.stringify({ alg: "HS256", kid: "test-kid", typ: "JWT" }));
    const payload = b64u(JSON.stringify({ sub: LINKED_EMAIL, iss: ISSUER, aud: AUDIENCE }));
    const token = `${header}.${payload}.${b64u("not-a-real-signature")}`;
    await expect(provider.createSession({ token, state: "n" })).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("rejects an alg:none token (D104)", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    const header = b64u(JSON.stringify({ alg: "none", typ: "JWT" }));
    const payload = b64u(JSON.stringify({ sub: LINKED_EMAIL, iss: ISSUER, aud: AUDIENCE }));
    const token = `${header}.${payload}.`;
    await expect(provider.createSession({ token, state: "n" })).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("rejects a token with no kid", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    await expect(
      provider.createSession({ token: makeToken({ privateKey, kid: null }), state: "n" }),
    ).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("rejects an expired token", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    const token = makeToken({ privateKey, exp: Math.floor(Date.now() / 1000) - 120 });
    await expect(provider.createSession({ token, state: "n" })).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("rejects a wrong-issuer and wrong-audience token", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    const badIss = makeToken({ privateKey, iss: "https://evil.example/members/api" });
    await expect(provider.createSession({ token: badIss, state: "n" })).rejects.toBeInstanceOf(
      AuthError,
    );
    const badAud = makeToken({ privateKey, aud: "https://evil.example/members/api" });
    await expect(provider.createSession({ token: badAud, state: "n" })).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("denies an email that matches no profile (unlinked_member)", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: "someone.else@example.test" });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    await expect(
      provider.createSession({ token: makeToken({ privateKey }), state: "n" }),
    ).rejects.toMatchObject({ status: 403, code: "unlinked_member" });
  });

  it("fails closed when an email matches more than one profile (ambiguous_member)", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache(
      { id: 5001, email: LINKED_EMAIL },
      { id: 5002, email: LINKED_EMAIL.toUpperCase() }, // same after normalization
    );
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    await expect(
      provider.createSession({ token: makeToken({ privateKey }), state: "n" }),
    ).rejects.toMatchObject({ status: 403, code: "ambiguous_member" });
  });

  it("rejects a missing or replayed state nonce (invalid_state)", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(publicKey, cache, singleUseNonce("good-nonce"));
    await provider.createSession({ token: makeToken({ privateKey }), state: "good-nonce" });
    await expect(
      provider.createSession({ token: makeToken({ privateKey }), state: "good-nonce" }),
    ).rejects.toMatchObject({ status: 401, code: "invalid_state" });
  });

  it("requires both a token and a state", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    await expect(provider.createSession({ state: "n" })).rejects.toMatchObject({
      code: "invalid_token",
    });
    await expect(
      provider.createSession({ token: makeToken({ privateKey }) }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("denies a session to a de-brothered profile (debrothered, D115)", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({
      id: 5001,
      email: LINKED_EMAIL,
      debrothered: { isDebrothered: true, debrotheredAt: "2026-01-01T00:00:00.000Z" },
    });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"));
    await expect(
      provider.createSession({ token: makeToken({ privateKey }), state: "n" }),
    ).rejects.toMatchObject({ status: 403, code: "debrothered" });
  });
});

/**
 * The analytics-identity fetch (D137, OFC-287). The property under test is not
 * really "the uuid arrives" — it is that **nothing about this step can cost a
 * brother his sign-in**. Sign-in previously made zero Ghost HTTP calls; this adds
 * the first one, and every way it can fail must degrade to a uuid-less session.
 */
describe("GhostIdentityProvider.createSession — Ghost member uuid (D137)", () => {
  const UUID = "4fa3e4df-85d5-44bd-b0bf-d504bbe22060";

  /** Sign in successfully with the supplied lookup and return the session. */
  async function signInWith(memberLookup?: GhostMemberLookup) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({ id: 5001, email: LINKED_EMAIL });
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"), memberLookup);
    return provider.createSession({ token: makeToken({ privateKey }), state: "n" });
  }

  it("puts the uuid on the identity, keyed on the verified email", async () => {
    const seen: string[] = [];
    const session = await signInWith({
      findUuidByEmail: async (email) => {
        seen.push(email);
        return UUID;
      },
    });
    expect(session.identity.ghostMemberUuid).toBe(UUID);
    // Keyed on the **verified, normalized** email — never on unvalidated input.
    expect(seen).toEqual([LINKED_EMAIL]);
  });

  it("still signs in when the lookup throws (Ghost down / timeout / bad key)", async () => {
    const session = await signInWith({
      findUuidByEmail: async () => {
        throw new Error("ghost unreachable");
      },
    });
    expect(session.identity.profileId).toBe(5001);
    expect(session.identity.ghostMemberUuid).toBeUndefined();
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("still signs in when Ghost has no member at that address", async () => {
    const session = await signInWith({ findUuidByEmail: async () => null });
    expect(session.identity.profileId).toBe(5001);
    expect(session.identity.ghostMemberUuid).toBeUndefined();
  });

  it("still signs in when no lookup is wired at all (unconfigured Admin API)", async () => {
    const session = await signInWith(undefined);
    expect(session.identity.profileId).toBe(5001);
    expect(session.identity.ghostMemberUuid).toBeUndefined();
  });

  it("omits the key entirely rather than setting it undefined (Firestore rejects undefined)", async () => {
    // The session is serialized whole into the session document; an explicit
    // `undefined` field value would throw on write and break sign-in at the store.
    const session = await signInWith({ findUuidByEmail: async () => null });
    expect(Object.hasOwn(session.identity, "ghostMemberUuid")).toBe(false);
  });

  it("does not consult Ghost until the sign-in has already been granted", async () => {
    // Ordering guarantee: the lookup runs last, so a denied sign-in makes no Ghost
    // call at all — a rejected caller cannot be used to probe Ghost, and the
    // fail-soft claim holds by construction rather than by catch-block alone.
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cache = await loadedCache({
      id: 5001,
      email: LINKED_EMAIL,
      debrothered: { isDebrothered: true, debrotheredAt: "2026-01-01T00:00:00.000Z" },
    });
    let calls = 0;
    const provider = buildProvider(publicKey, cache, singleUseNonce("n"), {
      findUuidByEmail: async () => {
        calls += 1;
        return UUID;
      },
    });
    await expect(
      provider.createSession({ token: makeToken({ privateKey }), state: "n" }),
    ).rejects.toMatchObject({ status: 403, code: "debrothered" });
    expect(calls).toBe(0);
  });
});
