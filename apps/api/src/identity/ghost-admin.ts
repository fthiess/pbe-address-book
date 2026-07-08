import { type Profile, formatCanonicalName } from "@pbe/shared";
import { SignJWT } from "jose";
import type { GhostCreateResult, GhostLifecycle, GhostMemberDiff } from "./ghost-lifecycle.js";

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
   * subscription as a `newsletters[]` relation, not a boolean). Required to *enable*
   * the newsletter; unsubscribe (`[]`) needs no id. Confirmed against ghost-staging
   * at bring-up (`GET /newsletters/`) and pinned as config (must-verify, N67).
   */
  newsletterId?: string;
  /** The pinned Ghost Admin-API version header (D99); defaults to `v5.0`. */
  acceptVersion?: string;
  /** Injectable `fetch` for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
}

export class GhostAdminLifecycle implements GhostLifecycle {
  private readonly apiUrl: string;
  private readonly keyId: string;
  private readonly secret: Buffer;
  private readonly newsletterId?: string;
  private readonly acceptVersion: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GhostAdminConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, "");
    const [keyId, secret] = config.adminApiKey.split(":");
    if (!keyId || !secret) {
      throw new Error("GHOST_ADMIN_API_KEY must be in `{id}:{secret}` form");
    }
    this.keyId = keyId;
    this.secret = Buffer.from(secret, "hex");
    this.newsletterId = config.newsletterId;
    this.acceptVersion = config.acceptVersion ?? "v5.0";
    this.fetchImpl = config.fetchImpl ?? fetch;
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
    const body = await this.request("POST", "/members/?send_email=false", { members: [member] });
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
    await this.request("PUT", `/members/${encodeURIComponent(profile.ghostMemberId)}/`, {
      members: [member],
    });
  }

  async deleteMember(profile: Profile): Promise<void> {
    if (!profile.ghostMemberId) {
      throw new Error("deleteMember called without a ghostMemberId");
    }
    await this.request("DELETE", `/members/${encodeURIComponent(profile.ghostMemberId)}/`);
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
      member.newsletters =
        diff.allowNewsletterEmail && this.newsletterId ? [{ id: this.newsletterId }] : [];
    }
    return member;
  }

  /** Mint a fresh short-lived Ghost Admin JWT (HS256 over the hex secret; D99). */
  private async signToken(): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid: this.keyId })
      .setIssuedAt()
      .setExpirationTime("5m")
      .setAudience("/admin/")
      .sign(this.secret);
  }

  /**
   * Issue one authenticated Admin-API request, returning the parsed JSON body (or
   * `undefined` for an empty response, e.g. a `DELETE`). Any non-2xx **throws** with
   * Ghost's error message when present, so the Ghost-first callers abort clean. The
   * thrown message is logged server-side only — it never reaches a Book client
   * (the endpoints surface a generic `ghost_update_failed`/`ghost_*_failed`).
   */
  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const token = await this.signToken();
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Ghost ${token}`,
        "Accept-Version": this.acceptVersion,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`Ghost ${method} ${path} → ${response.status}: ${await safeError(response)}`);
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
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

/** Best-effort extraction of Ghost's error message for the thrown (server-only) log. */
async function safeError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    const json = JSON.parse(text) as { errors?: { message?: string }[] };
    return json.errors?.[0]?.message ?? text.slice(0, 200);
  } catch {
    return response.statusText;
  }
}
