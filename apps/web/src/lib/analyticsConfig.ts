/**
 * Mixpanel's `init()` configuration, as **plain data** (D138/D140/N125).
 *
 * It lives in its own module, apart from `analyticsClient.ts`, for one reason:
 * `analyticsClient.ts` imports `mixpanel-browser`, which touches `window` at module
 * scope and therefore cannot be imported by a unit test under Vitest's node
 * environment. Keeping the config here makes it assertable — and the 7a-2 code
 * review proved that matters, because the config is where the privacy-critical
 * settings live and a test against the injected fake client is structurally blind
 * to them.
 */

/**
 * Properties Mixpanel attaches to events **by itself**, which Book must strip.
 *
 * This is the correction at the heart of N125. `mixpanel.track()` merges
 * `_.info.properties()` into every event before sending it
 * (`mixpanel-browser/src/mixpanel-core.js`), and that set includes
 * **`$current_url` — `window.location.href`**. Book's route-`handle` design
 * governs only the property the *app* authors; it has no effect on the ones the
 * *library* adds. Without this blacklist, a Page View fired on `/brother/5247`
 * ships that record id to Mixpanel, and — because the Directory mirrors its search
 * box into the URL as `?q=` (D31/N15) — a search also ships the **raw query text**.
 * Both are exactly what P6 forbids, and both were shipped by the first draft of
 * this feature under a comment asserting they were impossible.
 *
 * `property_blacklist` is applied after all merging, as `delete properties[key]`,
 * so it covers library-added, persisted super-, and caller-supplied properties
 * alike. `$initial_referrer` / `$initial_referring_domain` are persisted super
 * properties (`update_referrer_info`) and ride events the same way; `$referrer`
 * is `document.referrer`. All five name a URL, and a URL on this site names a
 * brother.
 *
 * **Anything added to Book's analytics later must keep this list intact**, and any
 * new Mixpanel feature should be checked for properties it attaches on its own —
 * that is the general lesson, not the specific five keys.
 */
export const BLOCKED_PROPERTIES = [
  "$current_url",
  "$referrer",
  "$referring_domain",
  "$initial_referrer",
  "$initial_referring_domain",
] as const;

/**
 * D62's `app` discriminator, registered as a super property so it rides every
 * event. Each Mixpanel project spans **both** halves of the composite system at
 * its tier — Ghost and Book — and D138 kept that arrangement deliberately, so
 * without this there is nothing distinguishing a Book "Page View" from one the
 * newsletter's autocapture emitted, under the same `$user_id` (D137). It cannot
 * be backfilled: events written without it stay ambiguous forever.
 */
export const APP_SUPER_PROPERTIES = { app: "book" } as const;

/**
 * Mixpanel's own default ingestion origin (read from `DEFAULT_CONFIG` in
 * `mixpanel-browser`, not inferred). `firebase.json`'s CSP `connect-src` must list
 * exactly this origin — if a library upgrade moves it, events fail on a CSP
 * violation and this constant is where to look.
 *
 * Book talks to Mixpanel **directly**, not through the newsletter's
 * `mp.pbe400.org` first-party proxy (D140, resolving what D139 parked): the proxy
 * defeats ad blockers only by being same-site, and Book-staging at
 * `pbe-book-staging.web.app` is a different registrable domain from `pbe400.org`.
 * At cutover `book.pbe400.org` makes it genuinely same-site — see CUTOVER-PLAN.md.
 */
export const MIXPANEL_API_HOST = "https://api-js.mixpanel.com";

/**
 * The `init()` options, minus the token. Every value here is deliberate; several
 * restate a library default so the intent survives an upgrade that changes it.
 */
export const MIXPANEL_INIT_CONFIG = {
  api_host: MIXPANEL_API_HOST,

  // The privacy-critical entry — see BLOCKED_PROPERTIES above.
  property_blacklist: [...BLOCKED_PROPERTIES],
  // Stop the referrer being written into persistence at all. The blacklist is the
  // real guard (it strips on the way out); this keeps it out of the store too.
  save_referrer: false,

  // Retained from D88: a global browser DNT/GPC signal is not a statement about a
  // members-only internal tool measuring its own disclosed usage. NOTE this is
  // **not** a library default — `DEFAULT_CONFIG` sets it `false`, so D88's
  // "retained" holds only because this line says so.
  ignore_dnt: true,

  // D138. Restating the current defaults, deliberately: Book wires its events by
  // hand, and session replay would ship other brothers' rendered PII to Mixpanel,
  // around the D5/D82 projection that is the single visibility-enforcement point.
  autocapture: false,
  record_sessions_percent: 0,

  // Page views are tracked by hand on the route pattern (see analytics.ts). This
  // option would fire Mixpanel's own pageview event carrying URL components.
  // Note it suppresses only *that* event — it does nothing about `$current_url` on
  // hand-fired events, which is what BLOCKED_PROPERTIES is for.
  track_pageview: false,

  // localStorage rather than the default cookie: a cookie rides every same-origin
  // request, and this audience is on slow links with many `/img/*` fetches per
  // page. Cross-app identity is unaffected — Book and the newsletter are joined by
  // a shared `$user_id` (the Ghost uuid, D137), not by a shared cookie.
  persistence: "localStorage" as const,
  secure_cookie: true,
  // Host-only. On `*.web.app` a cross-subdomain cookie is unsettable anyway
  // (public suffix); at cutover this becomes a real choice — see CUTOVER-PLAN.md.
  cross_subdomain_cookie: false,
};
