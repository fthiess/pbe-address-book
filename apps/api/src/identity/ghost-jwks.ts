import { KeyObject, type webcrypto } from "node:crypto";
import { createRemoteJWKSet } from "jose";

/**
 * Resolves a Ghost JWKS key by the token's `kid`, returning a Node `KeyObject`
 * ready for `crypto.verify`. An interface so tests can inject a synthetic key
 * without a network fetch.
 */
export interface KeyResolver {
  resolve(header: { alg: string; kid?: string }): Promise<KeyObject>;
}

/**
 * Build the Ghost JWKS key resolver (ENGINEERING-DESIGN §2.1/§2.7, DECISIONS
 * D87).
 *
 * We use jose's `createRemoteJWKSet` for the *fetch* path only — it caches the
 * key set in memory, refreshes on a cooldown, and refetches on an unknown `kid`
 * (single-flighted, so an unknown-kid flood cannot stampede Ghost), which is the
 * key-rotation robustness D87 asks for. We do **not** use jose to *verify*: Ghost
 * signs member JWTs with RS512 against a **1024-bit** RSA key, and jose enforces a
 * 2048-bit minimum modulus on the verify path (throwing "RS512 requires key
 * modulusLength to be 2048 bits or larger"), which would reject every real Ghost
 * token. This is core Ghost behavior (Ghost Pro's member key is 1024-bit too —
 * see TryGhost/Ghost#24831), so the verifier must accept it. The signature check
 * is therefore done with Node's `crypto.verify` (no modulus floor) in
 * `ghost-provider.ts`; jose's length check is only in *its* verify, not in the
 * key *resolution* this resolver uses.
 */
export function createGhostKeyResolver(jwksUrl: string): KeyResolver {
  const jwks = createRemoteJWKSet(new URL(jwksUrl), {
    // Bound how often an unknown-kid miss may trigger a refetch (single-flight + cap).
    cooldownDuration: 30_000,
  });
  return {
    async resolve(header) {
      // jose resolves the key by `kid` (fetching/rotating as needed). In Node it
      // returns a Web CryptoKey; normalize to a KeyObject for crypto.verify.
      const key = (await jwks(header)) as KeyObject | webcrypto.CryptoKey;
      return key instanceof KeyObject ? key : KeyObject.from(key);
    },
  };
}
