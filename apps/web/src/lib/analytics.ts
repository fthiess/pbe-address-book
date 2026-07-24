import type { Role } from "@pbe/shared";
import {
  type EventName,
  type EventProperties,
  type ExportScope,
  FILTER_DIMENSIONS,
  type FieldGroup,
  type FilterDimensionKey,
  resultBucket,
  rowCountBucket,
} from "./events.js";

/**
 * The analytics seam (D137/D138, Phase 7a-2; taxonomy fleshed out in 7a-4, D145) —
 * all of Book's Mixpanel *logic*, with none of Mixpanel's *code*.
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
 *
 * ⚠ **That covers only the properties this module authors.** Mixpanel attaches its
 * own to every event — `$current_url` among them — so P6 compliance depends
 * equally on `BLOCKED_PROPERTIES` in `analyticsConfig.ts`. The first draft of this
 * feature got the app half right, claimed that settled the matter, and shipped the
 * record id and the search query anyway (N125). Keeping events clean is a property
 * of the app code **and** the library config together; neither alone is sufficient.
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
 * The one place an event reaches the client, typed against the {@link EventProperties}
 * catalog in `events.ts`. Every wrapper below funnels through here, so a wrong event
 * name or a property the registry doesn't sanction is a **compile error** — the
 * typed guardrail OFC-296 asked the registry to provide. Inert until a client
 * registers (a token-less dev/CI/e2e build), exactly like the rest of this module.
 */
function emit<E extends EventName>(event: E, properties: EventProperties[E]): void {
  client?.track(event, properties);
}

/**
 * A page view, keyed on the **route pattern** — `/brother/:id`, never
 * `/brother/5247`.
 *
 * A raw URL would put a specific brother's record id into the event stream, which
 * P6 forbids (no viewed/starred/searched-whom).
 *
 * This is necessary but **not sufficient** on its own: Mixpanel's own
 * `track_pageview` is disabled in `analyticsConfig.ts` so it can't fire a
 * URL-bearing pageview of its own, and `BLOCKED_PROPERTIES` strips the
 * `$current_url` the library would otherwise staple onto this very event.
 */
export function trackPageView(routePattern: string): void {
  emit("Page View", { "Route Pattern": routePattern });
}

/**
 * A completed **fresh** sign-in (7a-4) — the funnel end the 7a-2 skeleton left open,
 * and the only way to measure *active* members against the ~700 living brothers.
 * Fired once per real sign-in at the OAuth callback, not on every authenticated
 * mount. Role and Constitution ID already ride as user properties (D88), so it
 * needs none of its own.
 */
export function trackSignedIn(): void {
  emit("Signed In", {});
}

/**
 * A brother record was opened (7a-4; Forrest's OFC-296 note). `own` says whether a
 * brother is looking at his *own* record or someone else's — never *whose*, so the
 * "is the directory used to look people up?" question is answered without recording
 * a viewed identity (P6). The record id sits in the URL (`/brother/5247`) and is
 * kept out of the event by `BLOCKED_PROPERTIES` stripping `$current_url`.
 */
export function trackProfileViewed(own: boolean): void {
  emit("Profile Viewed", { Own: own });
}

/**
 * A profile save that fully succeeded (7a-4) — the highest-value product question:
 * do brothers actually maintain their own records? Reports the coarse
 * {@link FieldGroup}s that changed and whether it was the brother's own record or a
 * staff edit; **never a field value** (P6). `groups` comes from
 * {@link import("./events.js").fieldGroupsChanged} over the save's patch keys.
 */
export function trackProfileSaved(groups: FieldGroup[], own: boolean): void {
  emit("Profile Saved", { "Field Groups": groups, Own: own });
}

/**
 * A privacy/consent switch flipped (7a-4) — the toggle's registry key and its new
 * state. A brother's own choice about his own data, so no P6 problem; directly feeds
 * the year-old defaults debate (D45 → D89 → D93) that has run on first principles
 * with zero data on what brothers actually choose.
 */
