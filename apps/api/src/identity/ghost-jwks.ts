import { type JWTVerifyGetKey, createRemoteJWKSet } from "jose";

/**
 * Build the key resolver for verifying Ghost-issued JWTs against Ghost's
 * published JWKS (`pbe400.org/members/.well-known/jwks.json`; ENGINEERING-DESIGN
 * §2.1/§2.7, DECISIONS D87).
 *
 * `createRemoteJWKSet` caches the key set in memory, refreshes it on a cooldown,
 * and refetches on an unknown `kid` (single-flighted, so a flood of unknown-kid
 * tokens cannot stampede Ghost), which is what lets Ghost rotate keys without
 * breaking verification.
 *
 * The provider (`ghost-provider.ts`) pins the algorithm to Ghost's asymmetric
 * `RS256` at verify time, which is what forecloses the `alg:none` and
 * symmetric-key forges (D104) — the key resolver only supplies keys.
 *
 * Deferred hardening (D87): persisting/seeding the JWKS *across cold starts* so a
 * freshly cold-started instance can verify against last-known-good keys during a
 * brief Ghost/JWKS outage. The in-memory set here re-fetches on the first verify
 * after a cold start; the cross-start seed is a Phase-2+ hardening item.
 */
export function createGhostJwks(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl), {
    // Bound how often an unknown-kid miss may trigger a refetch (single-flight + cap).
    cooldownDuration: 30_000,
  });
}
