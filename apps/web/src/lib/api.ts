import type { Role } from "@pbe/shared";
import type { Me, ProfilesResponse, SignInStart } from "./types.js";

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