export function trackConsentToggleChanged(toggle: string, enabled: boolean): void {
  emit("Consent Toggle Changed", { Toggle: toggle, Enabled: enabled });
}

/**
 * A brother was starred (7a-4; Forrest's OFC-296 note). **No id, no name** — that a
 * star happened is the signal; *whom* it was is precisely what P6 keeps out. The
 * event fires on the optimistic flip (the intent), which may later revert on a
 * failed write — the rare over-count is worth not depending on the round-trip.
 */
export function trackBrotherStarred(): void {
  emit("Brother Starred", {});
}

/** A brother was un-starred (7a-4) — the complement of {@link trackBrotherStarred};
 *  id-less for the same P6 reason. */
export function trackBrotherUnstarred(): void {
  emit("Brother Un-starred", {});
}

/**
 * The Directory's settled name search (D138's proof-of-life event, extended in 7a-4).
 *
 * Carries **no query text and no result ids**: what a brother typed, and whom it
 * matched, are precisely what P6 keeps out of the event stream. Only the shape of
 * the outcome travels — a bucketed count, and `afterEmpty`: whether this search
 * immediately followed one that returned nothing. That distinguishes "the search is
 * broken" (empty, gives up) from "he isn't in the book" (empty, refines, finds),
 * which is the more actionable finding (OFC-296 #8, done as a property rather than a
 * second event).
 *
 * ⚠ The Directory mirrors its search box into the URL as `?q=` (D31/N15), so the
 * query text *does* sit in `window.location.href` while this fires. It is kept out
 * of the payload by `BLOCKED_PROPERTIES` stripping `$current_url` — omitting it from
 * the call is only half the job (N125).
 *
 * `resultCount` is the **name-search match count**, not the count of rows on screen:
 * the filters, the starred-only toggle and the deceased default narrow the view
 * further (D36/D38/D39), and folding those in would report "search found nothing"
 * for a search that found forty brothers the filters then hid.
 */
export function trackSearchPerformed(resultCount: number, afterEmpty: boolean): void {
  emit("Search Performed", {
    "Result Count": resultBucket(resultCount),
    "After Empty": afterEmpty,
  });
}

/**
 * A directory filter dimension was engaged (7a-4) — **the dimension name only**
 * (via {@link FILTER_DIMENSIONS}), never the selected value, which would narrow
 * toward *whom* the brother is looking for (P6). Tells which filters earn their
 * place in the panel. The filter values live in the URL query and are kept off the
 * event by `BLOCKED_PROPERTIES` stripping `$current_url`.
 */
export function trackFilterApplied(dimension: FilterDimensionKey): void {
  emit("Filter Applied", { Dimension: FILTER_DIMENSIONS[dimension] });
}

/**
 * A column was shown or hidden in the lens picker (7a-4) — the column key (a schema
 * field *name* like `email`, not brother data) and its new visibility. Answers
 * whether the default lens is right or everyone re-derives their own (D30/D33).
 */
export function trackColumnLayoutChanged(column: string, shown: boolean): void {
  emit("Column Layout Changed", { Column: column, Shown: shown });
}

/** The column lens was reset to defaults (7a-4). */
export function trackColumnsReset(): void {
  emit("Columns Reset", {});
}

/**
 * A help toggle-tip opened (7a-4) — the control's help title. D53/D111 built a
 * layered help system nothing yet measures; `topic` is a static control name, never
 * brother data.
 */
export function trackHelpOpened(topic: string): void {
  emit("Help Opened", { Topic: topic });
}

/**
 * A staff CSV export ran (7a-4) — its scope and a bucketed row count. Already
 * audited server-side for security (D92); this is the low-volume, staff-only
 * usage-shape view.
 */
export function trackExportPerformed(scope: ExportScope, rowCount: number): void {
  emit("Export Performed", { Scope: scope, "Row Count": rowCountBucket(rowCount) });
}

/**
 * The below-`md` "Options" disclosure fold was opened (7a-4; N92). The audience
 * skews 60+ and phone use has been assumed rather than measured.
 */
export function trackMobileOptionsOpened(): void {
  emit("Mobile Options Opened", {});
}
