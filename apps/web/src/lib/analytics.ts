import type { Role } from "@pbe/shared";

/**
 * The analytics seam (D137/D138, Phase 7a-2) — all of Book's Mixpanel *logic*,
 * with none of Mixpanel's *code*.
 *
 * The real client lives in `analyticsClient.ts`, which imports `mixpanel-browser`
 * and registers itself here at startup. This module deliberately imports nothing
 * from that package, for two reasons:
 *
 *  - `mixpanel-browser` touches `window`/`document` at module scope, and the SPA's
 *    unit tests run under Vitest's **node** environment with no jsdom (see
 *    vitest.config.ts) — a static import would make this module untestable.
 *  - The seam is the same shape as `api.ts`'s `setUnauthorizedHandler`: a test
 *    injects a two-line fake and asserts on the calls.
 *
 * **Everything sent from here is subject to P6**: no event may carry *whom* a
 * brother viewed, starred or searched for. That is why {@link trackPageView} takes
 * a route *pattern* and never a URL, and why {@link trackSearchPerformed} takes a
 * result count and never the query text.
 */

/** The slice of the Mixpanel client Book actually uses. */
export interface AnalyticsClient {
  identify(distinctId: string): void;
  peopleSet(properties: Record<string, unknown>): void;
  track(event: string, properties?: Record<string, unknown>): void;
  reset(): void;
}

let client: AnalyticsClient | null = null;

/**
 * Register (or clear) the backing client. Called once at startup by
 * `analyticsClient.ts` when a token is configured, and by tests. Until it is
 * called every function here is a no-op — which is exactly the state of a local
 * dev build, a CI/e2e build, and any build with no `BOOK_MIXPANEL_TOKEN`.
 */
export function setAnalyticsClient(next: AnalyticsClient | null): void {
  client = next;
}

/**
 * The uuid we last called `identify()` with, so a re-render or a `/api/me`
 * refresh doesn't re-identify the same person on every pass. Cleared by
 * {@link resetIdentity}.
 */
let identifiedAs: string | null = null;

/** Test-only: forget the identify latch. */
export function __resetAnalyticsStateForTests(): void {
  identifiedAs = null;
}

/**
 * Identify the signed-in brother to Mixpanel.
 *
 * **Conditional on the uuid being present, with no fallback key** — this is the
 * one rule in 7a-2 that is expensive to get wrong. The project runs Mixpanel's
 * *Simplified* ID Merge, under which two `$user_id`s can never be merged (N123):
 * identifying on some other key "just to have one" would mint a second, permanently
 * separate person for a brother the newsletter already identifies by uuid, with no
 * repair path. A uuid-less session therefore stays **anonymous**, which is
 * recoverable — Simplified ID Merge folds a device's prior anonymous events into
 * the user retroactively once a real `identify()` lands.
 *
 * Constitution ID and role ride along as **user properties** per D88; `name` is
 * deliberately not sent (D88 dropped it, and it stays dropped).
 */
export function identifyMember(
  ghostMemberUuid: string | undefined,
  profileId: number,
  role: Role,
): void {
  if (!client || !ghostMemberUuid || identifiedAs === ghostMemberUuid) {
    return;
  }
  identifiedAs = ghostMemberUuid;
  client.identify(ghostMemberUuid);
  client.peopleSet({ "Constitution ID": profileId, Role: role });
}

/**
 * Drop the Mixpanel identity on sign-out.
 *
 * **Unconditional — it must run even for a session that was never identified.**
 * `reset()` regenerates the anonymous device id, and that is the point: on a
 * shared or family machine, leaving the old device id in place would let the
 * *next* person's `identify()` retroactively absorb the previous brother's
 * anonymous events into their own timeline. Under Simplified ID Merge that
 * misattribution is unrecoverable, so the uuid-less case is the one that needs
 * this most, not least.
 */
export function resetIdentity(): void {
  identifiedAs = null;
  client?.reset();
}

/**
 * A page view, keyed on the **route pattern** — `/brother/:id`, never
 * `/brother/5247`.
 *
 * A raw URL would put a specific brother's record id into the event stream, which
 * P6 forbids (no viewed/starred/searched-whom). The rule earns its keep twice
 * over: `/auth/callback` carries a one-time Ghost token in its query string, and
 * Mixpanel's own `track_pageview` option — which records the URL — is left at its
 * default of `false` for exactly this reason.
 */
export function trackPageView(routePattern: string): void {
  client?.track("Page View", { "Route Pattern": routePattern });
}

/**
 * Bucket a result count. Buckets rather than the raw number because a count of
 * exactly 1, attached to an identified brother at a known instant, is a sharper
 * signal about *who was looked up* than this event needs in order to answer the
 * question it exists to answer ("does search find people, or come back empty?").
 */
export function resultBucket(count: number): string {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 10) return "2-10";
  return "11+";
}

/**
 * The walking skeleton's one real feature event (D138) — proof that non-page-view
 * events work end to end.
 *
 * Carries **no query text and no result ids**: what a brother typed, and whom it
 * matched, are precisely what P6 keeps out of the event stream. Only the shape of
 * the outcome travels.
 */
export function trackSearchPerformed(resultCount: number): void {
  client?.track("Search Performed", { "Result Count": resultBucket(resultCount) });
}
