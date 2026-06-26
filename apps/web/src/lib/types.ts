import type { Profile, Role } from "@pbe/shared";

/**
 * The directory-row shape the SPA consumes from `GET /api/profiles` — the
 * server's brother-role projection (apps/api `projection.ts`, Phase 2a subset).
 * It carries the public fields plus the contact `email` only when the owner's
 * `privacy.shareEmail` toggle is on (D45). The full per-role projections arrive
 * in Phase 2b; this mirrors the brother view the skeleton renders.
 */
export type DirectoryProfile = Pick<
  Profile,
  | "id"
  | "firstName"
  | "middleName"
  | "lastName"
  | "fullLegalName"
  | "mugName"
  | "classYear"
  | "employerName"
  | "jobTitle"
  | "majors"
  | "links"
  | "bigBrotherId"
  | "deceased"
  | "hasHeadshot"
  | "headshotVersion"
> & {
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
