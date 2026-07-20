import type { BannerSeverity, Profile, Role } from "@pbe/shared";

/**
 * The directory-row shape the SPA consumes from `GET /api/profiles` — one
 * record of the server's per-role bulk projection (apps/api `projection.ts`,
 * the full Phase-2b taxonomy). It is structurally the server's `ProjectedProfile`
 * (D3 — the one shared `Profile` type, the server's only transformation being to
 * *omit* fields the role may not see): `id` is the single guaranteed key, and
 * every other field is present only when both visible to the caller's role and
 * set on the record. The SPA must therefore treat all non-`id` fields as
 * optional — a missing `email`/`address`/`phone` means "not visible or not set,"
 * the projection deliberately collapsing the two so a network inspection cannot
 * tell them apart.
 */
export type DirectoryProfile = Partial<Profile> & Pick<Profile, "id">;

/** `GET /api/profiles` envelope (API-SPEC §3). */
export interface ProfilesResponse {
  profiles: DirectoryProfile[];
  majors: unknown[];
}

/**
 * A single profile as the SPA receives it from `GET /api/profiles/:id` (and the
 * `PATCH` response). Structurally the server's projected record (D3): `id` is the
 * one guaranteed key; for the **owner** the server sends the full self-record, for
 * everyone else the role projection, so the SPA treats all non-`id` fields as
 * optional and reads them defensively (the Profile page, like the Directory,
 * cannot tell "not visible" from "not set").
 */
export type ProfileRecord = Partial<Profile> & Pick<Profile, "id">;

/** `GET /api/me` — the caller's own private state and own full record (D82). */
export interface Me {
  profileId: number;
  /**
   * The **effective** role — the "View as" projection the SPA gates its UI on
   * (N31). Equals {@link realRole} unless impersonating a lower role.
   */
  role: Role;
  /**
   * The immutable real role. The masthead's "View as …" / "Stop viewing" controls
   * key on this, never the (possibly lowered) effective role, so the way back is
   * always available.
   */
  realRole: Role;
  /** Whether a "View as" impersonation is active (`role` ≠ `realRole`). */
  impersonating: boolean;
  stars: number[];
  profile: Profile | null;
  /**
   * The caller's **Ghost member `uuid`** — the Mixpanel `distinct_id` (D137), the
   * same key pbe400.org identifies on, so one brother is one Mixpanel person
   * across the newsletter and the Book.
   *
   * **Optional, and 7a-2's `identify()` must be conditional on it.** The server
   * fetches it from Ghost at sign-in and omits it whenever that lookup failed or
   * found no member, because sign-in is never blocked by an analytics concern. An
   * unidentified session is the correct degraded state; guessing a `distinct_id`
   * is not, since Mixpanel's Simplified ID Merge cannot merge two `$user_id`s.
   */
  ghostMemberUuid?: string;
}

/** `POST /api/auth/start` — the relay redirect to begin the Ghost handshake. */
export interface SignInStart {
  state: string;
  signInUrl: string;
}

/**
 * `GET /api/banner` — the site-wide system banner (D117; API-SPEC §10). `message`
 * and `severity` are present only when `active`; a cleared banner is `{ active:
 * false }`.
 */
export interface BannerState {
  active: boolean;
  message?: string;
  severity?: BannerSeverity;
}
