import { describe, expect, it } from "vitest";
import {
  APP_SUPER_PROPERTIES,
  BLOCKED_PROPERTIES,
  MIXPANEL_API_HOST,
  MIXPANEL_INIT_CONFIG,
} from "./analyticsConfig.js";

/**
 * These assertions exist because of a specific review failure (N125).
 *
 * `analytics.test.ts` asserts against an injected fake client, so it can only ever
 * see the properties the *app* passes — it is structurally blind to the ones
 * Mixpanel staples on itself, which is exactly where the P6 violation was. The
 * config is the only place those are governed, so the config is what gets pinned
 * here.
 */

describe("BLOCKED_PROPERTIES (P6)", () => {
  it("strips $current_url — the property that carries the record id and the search query", () => {
    // `mixpanel.track()` merges `_.info.properties()` into every event, and that
    // includes `$current_url` (window.location.href). On this app the URL names a
    // brother (`/brother/5247`) and carries the search box (`?q=…`), so it is the
    // single most important property to remove.
    expect(BLOCKED_PROPERTIES).toContain("$current_url");
  });

  it("strips every referrer-shaped property, since a Book referrer is also a URL", () => {
    expect(BLOCKED_PROPERTIES).toEqual(
      expect.arrayContaining([
        "$referrer",
        "$referring_domain",
        "$initial_referrer",
        "$initial_referring_domain",
      ]),
    );
  });

  it("is wired into the init config, not merely declared", () => {
    // The failure mode this guards: the list exists, reads well, and is never
    // passed to `init()`.
    expect(MIXPANEL_INIT_CONFIG.property_blacklist).toEqual([...BLOCKED_PROPERTIES]);
  });
});

describe("MIXPANEL_INIT_CONFIG", () => {
  it("keeps session replay and autocapture off (D138)", () => {
    expect(MIXPANEL_INIT_CONFIG.record_sessions_percent).toBe(0);
    expect(MIXPANEL_INIT_CONFIG.autocapture).toBe(false);
  });

  it("leaves Mixpanel's own URL-bearing pageview event off (P6)", () => {
    expect(MIXPANEL_INIT_CONFIG.track_pageview).toBe(false);
  });

  it("keeps ignore_dnt on — it is NOT a library default (D88)", () => {
    // mixpanel-browser's DEFAULT_CONFIG sets this false, so D88's "retained" is
    // true only for as long as this line says so.
    expect(MIXPANEL_INIT_CONFIG.ignore_dnt).toBe(true);
  });

  it("does not persist the referrer", () => {
    expect(MIXPANEL_INIT_CONFIG.save_referrer).toBe(false);
  });

  it("points at the origin the CSP allows", () => {
    // If these drift apart, every event fails as a CSP violation. The literal is
    // duplicated here deliberately: the test is the reminder that firebase.json's
    // `connect-src` has to move with it.
    expect(MIXPANEL_INIT_CONFIG.api_host).toBe(MIXPANEL_API_HOST);
    expect(MIXPANEL_API_HOST).toBe("https://api-js.mixpanel.com");
  });
});

describe("APP_SUPER_PROPERTIES (D62)", () => {
  it("carries the app discriminator, which cannot be backfilled", () => {
    // Each Mixpanel project spans Ghost *and* Book at its tier (D138), under the
    // same $user_id (D137). Without this, a Book event is indistinguishable from a
    // newsletter one — and events already written without it stay ambiguous.
    expect(APP_SUPER_PROPERTIES).toEqual({ app: "book" });
  });
});
