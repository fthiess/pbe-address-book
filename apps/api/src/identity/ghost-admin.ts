import { type Profile, formatCanonicalName } from "@pbe/shared";
import { GhostAdminHttp, GhostHttpError } from "./ghost-admin-http.js";
import {
  type GhostCreateResult,
  GhostDuplicateEmailError,
  type GhostLifecycle,
  type GhostMemberDiff,
} from "./ghost-lifecycle.js";

/**
 * The real Ghost Admin-API client behind the {@link GhostLifecycle} seam (Phase
 * 5b-1; DECISIONS N65/N67). It performs the Ghost-first half of every synced Book
 * write — create / update / delete a Ghost member — and **throws on any non-2xx**
 * so the calling endpoint aborts clean (`502`, Book untouched).
 *
 * **Auth (D99).** Ghost Admin auth is a per-request short-lived JWT minted from the
 * integration's `{id}:{secret}` Admin API key: HS256, `kid` = the key id, `aud` =
 * `/admin/`, ~5-minute expiry, signed with the **hex-decoded** secret. The token
 * rides `Authorization: Ghost <jwt>`; `Accept-Version` pins the API version (D99).
 * The key lives in Secret Manager and is **never** committed (memory / N67).
 *
 * **Live-tested against ghost-staging only (D72).** The production Ghost is never a
 * write target until cutover.
 */
