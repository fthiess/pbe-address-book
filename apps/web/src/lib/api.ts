import type { Profile, Role, ValidationIssue } from "@pbe/shared";
import type { Me, ProfileRecord, ProfilesResponse, SignInStart } from "./types.js";

/**
 * Typed wrappers over Book's REST surface (API-SPEC). Every call is same-origin
 * and credentialed (the session cookie rides automatically), and every path is
 * relative so the same code runs behind the Vite dev proxy and Firebase Hosting's
 * Cloud Run rewrites (D126).
 */

/** Thrown for a non-OK response; carries the status so callers can branch on 401/403. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(code ? `${status} ${code}` : String(status));
    this.name = "ApiError";
  }
}

async function asError(response: Response): Promise<ApiError> {
  let code: string | undefined;
  try {
    code = (await response.json())?.error;
  } catch {
    // non-JSON body — leave code undefined
  }
  return new ApiError(response.status, code);
}

/** The caller's own state + full record. Throws `ApiError(401)` when signed out. */
export async function fetchMe(signal?: AbortSignal): Promise<Me> {
  const response = await fetch("/api/me", { credentials: "same-origin", signal });
  if (!response.ok) {
    throw await asError(response);
  }
  return response.json();
}

/** The bulk directory download (brother-role projection). */
export async function fetchProfiles(signal?: AbortSignal): Promise<ProfilesResponse> {
  const response = await fetch("/api/profiles", { credentials: "same-origin", signal });
  if (!response.ok) {
    throw await asError(response);
  }
  return response.json();
}

/** A single profile plus its concurrency token (the `ETag`), for the Profile page. */
export interface FetchedProfile {
  profile: ProfileRecord;
  /** The `If-Match` token a later PATCH must echo (Firestore `updateTime`, D25). */
  etag: string;
}

/**
 * One brother's record for the Profile page (API-SPEC §3). The owner receives
 * their full self-record, everyone else the role projection; either way the
 * `ETag` is the token an edit must echo. A brother requesting a whole-record-
 * hidden record gets `404` (the directory hide's single-record consequence).
 */
export async function fetchProfile(id: number, signal?: AbortSignal): Promise<FetchedProfile> {
  const response = await fetch(`/api/profiles/${id}`, { credentials: "same-origin", signal });
  if (!response.ok) {
    throw await asError(response);
  }
  return { profile: await response.json(), etag: response.headers.get("ETag") ?? "" };
}

/**
 * The outcome of a profile PATCH (§5.7.9). Success and the two *expected*
 * non-OK paths — the `412` stale-write that drives the reconcile flow and the
 * `422` field-validation rejection — are modelled as data the caller branches on;
 * unexpected statuses (401/404/500) still throw {@link ApiError}. A `403`
 * (a field the role may not write slipped through) is surfaced too, as a guard
 * against a client/server capability drift.
 */
export type PatchOutcome =
  | { status: "ok"; profile: ProfileRecord; etag: string }
  | { status: "stale" }
  | { status: "invalid"; issues: ValidationIssue[] }
  | { status: "forbidden"; fields?: string[] };

/**
 * Save a set of changed fields to one profile (`PATCH /api/profiles/:id`). The
 * `etag` is sent as `If-Match` so a concurrent change is caught as `412` rather
 * than silently clobbered (D25); the patch carries only the fields the user
 * actually changed (the server re-checks authorization, validation, and the
 * verification side-effect).
 */
export async function patchProfile(
  id: number,
  patch: Partial<Profile>,
  etag: string,
): Promise<PatchOutcome> {
  const response = await fetch(`/api/profiles/${id}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "If-Match": etag },
    body: JSON.stringify(patch),
  });
  if (response.ok) {
    return {
      status: "ok",
      profile: await response.json(),
      etag: response.headers.get("ETag") ?? etag,
    };
  }
  if (response.status === 412) {
    return { status: "stale" };
  }
  if (response.status === 422) {
    const body = await response.json().catch(() => ({}));
    return { status: "invalid", issues: (body.issues as ValidationIssue[]) ?? [] };
  }
  if (response.status === 403) {
    const body = await response.json().catch(() => ({}));
    return { status: "forbidden", fields: body.fields as string[] | undefined };
  }
  throw await asError(response);
}

/** Begin the Ghost handshake: mint a nonce and get the relay URL to redirect to. */
export async function startSignIn(): Promise<SignInStart> {
  const response = await fetch("/api/auth/start", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await asError(response);
  }
  return response.json();
}

/** Complete the handshake from `/auth/callback` (the fragment-carried token + state). */
export async function completeSignIn(token: string, state: string): Promise<void> {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, state }),
  });
  if (!response.ok) {
    throw await asError(response);
  }
}

/** Dev-only: mint a role-switchable session without Ghost (D72). */
export async function devSignIn(role: Role): Promise<void> {
  const response = await fetch("/api/dev/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) {
    throw await asError(response);
  }
}

/** Clear the Book session. */
export async function signOut(): Promise<void> {
  await fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" });
}

/**
 * Start "View as" impersonation — step the session's effective role *down* to
 * `role` (N31). The server enforces the step-down on the real role; the caller is
 * expected to reload afterward so the directory re-downloads at the new projection.
 */
export async function impersonate(role: Role): Promise<void> {
  const response = await fetch("/api/me/impersonate", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) {
    throw await asError(response);
  }
}

/** Stop "View as" impersonation — return the session to the real role (N31). */
export async function stopImpersonating(): Promise<void> {
  const response = await fetch("/api/me/impersonate", {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await asError(response);
  }
}

/** Add a brother to the caller's star list (API-SPEC §4); returns the new list. */
export async function addStar(id: number): Promise<number[]> {
  const response = await fetch(`/api/me/stars/${id}`, {
    method: "PUT",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await asError(response);
  }
  return (await response.json()).stars;
}

/** Remove a brother from the caller's star list (API-SPEC §4); returns the new list. */
export async function removeStar(id: number): Promise<number[]> {
  const response = await fetch(`/api/me/stars/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await asError(response);
  }
  return (await response.json()).stars;
}

/**
 * The export-audit ping (API-SPEC §4a; D92). Fire-and-forget — the CSV download
 * has already happened client-side, so a failed ping must never surface to the
 * user; it is swallowed. `scope` is the egress scope, `count` the row count.
 */
export async function notifyExport(scope: "selection" | "view", count: number): Promise<void> {
  try {
    await fetch("/api/exports", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, count }),
    });
  } catch {
    // The audit ping is best-effort; the export itself already succeeded.
  }
}
