import type { Profile } from "@pbe/shared";

/**
 * The Ghost member-lifecycle seam (DECISIONS N41). `DELETE /api/profiles/{id}`
 * and `PUT /api/profiles/{id}/debrothered` are specified **Ghost-first** (D96/
 * D98/D115): delete or re-create the Ghost member *before* Book mutates its own
 * state, and abort cleanly (HTTP `502`, Book untouched) if the Ghost step fails.
 * That ordering and its failure semantics are the hard, testable part of these
 * endpoints, so 4c-2 implements them against this injected interface — exactly as
 * the codebase already defers the identity integration behind `IdentityProvider`
 * and the audit sink behind `AuditLog`.
 *
 * The **real** Ghost Admin-API client is Phase 5 (the Ghost write path). Until
 * then the injected default is {@link StubGhostLifecycle}: it succeeds and logs,
 * so the endpoints are exercised end-to-end without touching Ghost. Unit tests
 * inject a **failing fake** to prove the abort-clean contract — a thrown error
 * here must leave Firestore, GCS, and the cache untouched. Phase 5 swaps in the
 * real client without changing either endpoint.
 */
export interface GhostLifecycle {
  /**
   * Delete the Ghost member for `profile` (the Ghost-first step of a Book delete
   * or de-brother). Resolves on success; **throws** to signal the endpoint must
   * abort cleanly and return `502` with `Book` unchanged.
   */
  deleteMember(profile: Profile): Promise<void>;
  /**
   * (Re-)create the Ghost member for `profile` (the Ghost-first step of a
   * de-brother **reversal**, D96). Resolves on success; **throws** to abort the
   * reinstatement with a `502`, `Book` unchanged.
   */
  createMember(profile: Profile): Promise<void>;
}

/**
 * The 4c-2 default: succeed and log. The real Ghost Admin-API client lands in
 * Phase 5; this stub lets Delete and De-brother run their full Book-side logic
 * (reference scrub, snapshot/restore, cache update) with the Ghost-first step a
 * no-op. It never throws, so the abort-clean branches are reached only under the
 * test failing-fake.
 */
export class StubGhostLifecycle implements GhostLifecycle {
  async deleteMember(profile: Profile): Promise<void> {
    console.log(`ghost-lifecycle: would delete member for profile ${profile.id}`);
  }

  async createMember(profile: Profile): Promise<void> {
    console.log(`ghost-lifecycle: would create member for profile ${profile.id}`);
  }
}
