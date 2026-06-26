import type { Profile, Role } from "@pbe/shared";

/**
 * The directory-row shape the SPA consumes from `GET /api/profiles` — the
 * server's brother-role projection (apps/api `projection.ts`). It is a subset of
 * `Profile`: the privacy/consent flags are stripped server-side, and `email`
 * is present only when the owner consented to directory email (D45). The full
 * per-role projections arrive in Phase 2; the walking skeleton renders this one.
 */
export type DirectoryProfile = Omit<Profile, "email" | "unlisted" | "allowDirectoryEmail"> & {
  email?: string;
};

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
