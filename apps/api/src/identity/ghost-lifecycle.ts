import type { Profile } from "@pbe/shared";

/**
 * The subset of a member's Ghost-pushed fields carried in an **update** diff
 * (DECISIONS D96/N65). Only the fields that actually changed on a given save are
 * present, so a push never re-asserts an unrelated value (in particular it cannot
 * silently re-subscribe a brother who used Ghost's own unsubscribe link). The
 * three pushable fields:
 *
 *  - `email` — the brother's primary email (the auth join key).
 *  - `name`  — the constructed Canonical Name (`James Smyth '84`), sans the rare
 *    `(#5247)` disambiguation suffix.
 *  - `allowNewsletterEmail` — the PBE-News newsletter subscription.
 *
 * Two things a brother has in Ghost are deliberately **not** here — Ghost platform
 * limitations, not choices (DECISIONS N66): photos (the member `avatar_image` is
 * read-only) and the comment-reply notification preference (`enable_comment_
 * notifications` is not settable via the documented Admin API — verified against
 * ghost-staging 2026-07-08). The comment-reply preference was therefore removed
 * from Book entirely rather than shipped as non-functional UI.
 */
export interface GhostMemberDiff {
  email?: string;
  name?: string;
  allowNewsletterEmail?: boolean;
}

/** The result of a Ghost member **create**: the fresh Ghost Admin-API member id. */
export interface GhostCreateResult {
  ghostMemberId: string;
}

/**
 * The Ghost member-lifecycle seam (DECISIONS N41/N65). Every Book write that
 * touches a Ghost-synced field is **Ghost-first-gated**: the Ghost step runs
 * *before* Book mutates its own state and, on failure, **throws** so the endpoint
 * aborts cleanly (HTTP `502`, Book untouched) and the user retries. That ordering
 * and its failure semantics are the hard, testable contract these endpoints share,
 * so they are implemented against this injected interface — exactly as the codebase
 * defers the identity integration behind `IdentityProvider` and the audit sink
 * behind `AuditLog`.
 *
 * Call sites:
 *  - `DELETE /api/profiles/{id}` and de-brother **raise** → {@link deleteMember}.
 *  - de-brother **reverse** → {@link createMember} (its returned id is folded into
 *    the reinstating write — a re-created member gets a *new* id, D96/N65/N67).
 *  - `PATCH /api/profiles/{id}` and `PUT …/deceased` → {@link updateMember} with the
 *    changed-field {@link GhostMemberDiff} (N65).
 *
 * The **real** Ghost Admin-API client is {@link import('./ghost-admin.js').GhostAdminLifecycle}
 * (Phase 5b-1). The injected default is {@link StubGhostLifecycle}: it succeeds and
 * logs, so a deployment without an Admin key configured (and every local/dev run)
 * still exercises the endpoints end-to-end without touching Ghost. Unit tests
 * inject a **failing fake** to prove the abort-clean contract.
 */
export interface GhostLifecycle {
  /**
   * Delete the Ghost member for `profile` (the Ghost-first step of a Book delete
   * or de-brother raise). Resolves on success; **throws** to signal the endpoint
   * must abort cleanly and return `502` with Book unchanged.
   */
  deleteMember(profile: Profile): Promise<void>;
  /**
   * (Re-)create the Ghost member for `profile` (the Ghost-first step of a
   * de-brother **reversal**, D96) and return the **fresh** `ghostMemberId`, which
   * the reinstating write folds in. Resolves on success; **throws** to abort the
   * reinstatement with a `502`, Book unchanged.
   */
  createMember(profile: Profile): Promise<GhostCreateResult>;
  /**
   * Push a changed-field `diff` to the existing Ghost member for `profile`
   * (addressed by `profile.ghostMemberId`), the Ghost-first step of a `PATCH` or
   * `PUT …/deceased` that changed a pushed field (N65). Resolves on success;
   * **throws** so the save fails `502 ghost_update_failed` with Book untouched.
   * The caller guarantees `diff` is non-empty and `profile.ghostMemberId` is set.
   */
  updateMember(profile: Profile, diff: GhostMemberDiff): Promise<void>;
}

/**
 * The default seam: succeed and log, minting a deterministic synthetic id on
 * create. It lets Delete, De-brother, and the update push run their full Book-side
 * logic with the Ghost step a no-op, so an unconfigured deployment (no Admin key)
 * and every local/dev run stay fully functional. It never throws, so the
 * abort-clean branches are reached only under the test failing-fake. The synthetic
 * create id (`stub-member-<id>`) is clearly non-real, keeping fake-data staging
 * profiles internally consistent after a de-brother reversal.
 */
export class StubGhostLifecycle implements GhostLifecycle {
  async deleteMember(profile: Profile): Promise<void> {
    console.log(`ghost-lifecycle(stub): would delete member for profile ${profile.id}`);
  }

  async createMember(profile: Profile): Promise<GhostCreateResult> {
    console.log(`ghost-lifecycle(stub): would create member for profile ${profile.id}`);
    return { ghostMemberId: `stub-member-${profile.id}` };
  }

  async updateMember(profile: Profile, diff: GhostMemberDiff): Promise<void> {
    console.log(
      `ghost-lifecycle(stub): would update member ${profile.ghostMemberId ?? "(none)"} ` +
        `for profile ${profile.id}: ${Object.keys(diff).join(", ")}`,
    );
  }
}
