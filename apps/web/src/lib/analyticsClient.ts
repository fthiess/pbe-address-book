import mixpanel from "mixpanel-browser/src/loaders/loader-module-core";
import { type AnalyticsClient, setAnalyticsClient } from "./analytics.js";
import {
  APP_SUPER_PROPERTIES,
  MIXPANEL_API_HOST,
  MIXPANEL_INIT_CONFIG,
} from "./analyticsConfig.js";

/**
 * The real Mixpanel client (D138/D140). Imported **only** from `main.tsx`, so the
 * browser entry is the one place that pulls `mixpanel-browser` into the graph and
 * the pure logic in `analytics.ts` stays testable under Vitest's node environment.
 *
 * The `init()` options live in `analyticsConfig.ts` as plain data so they can be
 * unit-tested; this module is only the wiring. See N125 for why that split exists.
 *
 * ## Why the `loader-module-core` specifier
 *
 * This is Mixpanel's documented entry point for "the core SDK with no option of
 * session recording". D138 named `dist/mixpanel-core.cjs.js` instead; both exist in
 * v2.81.0 and both work, but the ESM loader is the *supported* specifier and, being
 * source rather than a pre-bundled CJS blob, Rollup can tree-shake through it —
 * measured at **+30.5 KB** brotli of total shipped JS against **+31.2 KB** for the
 * dist file. Documented and smaller, so it wins.
 *
 * ## Why the import is static
 *
 * It would be tempting to `import()` this lazily so a token-less build doesn't
 * carry 30 KB it will never use. **Don't.** CI builds without a token, so a lazy
 * import would leave the library out of the very build `check-bundle-size.mjs`
 * measures, and the D74 ceiling would stop tracking what ships to members. The
 * cost of a static import is 30 KB in dev and e2e builds, where nobody is
 * counting; the cost of the clever version is a budget that lies.
 *
 * (With a static import the library is present either way. The `init()` body below
 * *is* dead-code-eliminated in a token-less build, so CI measures ~0.6 KB less than
 * staging ships — a floor rather than an exact match, noted in check-bundle-size.)
 *
 * ## What is and isn't in this build (verified, not assumed)
 *
 * The recorder *implementation* is genuinely absent: the built bundle contains zero
 * occurrences of `rrweb`, `rrdom` or `MixpanelRecorder`, and
 * `scripts/assert-no-session-replay.mjs` fails the build if that ever changes. What
 * the core build does still carry is the recorder *plumbing* (a `recorderManager`,
 * the config keys) with no payload behind it — so replay cannot record, but "the
 * core build means the feature isn't present" is a slight overstatement of D138.
 * The explicit `record_sessions_percent: 0` and `autocapture: false` are therefore
 * kept as belt-and-braces rather than relied on as redundant.
 */

// The Mixpanel project token for this environment, injected at build time (D138,
// on the N94 pattern). It defaults to **empty**, which disables analytics — see
// vite.config.ts for why this one define inverts N94's default-to-production rule.
const TOKEN = typeof __MIXPANEL_TOKEN__ !== "undefined" ? __MIXPANEL_TOKEN__ : "";

export function initAnalytics(): void {
  if (!TOKEN) {
    return;
  }

  mixpanel.init(TOKEN, MIXPANEL_INIT_CONFIG);
  // D62's app discriminator, as a super property so it rides every event. Must be
  // registered before any event can fire — see analyticsConfig.ts.
  mixpanel.register({ ...APP_SUPER_PROPERTIES });

  const client: AnalyticsClient = {
    identify: (distinctId) => mixpanel.identify(distinctId),
    peopleSet: (properties) => mixpanel.people.set(properties),
    track: (event, properties) => mixpanel.track(event, properties),
    reset: () => {
      mixpanel.reset();
      // `reset()` clears super properties along with the identity, so the app
      // discriminator has to be put back or every post-sign-out event loses it.
      mixpanel.register({ ...APP_SUPER_PROPERTIES });
    },
  };
  setAnalyticsClient(client);

  // One line, always — the cheap way to tell "a content blocker ate the requests"
  // from "analytics is misconfigured", which look identical otherwise. uBlock
  // Origin blocks this origin from its default lists; Privacy Badger is heuristic
  // and may block it only after observing it tracking across several sites.
  console.info(`[analytics] Mixpanel initialised → ${MIXPANEL_API_HOST}`);
}
