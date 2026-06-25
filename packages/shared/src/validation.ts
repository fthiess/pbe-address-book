/**
 * The shared client/server validation module (DECISIONS D50): the single place
 * field rules live, imported by both sides so they cannot drift.
 *
 * Phase 0 ships only the contract (the result shape and the entry point) as an
 * importable stub. The real rules — exactly DATABASE-SCHEMA §8, including the
 * Constitution-ID-read-only and alternate-email-disabled-until-primary rules —
 * are implemented in Phase 2.
 */

import type { Profile } from "./types.js";

export interface ValidationIssue {
  /** The offending field's name (never its value — cf. the names-not-values audit rule, D61). */
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/**
 * Validate a (possibly partial) profile edit. Stub for Phase 0: accepts
 * everything. Phase 2 replaces the body with the DATABASE-SCHEMA §8 rules.
 */
export function validateProfile(_input: Partial<Profile>): ValidationResult {
  // TODO(Phase 2): implement DATABASE-SCHEMA §8 rules here (D50).
  return { ok: true, issues: [] };
}
