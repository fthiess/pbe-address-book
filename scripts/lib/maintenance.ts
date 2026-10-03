/**
 * The decisions behind `infra/maintenance-begin.sh` / `maintenance-end.sh` (D118,
 * reworked by D187 for OFC-334 + OFC-449). Pure: the CLI in `scripts/maintenance.ts`
 * fetches the live channel's release history and hands it here.
 *
 * THE MODEL. Maintenance is two Firebase Hosting releases on the site's `live`
 * channel and nothing else:
 *
 *   begin — deploy `firebase.maintenance.json` (a public directory holding ONLY
 *           `maintenance.html`, so every path rewrites to it), with the release
 *           message {@link MAINTENANCE_RELEASE_MESSAGE}.
 *   end   — re-release the version that was live immediately BEFORE that one,
 *           through the Hosting API (the console's "rollback").
 *
 * Nothing is built and nothing is published from the operator's machine except the
 * one static page, so production comes back on exactly the release it was running
 * (OFC-449: the old `maintenance-off.sh` republished the operator's local
 * `apps/web/dist`, which on production silently replaced the released SPA).
 *
 * STATELESS ON PURPOSE. The pre-maintenance version is read back from the release
 * history rather than from a file written at `begin`, so ending maintenance does
 * not depend on the same machine, checkout or worktree that began it.
 *
 * THE GUARD. Any ordinary Hosting deploy during maintenance — a production release,
 * or on staging any merge to `main` — replaces the maintenance page and so ENDS
 * maintenance by itself. If `end` then re-released the pre-maintenance version it
 * would roll that deploy back. So `end` proceeds only while the newest live release
 * is still the maintenance one, and otherwise refuses and changes nothing.
 */

/** The `-m` message `begin` deploys with; how `end` recognises the maintenance release. */
export const MAINTENANCE_RELEASE_MESSAGE = "book-maintenance-begin";

/** The visible heading of `infra/maintenance-site/maintenance.html` (= restore-support's MAINTENANCE_MARKER). */
export const MAINTENANCE_PAGE_MARKER = "Down for maintenance";

/** The subset of a Hosting `Release` (REST v1beta1) these decisions read. */
export interface HostingRelease {
  name?: string;
  releaseTime: string;
  type?: string;
  message?: string;
  version?: { name: string; status?: string };
}

export type Decision<T> = ({ ok: true } & T) | { ok: false; reason: string };

/** Newest first, by `releaseTime` — the API's list order is observed, not documented. */
export const newestFirst = (releases: readonly HostingRelease[]): HostingRelease[] =>
  [...releases].sort((a, b) => Date.parse(b.releaseTime) - Date.parse(a.releaseTime));

const isMaintenance = (release: HostingRelease): boolean =>
  release.message === MAINTENANCE_RELEASE_MESSAGE;

const describe = (release: HostingRelease): string =>
  `${release.type ?? "release"} at ${release.releaseTime}${release.message ? ` ("${release.message}")` : ""}${release.version ? ` → ${versionId(release.version.name)}` : ""}`;

/** `sites/S/versions/V` → `V`. */
export const versionId = (versionName: string): string =>
  versionName.slice(versionName.lastIndexOf("/") + 1);

/**
 * May maintenance begin? Refuses if it already has (a second `begin` would make the
 * maintenance page the "previous" version that `end` restores), or if the site has
 * never had a release with content to come back to.
 */
export function planBegin(
  releases: readonly HostingRelease[],
): Decision<{ liveVersion: string; liveReleasedAt: string }> {
  const [live] = newestFirst(releases);
  if (!live) {
    return {
      ok: false,
      reason: "the site has no releases at all — there is nothing to come back to.",
    };
  }
  if (isMaintenance(live)) {
    return {
      ok: false,
      reason: `Book is already in maintenance (live release: ${describe(live)}). Run maintenance-end.sh to leave it.`,
    };
  }
  if (!live.version) {
    return {
      ok: false,
      reason: `the live release carries no version (${describe(live)}) — the site is disabled or empty; nothing to come back to.`,
    };
  }
  return { ok: true, liveVersion: live.version.name, liveReleasedAt: live.releaseTime };
}

/**
 * May maintenance end, and onto which version? Proceeds only when the newest
 * release is the maintenance one and the release before it is an ordinary,
 * finalized version — that version is exactly what was live when `begin` ran.
 */
export function planEnd(
  releases: readonly HostingRelease[],
): Decision<{ maintenanceVersion: string; restoreVersion: string; restoreReleasedAt: string }> {
  const [live, previous] = newestFirst(releases);
  if (!live) {
    return { ok: false, reason: "the site has no releases at all." };
  }
  if (!isMaintenance(live)) {
    return {
      ok: false,
      reason: `Book is not in maintenance: the live release is ${describe(live)}. If a deploy ran after maintenance-begin.sh, that deploy already ended maintenance — restoring the pre-maintenance version now would roll it back, so nothing was changed.`,
    };
  }
  if (!live.version) {
    return { ok: false, reason: `the maintenance release carries no version (${describe(live)}).` };
  }
  if (!previous) {
    return {
      ok: false,
      reason:
        "there is no release before the maintenance one — nothing to restore. Deploy normally instead.",
    };
  }
  if (isMaintenance(previous)) {
    return {
      ok: false,
      reason: `the release before the maintenance one is ALSO a maintenance release (${describe(previous)}). Restore by hand from the Firebase console's release history, choosing the last ordinary release.`,
    };
  }
  if (!previous.version || (previous.version.status && previous.version.status !== "FINALIZED")) {
    return {
      ok: false,
      reason: `the release before maintenance has no usable version (${describe(previous)}). Restore by hand from the console.`,
    };
  }
  return {
    ok: true,
    maintenanceVersion: live.version.name,
    restoreVersion: previous.version.name,
    restoreReleasedAt: previous.releaseTime,
  };
}

/** Whether a response body is the maintenance page. */
export const isMaintenancePage = (body: string): boolean => body.includes(MAINTENANCE_PAGE_MARKER);
