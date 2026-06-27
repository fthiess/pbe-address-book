import type { Profile, Role } from "@pbe/shared";

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

/** `GET /api/me` — the caller's own private state and own full record (D82). */
export interface Me {
  profileId: number;
  role: Role;
  stars: number[];
  profile: Profile | null;
}

/** `POST /api/auth/start` — the relay redirect to begin the Ghost handshake. */
export interface SignInStart {
  state: string;
  signInUrl: string;
}
