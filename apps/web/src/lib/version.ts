/**
 * The long-lived-tab version check (OFC-63; DECISIONS N25). A returning visitor
 * already picks up a fresh bundle on the next reload/navigation because the SPA
 * shell is served `no-cache, must-revalidate` (N25). What that does *not* cover is
 * a tab left **open** and never reloaded — it runs the old bundle forever. This
 * module is the minimal fix: the build stamps a `/version.json`, the running tab
 * remembers the id it booted with, and a frugal poll (refocus + a generous
 * interval, backing off when hidden — {@link VersionToast}) offers one calm
 * "refresh to update" toast when the deployed id has moved on. No service worker,
 * no forced reload — the user chooses when.
 */

/** The build id this tab booted with (injected by Vite `define`); "dev" when unset. */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/**
 * Whether the server's reported build id warrants the update toast. Prompt only for
 * a **real** id that **differs** from the one this tab loaded: an absent/empty id (a
 * failed poll, or local dev with no `version.json`) and an equal id are both no-ops,
 * so the toast is one quiet signal and never a false nag.
 */
export function isNewerVersion(loaded: string, fetched: string | null): boolean {
  return typeof fetched === "string" && fetched !== "" && fetched !== loaded;
}

/**
 * Read the deployed build id from `/version.json` (a static, `no-cache` asset the
 * build emits). Best-effort: a network blip, a 404 (dev), or a malformed body all
 * resolve to `null` (no prompt), so a transient failure on the slow links this
 * audience skews toward never surfaces as a spurious toast. Not routed through the
 * app's `fetch` wrappers — it is a public asset, so a 401 is meaningless here and
 * must not trip the session interceptor (OFC-193).
 */
export async function fetchServerVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch("/version.json", { cache: "no-store", signal });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" && body.version !== "" ? body.version : null;
  } catch {
    return null;
  }
}