export interface GhostAdminConfig {
  /** Admin API base, e.g. `https://staging.pbe400.org/ghost/api/admin` (no trailing slash required). */
  apiUrl: string;
  /** The integration Admin API key `{id}:{secret}` (secret is hex). Secret Manager only. */
  adminApiKey: string;
  /**
   * The id of the newsletter a subscribed member is attached to (Ghost v5 models
   * subscription as a `newsletters[]` relation, not a boolean). **Required** — the
   * constructor throws without it, so a deployment that sets the Admin key but forgets
   * the newsletter id fails fast at startup rather than silently pushing an
   * *unsubscribe* (`[]`) for every enable and inverting members' consent (OFC-219).
   * Confirmed against ghost-staging at bring-up (`GET /newsletters/`) and pinned as
   * config (must-verify, N67).
   */
  newsletterId: string;
  /** The pinned Ghost Admin-API version header (D99); defaults to `v5.0`. */
  acceptVersion?: string;
  /** Injectable `fetch` for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
}

export class GhostAdminLifecycle implements GhostLifecycle {
  private readonly http: GhostAdminHttp;
  private readonly newsletterId: string;

  constructor(config: GhostAdminConfig) {
    // Fail fast without a newsletter id: subscribing needs it, and defaulting to `[]`
    // would silently *unsubscribe* every member whose newsletter consent is enabled
    // (OFC-219). A misconfigured deploy must crash at startup, not invert consent.
    if (!config.newsletterId) {
      throw new Error("GHOST_NEWSLETTER_ID is required to push newsletter subscription state");
    }
    this.http = new GhostAdminHttp({
      apiUrl: config.apiUrl,
      adminApiKey: config.adminApiKey,
      acceptVersion: config.acceptVersion,
      fetchImpl: config.fetchImpl,
    });
    this.newsletterId = config.newsletterId;
  }

  async createMember(profile: Profile): Promise<GhostCreateResult> {
    // A create pushes the full pushed set (all three fields) for a new member.
    const member = this.memberFields({
      email: profile.email,
      name: formatCanonicalName(profile, false),
      allowNewsletterEmail: profile.allowNewsletterEmail,
    });
    // `send_email=false` suppresses Ghost's signup email — the brother simply
    // becomes able to magic-link in (D96).
    let body: unknown;
    try {
      body = await this.http.request("POST", "/members/?send_email=false", {
        members: [member],
      });
    } catch (cause) {
      // Ghost answers a duplicate-email create with `422 ValidationError`. Surface it
      // as a typed collision so the write path can reject with a specific `422` on
      // `email` (OFC-232, Option B) rather than a generic `502` (which would wrongly
      // invite a retry). Every other failure propagates unchanged → `ghost_create_failed`.
      if (cause instanceof GhostHttpError && cause.status === 422) {
        throw new GhostDuplicateEmailError(profile.email ?? "");
      }
      throw cause;
    }
    const id = extractMemberId(body);
    if (!id) {
      throw new Error("Ghost create returned no member id");
    }
    return { ghostMemberId: id };
  }

  async updateMember(profile: Profile, diff: GhostMemberDiff): Promise<void> {
    if (!profile.ghostMemberId) {
      throw new Error("updateMember called without a ghostMemberId");
    }
    const member = this.memberFields(diff);
    try {
      await this.http.request("PUT", `/members/${encodeURIComponent(profile.ghostMemberId)}/`, {
        members: [member],
      });
    } catch (cause) {
      // A member PUT that changes `email` to an address another member already holds is
      // rejected by Ghost with the same `422 ValidationError` a duplicate create gets
      // ("Member already exists…", property `email`) — verified against ghost-staging
      // 2026-07-17 (OFC-276). Surface it as the typed collision `createMember` raises so
      // an email *change* that collides rejects with a `422` on `email` (OFC-232, Option
      // B) rather than a generic `502` that would wrongly invite a retry. Guarded on the
      // diff actually carrying an email: a 422 on a name/newsletter-only update is not a
      // duplicate-email condition and must stay a generic failure. All else propagates.
      if (cause instanceof GhostHttpError && cause.status === 422 && diff.email !== undefined) {
        throw new GhostDuplicateEmailError(diff.email);
      }
      throw cause;
    }
  }

  async deleteMember(profile: Profile): Promise<void> {
    if (!profile.ghostMemberId) {
      throw new Error("deleteMember called without a ghostMemberId");
    }
    await this.http.request("DELETE", `/members/${encodeURIComponent(profile.ghostMemberId)}/`);
  }

  /**
   * Map a Book {@link GhostMemberDiff} to the Ghost Admin member object. **The
   * field-shape must-verify (N67), confirmed against ghost-staging 2026-07-08:**
   *  - `email` / `name` — plain string fields (create + update **verified** end to
   *    end: 201/200 with the values reflected back).
   *  - newsletter subscription is a **`newsletters[]`** relation in Ghost v5, not the
   *    `subscribed` boolean (which is read-only/derived): subscribe =
   *    `[{ id: newsletterId }]`, unsubscribe = `[]`. **Verified** — a create with the
   *    relation returns `subscribed: true`, a `newsletters: []` update returns
   *    `subscribed: false`.
   * The comment-reply notification preference (`enable_comment_notifications`) is
   * **not** pushed: the Admin API neither serializes it back nor honors it on write
   * (a live admin-UI cross-check confirmed no effect; Ghost silently drops it, as it
   * does any unknown field). It was removed from Book entirely rather than shipped as
   * non-functional UI (N66). Only the fields present in the diff are emitted (N65).
   */
  private memberFields(diff: GhostMemberDiff): Record<string, unknown> {
    const member: Record<string, unknown> = {};
    if (diff.email !== undefined) {
      member.email = diff.email;
    }
    if (diff.name !== undefined) {
      member.name = diff.name;
    }
    if (diff.allowNewsletterEmail !== undefined) {
      // `newsletterId` is guaranteed non-empty by the constructor (OFC-219), so
      // `true` always yields a real subscribe payload — never a silent `[]`.
      member.newsletters = diff.allowNewsletterEmail ? [{ id: this.newsletterId }] : [];
    }
    return member;
  }
}

/** Pull `members[0].id` out of a Ghost create/read response, or `undefined`. */
function extractMemberId(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") {
    return undefined;
  }
  const members = (body as { members?: unknown }).members;
  if (!Array.isArray(members) || members.length === 0) {
    return undefined;
  }
  const first = members[0] as { id?: unknown };
  return typeof first.id === "string" ? first.id : undefined;
}
