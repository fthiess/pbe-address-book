import mixpanel from "mixpanel-browser/src/loaders/loader-module-core";
import { type AnalyticsClient, setAnalyticsClient } from "./analytics.js";

/**
 * The real Mixpanel client (D138). Imported **only** from `main.tsx`, so the
 * browser entry is the one place that pulls `mixpanel-browser` into the graph and
 * the pure logic in `analytics.ts` stays testable under Vitest's node environment.
 *
 * ## Why the `loader-module-core` specifier
 *
 * This is Mixpanel's documented entry point for "the core SDK with no option of
 * session recording". D138 named `dist/mixpanel-core.cjs.js` instead; both exist in
 * v2.81.0 and both work, but the ESM loader is the *supported* specifier and, being
 * source rather than a pre-bundled CJS blob, Rollup can tree-shake through it —
 * measured on this branch at **+30.5 KB** brotli of total shipped JS against
 * **+31.2 KB** for the dist file. Documented and smaller, so it wins.
 *
 * ## Why the import is static
 *
 * It would be tempting to `import()` this lazily so a token-less build doesn't
 * carry 30 KB it will never use. **Don't.** CI builds without a token, and
 * `check-bundle-size.mjs` measures what CI builds — so a lazy import would quietly
 * make the D74 ceiling stop measuring the bundle that actually ships to members.
 * The cost of a static import is 30 KB in dev and e2e builds, where nobody is
 * counting; the cost of the clever version is a budget that lies.
 *
 * ## What is and isn't in this build (verified, not assumed)
 *
 * The recorder *implementation* is genuinely absent: the built bundle contains zero
 * occurrences of `rrweb`, `rrdom` or `MixpanelRecorder`, and `scripts/assert-no-
 * session-replay.mjs` fails the gate if that ever changes. What the core build does
 * still carry is the recorder *plumbing* (a `recorderManager`, the config keys) with
 * no payload behind it — so replay cannot record, but "the core build means the
 * feature isn't present" is a slight overstatement of D138. The explicit
 * `record_sessions_percent: 0` and `autocapture: false` below are therefore kept as
 * belt-and-braces rather than relied on as redundant.
 */

// The Mixpanel project token for this environment, injected at build time (D138,
// on the N94 pattern). It defaults to **empty**, which disables analytics — see
// vite.config.ts for why this one define inverts N94's default-to-production rule.
const TOKEN = typeof __MIXPANEL_TOKEN__ !== "undefined" ? __MIXPANEL_TOKEN__ : "";

/**
 * Mixpanel's own default ingestion origin (read from `DEFAULT_CONFIG` in
 * `mixpanel-browser`, not inferred). Named here because `firebase.json`'s CSP
 * `connect-src` must list exactly this origin — if a future library version moves
 * it, events fail on a CSP violation and this constant is where to look.
 *
 * Book talks to Mixpanel **directly**, not through the newsletter's
 * `mp.pbe400.org` first-party proxy (D139 left this open for 7a-2). The proxy
 * defeats ad blockers only by being same-site as the page, and Book-staging at
 * `pbe-book-staging.web.app` is a different registrable domain from `pbe400.org` —
 * so today it would buy nothing while adding a cross-origin hop. At cutover
 * `book.pbe400.org` makes it genuinely same-site; see CUTOVER-PLAN.md.
 */
const API_HOST = "https://api-js.mixpanel.com";

export function initAnalytics(): void {
  if (!TOKEN) {
    return;
  }

  mixpanel.init(TOKEN, {
    api_host: API_HOST,
    // Retained from D88: a global browser DNT/GPC signal is not a statement about
    // a members-only internal tool measuring its own disclosed usage.
    ignore_dnt: true,
    // D138, stated explicitly rather than left to defaults so the intent survives a
    // library upgrade that changes them. Book wires its events deliberately, and
    // replay would ship other brothers' rendered PII around the D5/D82 projection.
    autocapture: false,
    record_sessions_percent: 0,
    // Page views are tracked by hand on the **route pattern** (see analytics.ts);
    // this option would record the raw URL, which P6 forbids.
    track_pageview: false,
    // localStorage rather than the default cookie: a cookie rides every same-origin
    // request, and this audience is on slow links with many `/img/*` fetches per
    // page. Identity still stitches across Book and the newsletter, because both
    // halves call `identify()` with the same Ghost uuid (D137) — the shared
    // `$user_id`, not a shared cookie, is what joins them.
    persistence: "localStorage",
    secure_cookie: true,
    // Host-only. On `*.web.app` a cross-subdomain cookie is unsettable anyway
    // (public suffix); at cutover this becomes a real choice — see CUTOVER-PLAN.md.
    cross_subdomain_cookie: false,
  });

  const client: AnalyticsClient = {
    identify: (distinctId) => mixpanel.identify(distinctId),
    peopleSet: (properties) => mixpanel.people.set(properties),
    track: (event, properties) => mixpanel.track(event, properties),
    reset: () => mixpanel.reset(),
  };
  setAnalyticsClient(client);

  // One line, always — the cheap way to tell "an ad blocker ate the requests" from
  // "analytics is misconfigured", which look identical otherwise. uBlock Origin and
  // Privacy Badger both block this origin outright.
  console.info(`[analytics] Mixpanel initialised → ${API_HOST} (blocked by ad blockers)`);
}
