import type {
  AdminBugReport,
  BounceReport,
  BugReportClientContext,
  GhostAuditReport,
  Profile,
  Role,
  ValidationIssue,
} from "@pbe/shared";
import type { BannerState, Me, ProfileRecord, ProfilesResponse, SignInStart } from "./types.js";
import { saveBlob } from "./utils.js";

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
  | { status: "forbidden"; fields?: string[] }
  /** `428` — the record loaded without a usable concurrency token; the page must
   * be reloaded before a conditional write can be made (OFC-115). */
  | { status: "reload" };

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
  // 428 precondition_required: the load produced no `If-Match` token, so no
  // conditional write is possible. Surface a reload prompt rather than the opaque
  // generic error the fall-through would raise (OFC-115).
  if (response.status === 428) {
    return { status: "reload" };
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

/**
 * The outcome of a profile create (`POST /api/profiles`, OFC-201). Success and the
 * two *expected* non-OK paths — the `409` Constitution-id conflict and the `422`
 * field-validation rejection — are modelled as data the Add-Brother form branches
 * on; a `403` (a non-admin, or a client/server capability drift) is surfaced too;
 * other statuses throw {@link ApiError}.
 */
export type CreateOutcome =
  | { status: "ok"; profile: ProfileRecord; etag: string }
  | { status: "conflict" }
  | { status: "invalid"; issues: ValidationIssue[] }
  | { status: "forbidden" };

/**
 * Create a brother (`POST /api/profiles`, admin-only — OFC-201). The whole record
 * is sent (the admin-supplied Constitution `id` plus the entered fields); the
 * server sets the housekeeping and status fields and mints the Ghost member. The
 * response is the created, projected record with its initial `ETag`.
 */
export async function createProfile(profile: Partial<Profile>): Promise<CreateOutcome> {
  const response = await fetch("/api/profiles", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (response.ok) {
    return {
      status: "ok",
      profile: await response.json(),
      etag: response.headers.get("ETag") ?? "",
    };
  }
  if (response.status === 409) {
    return { status: "conflict" };
  }
  if (response.status === 422) {
    const body = await response.json().catch(() => ({}));
    return { status: "invalid", issues: (body.issues as ValidationIssue[]) ?? [] };
  }
  if (response.status === 403) {
    return { status: "forbidden" };
  }
  throw await asError(response);
}

/**
 * The result of a headshot write (`PUT`/`DELETE …/headshot`, API-SPEC §6). The
 * write advances the profile document, so it returns a **fresh `ETag`** the
 * container must apply in place of its held token — otherwise the *next* text edit
 * would echo a stale `If-Match` and spuriously `412` (N42).
 */
export interface HeadshotWriteResult {
  hasHeadshot: boolean;
  headshotVersion?: string;
  etag: string;
}

async function headshotResult(response: Response): Promise<HeadshotWriteResult> {
  if (!response.ok) {
    throw await asError(response);
  }
  const body = await response.json();
  return {
    hasHeadshot: body.hasHeadshot === true,
    headshotVersion: body.headshotVersion,
    etag: response.headers.get("ETag") ?? "",
  };
}

/**
 * Upload (create-or-replace) a brother's headshot (`PUT /api/profiles/:id/headshot`).
 * The `blob` is the client-cropped, ≤1024² JPEG (EXIF stripped by the canvas
 * re-encode — N42); the server re-encodes to the stored 512²/96² WEBP. The body
 * is the raw image bytes, not multipart.
 */
export async function putHeadshot(id: number, blob: Blob): Promise<HeadshotWriteResult> {
  const response = await fetch(`/api/profiles/${id}/headshot`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });
  return headshotResult(response);
}

/** Remove a brother's headshot (`DELETE /api/profiles/:id/headshot`). */
export async function deleteHeadshot(id: number): Promise<HeadshotWriteResult> {
  const response = await fetch(`/api/profiles/${id}/headshot`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  return headshotResult(response);
}

/**
 * The five D122 deceased facts a mark-deceased write carries (API-SPEC §3, N40).
 * All optional; the shared validator enforces the `deathYear`⊕`dateOfDeath`
 * exclusion and the year ranges.
 */
export interface DeceasedFacts {
  dateOfDeath?: string;
  deathYear?: number;
  birthYear?: number;
  obituaryUrl?: string;
  inMemoriamUrl?: string;
}

/** A privileged status write that returns the updated record + fresh ETag (deceased/de-brother). */
export type StatusWriteOutcome =
  | { status: "ok"; profile: ProfileRecord; etag: string }
  | { status: "invalid"; issues: ValidationIssue[] }
  /** `502` — the Ghost-first lifecycle step failed; Book is unchanged (N41). */
  | { status: "ghost_failed" };

/**
 * Confirm a record is freshly verified (`POST /api/profiles/:id/verify`, API-SPEC
 * §3; D28/D48). Server-sets the date + verifier and returns a fresh `ETag` the
 * container applies. A no-op on a deceased record (verification frozen).
 */
export async function verifyProfile(
  id: number,
): Promise<{ lastVerifiedDate?: string; verifiedBy?: number; etag: string }> {
  const response = await fetch(`/api/profiles/${id}/verify`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await asError(response);
  }
  const body = await response.json();
  return {
    lastVerifiedDate: body.lastVerifiedDate,
    verifiedBy: body.verifiedBy,
    etag: response.headers.get("ETag") ?? "",
  };
}

/**
 * Raise, edit, or clear a brother's deceased state (`PUT /api/profiles/:id/deceased`,
 * API-SPEC §3; N40). Pass `deceased: true` with the D122 facts to mark/edit, or
 * `false` to reverse. Returns the updated record + fresh ETag, or the `422`
 * validation issues.
 */
export async function putDeceased(
  id: number,
  deceased: boolean,
  facts: DeceasedFacts = {},
): Promise<StatusWriteOutcome> {
  const response = await fetch(`/api/profiles/${id}/deceased`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deceased, ...facts }),
  });
  if (response.ok) {
    return {
      status: "ok",
      profile: await response.json(),
      etag: response.headers.get("ETag") ?? "",
    };
  }
  if (response.status === 422) {
    const body = await response.json().catch(() => ({}));
    return { status: "invalid", issues: (body.issues as ValidationIssue[]) ?? [] };
  }
  throw await asError(response);
}

