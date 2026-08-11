import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard on the `firebase.json` Hosting header rules that carry D95 and D126
 * (7b-1 / OFC-212).
 *
 * Why this needs a test at all: Book's `Cache-Control` posture is NOT decided by
 * the code that looks like it decides it. Firebase Hosting applies its `headers`
 * rules to the `/api/**` and `/img/**` **rewrite** responses and **overrides the
 * backend's `Cache-Control` on 2xx** — measured live on staging in 7b-1, and the
 * same precedence the `onSend` security-header hook in `apps/api/src/server.ts`
 * already documents for CSP/HSTS (OFC-146). Before this rule existed, the API
 * dutifully sent `no-store` on `GET /api/profiles` and the browser was delivered
 * `no-cache, must-revalidate` from the `**` rule — i.e. the whole real-PII roster
 * was cacheable to disk, exactly the D95 violation OFC-212 was filed to check.
 *
 * So these two rules are the *actual* enforcement point, an API unit test cannot
 * see them, and nothing else in the gate would notice their deletion. Hence a
 * config-shape guard.
 *
 * The ordering assertions matter just as much as the presence ones: Hosting
 * applies **all** matching rules and the **last** match wins per header key
 * (established empirically against our own live config — a hashed `/assets/*.js`
 * matches both the `**` rule and the extension rule and is delivered the latter's
 * value; Firebase's published `headers` docs do not state the precedence, so this
 * is measured behaviour, not a documented guarantee). Move these rules above the
 * broad ones and the fix silently reverts.
 */

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

const hostingHeaders = (): HeaderRule[] => {
  const path = fileURLToPath(new URL("../../firebase.json", import.meta.url));
  const config = JSON.parse(readFileSync(path, "utf8")) as {
    hosting: { headers: HeaderRule[] };
  };
  return config.hosting.headers;
};

const cacheControlOf = (rule: HeaderRule | undefined): string | undefined =>
  rule?.headers.find((h) => h.key === "Cache-Control")?.value;

const indexOfSource = (rules: HeaderRule[], source: string): number =>
  rules.findIndex((rule) => rule.source === source);

describe("firebase.json Hosting cache headers", () => {
  it("serves every /api/** response no-store (D95 — no real PII to browser disk)", () => {
    const rules = hostingHeaders();
    const api = rules.find((rule) => rule.source === "/api/**");
    expect(api, "the /api/** Cache-Control rule is missing — D95 is unenforced").toBeDefined();
    expect(cacheControlOf(api)).toBe("no-store");
  });

  it("keeps member images private, not public (D126 — a photo is PII)", () => {
    const rules = hostingHeaders();
    const img = rules.find((rule) => rule.source === "/img/**");
    expect(img, "the /img/** Cache-Control rule is missing").toBeDefined();
    // `private` is the load-bearing token: the generic extension rule below sets
    // `public` on `**/*.webp`, which matches a headshot URL served through the
    // `/img/**` rewrite and would otherwise advertise member photos as storable
    // by shared/intermediary caches.
    expect(cacheControlOf(img)).toBe("private, max-age=31536000, immutable");
    expect(cacheControlOf(img)).toContain("private");
  });

  it("orders the rewrite rules AFTER the broad rules, so last-match-wins favours them", () => {
    const rules = hostingHeaders();
    const catchAll = indexOfSource(rules, "**");
    const byExtension = indexOfSource(rules, "**/*.@(js|css|woff2|svg|png|webp|ico)");
    const api = indexOfSource(rules, "/api/**");
    const img = indexOfSource(rules, "/img/**");

    expect(catchAll).toBeGreaterThanOrEqual(0);
    expect(byExtension).toBeGreaterThanOrEqual(0);
    // `/api/**` only has to beat the catch-all; `/img/**` must also beat the
    // extension rule, since a headshot ends in `.webp`.
    expect(api).toBeGreaterThan(catchAll);
    expect(img).toBeGreaterThan(catchAll);
    expect(img).toBeGreaterThan(byExtension);
  });

  // The proximity tables are public reference data — no member is named in
  // them — under content-hashed filenames, which is what makes a year-long
  // immutable cache safe: regenerating them changes the filename (D177/OFC-378).
  // They are *not* covered by the extension rule, whose list has no `csv`, so
  // without this rule they would inherit the catch-all's revalidate-every-time.
  it("serves the proximity tables immutably (D177)", () => {
    const rules = hostingHeaders();
    const geo = rules.find((rule) => rule.source === "/geo/*.csv");
    expect(geo, "the /geo/*.csv Cache-Control rule is missing").toBeDefined();
    expect(cacheControlOf(geo)).toBe("public, max-age=31536000, immutable");
    expect(indexOfSource(rules, "/geo/*.csv")).toBeGreaterThan(indexOfSource(rules, "**"));
  });

  it("leaves the SPA shell revalidating and hashed assets immutable (D73)", () => {
    const rules = hostingHeaders();
    expect(cacheControlOf(rules.find((rule) => rule.source === "**"))).toBe(
      "no-cache, must-revalidate",
    );
    expect(
      cacheControlOf(rules.find((r) => r.source === "**/*.@(js|css|woff2|svg|png|webp|ico)")),
    ).toBe("public, max-age=31536000, immutable");
  });
});
