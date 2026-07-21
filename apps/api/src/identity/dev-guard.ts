/**
 * D108 lockout layers 2 and 4 for the `DevIdentityProvider`.
 *
 * Layer 1 (the load-bearing one) is structural: the dev provider is never
 * imported from the production entry point (`index.ts`), so the production
 * bundle does not contain its code at all. Layer 3 is the CI assertion that
 * proves that absence. The two layers implemented here are the defense in
 * depth that makes a regression loud rather than silent:
 *
 *   Layer 2 — a runtime env gate: the dev provider refuses to construct under
 *             a production-like configuration.
 *   Layer 4 — a startup alert: that refusal is logged loudly so it is
 *             observable, not silent.
 */

import { diagnosticLog } from "../audit/diagnostic-log.js";

const PROD_ENVIRONMENT_NAMES = new Set(["production", "prod"]);

/** True if the environment looks like production (NODE_ENV or BOOK_ENV). */
export function isProdLikeConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();
  const bookEnv = (env.BOOK_ENV ?? "").trim().toLowerCase();
  return PROD_ENVIRONMENT_NAMES.has(nodeEnv) || PROD_ENVIRONMENT_NAMES.has(bookEnv);
}

/**
 * Refuse — loudly — to allow the dev provider under a production-like config.
 * Throws so construction cannot proceed.
 */
export function assertDevProviderAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (isProdLikeConfig(env)) {
    const message =
      "[SECURITY ALERT] DevIdentityProvider load attempted under a production-like " +
      "configuration. Refusing to start. This provider must never run in or near " +
      "production (DECISIONS D72/D108).";
    // Layer 4: make it observable — a structured ERROR on the diagnostic stream
    // (the alert text is a constant, no PII).
    diagnosticLog.error(message);
    // Layer 2: make it impossible.
    throw new Error(message);
  }
}