/**
 * Raise or reverse de-brothering (`PUT /api/profiles/:id/debrothered`, API-SPEC §3;
 * D115/N41). Ghost-first: a `502` means the Ghost step failed and Book is
 * unchanged — surfaced as `ghost_failed` so the UI can say "try again" rather than
 * throw.
 */
export async function putDebrothered(
  id: number,
  debrothered: boolean,
): Promise<StatusWriteOutcome> {
  const response = await fetch(`/api/profiles/${id}/debrothered`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ debrothered }),
  });
  if (response.ok) {
    return {
      status: "ok",
      profile: await response.json(),
      etag: response.headers.get("ETag") ?? "",
    };
  }
  if (response.status === 502) {
    return { status: "ghost_failed" };
  }
  throw await asError(response);
}

/**
 * Delete a brother (`DELETE /api/profiles/:id`, admin only; API-SPEC §4). Ghost-first.
 * A `409 last_admin` — deleting the only remaining admin is blocked (D106) — is
 * surfaced as data so the UI can explain it rather than throw.
 */
export async function deleteProfile(
  id: number,
): Promise<{ status: "ok" } | { status: "ghost_failed" } | { status: "last_admin" }> {
  const response = await fetch(`/api/profiles/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (response.ok) {
    return { status: "ok" };
  }
  if (response.status === 502) {
    return { status: "ghost_failed" };
  }
  if (response.status === 409) {
    return { status: "last_admin" };
  }
  throw await asError(response);
}

/**
 * Read a brother's current role (`GET /api/users/:id/role`, admin only; API-SPEC
 * §5) — so the admin Role control can show which role is active. `brother` for a
 * never-signed-in brother.
 */
export async function getUserRole(id: number): Promise<Role> {
  const response = await fetch(`/api/users/${id}/role`, { credentials: "same-origin" });
  if (!response.ok) {
    throw await asError(response);
  }
  return (await response.json()).role;
}

/**
 * Change a brother's role (`PUT /api/users/:id/role`, admin only; API-SPEC §5;
 * D51/N44). A `409 last_admin` — the only remaining admin cannot be demoted — is
 * surfaced as data so the UI can explain it rather than throw.
 */
export async function changeRole(
  id: number,
  role: Role,
): Promise<{ status: "ok"; role: Role } | { status: "last_admin" }> {
  const response = await fetch(`/api/users/${id}/role`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (response.ok) {
    return { status: "ok", role: (await response.json()).role };
  }
  if (response.status === 409) {
    return { status: "last_admin" };
  }
  throw await asError(response);
}

/**
 * The current site-wide system banner (`GET /api/banner`, any authenticated user;
 * D117). Fetched on load and rendered across the top of every page.
 */
export async function fetchBanner(signal?: AbortSignal): Promise<BannerState> {
  const response = await fetch("/api/banner", { credentials: "same-origin", signal });
  if (!response.ok) {
    throw await asError(response);
  }
  return response.json();
}

/**
 * Set or clear the system banner (`PUT /api/admin/banner`, admin only; D117).
 * `active: false` clears it. Returns the stored banner. Throws {@link ApiError} on
 * a non-OK response (the caller pre-validates a non-empty message, so a `422` is a
 * guard against client/server drift).
 */
export async function saveBanner(input: {
  active: boolean;
  message?: string;
  severity?: "info" | "warning";
}): Promise<BannerState> {
  const response = await fetch("/api/admin/banner", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await asError(response);
  }
  return response.json();
}

/** Pull the download filename out of a `Content-Disposition` header, if present. */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const match = /filename="?([^"]+)"?/.exec(header);
  return match?.[1] ?? null;
}

/**
 * Download a full database backup (`GET /api/admin/backup`, admin only; D63). The
 * JSON is fetched credentialed, then saved to the user's disk via a transient
 * object-URL anchor (so errors surface as an {@link ApiError} the caller can report,
 * rather than a broken navigation). The admin is the custodian of the archive (D101).
 */
export async function downloadBackup(): Promise<void> {
  const response = await fetch("/api/admin/backup", { credentials: "same-origin" });
  if (!response.ok) {
    throw await asError(response);
  }
  const blob = await response.blob();
  const filename =
    filenameFromDisposition(response.headers.get("Content-Disposition")) ?? "book-backup.json";
  saveBlob(blob, filename);
}

/**
 * Run the Book/Ghost alignment audit and return its discrepancy report (`GET
 * /api/admin/ghost-audit`, admin only; API-SPEC §7). Read-only into Book — it
 * reports differences and changes nothing (the 5b-2 amendment to D103). The caller
 * formats it to a Markdown download; nothing is rendered in the UI.
 */
export async function fetchGhostAudit(): Promise<GhostAuditReport> {
  const response = await fetch("/api/admin/ghost-audit", { credentials: "same-origin" });
  if (!response.ok) {
    throw await asError(response);
  }
  return (await response.json()) as GhostAuditReport;
}

/**
 * Run the email-bounce report and return its per-brother aggregates (`GET
 * /api/admin/bounce-report`, admin only; D120). The caller formats it to a CSV
 * download; nothing is rendered in the UI.
 */
export async function fetchBounceReport(): Promise<BounceReport> {
  const response = await fetch("/api/admin/bounce-report", { credentials: "same-origin" });
  if (!response.ok) {
    throw await asError(response);
  }
  return (await response.json()) as BounceReport;
}

/** The fields the SPA sends when filing a bug report (`POST /api/bug-report`, D121). */
export interface BugReportInput {
  page: string;
  url: string;
  description: string;
  clientContext?: BugReportClientContext;
}

/**
 * File a bug report (`POST /api/bug-report`, any authenticated user; D121). Book
 * only *receives* the report (no email, no tracker integration — a triage-and-clear
 * surface); an admin later views and clears it. A `429` (the tight anti-flood rate
 * limit) is surfaced as data so the dialog can ask the user to wait rather than
 * throw; other non-OK statuses throw {@link ApiError}.
 */
export async function fileBugReport(
  input: BugReportInput,
): Promise<{ status: "ok" } | { status: "rate_limited" }> {
  const response = await fetch("/api/bug-report", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.ok) {
    return { status: "ok" };
  }
  if (response.status === 429) {
    return { status: "rate_limited" };
  }
  throw await asError(response);
}

/**
 * The bug-report review queue (`GET /api/admin/bug-reports`, admin only; D121),
 * newest first, each enriched server-side with the submitter's canonical name.
 */
export async function fetchBugReports(signal?: AbortSignal): Promise<AdminBugReport[]> {
  const response = await fetch("/api/admin/bug-reports", { credentials: "same-origin", signal });
  if (!response.ok) {
    throw await asError(response);
  }
  return (await response.json()).reports;
}

/**
 * Mark reports as seen — the one-way `new → reviewed` unread marker
 * (`POST /api/admin/bug-reports/mark-reviewed`, admin only; D121). Fired after the
 * queue renders, so it is best-effort: a failure just leaves the NEW badges for
 * next time and must never disrupt the view, so it is swallowed.
 */
export async function markBugReportsReviewed(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  try {
    await fetch("/api/admin/bug-reports/mark-reviewed", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  } catch {
    // Best-effort unread marker; the queue already rendered correctly.
  }
}

/** Delete a bug report (`DELETE /api/admin/bug-reports/:id`, admin only; D121) — the terminal act. */
export async function deleteBugReport(id: string): Promise<void> {
  const response = await fetch(`/api/admin/bug-reports/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await asError(response);
  }
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
