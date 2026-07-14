/**
 * Outbound links to the sibling PBE News newsletter (OFC-243/N94). The URL is
 * environment-specific — staging must point at staging.pbe400.org, production at
 * pbe400.org — so it is injected at build time by Vite `define` from the deploy's
 * `BOOK_PBE_NEWS_URL` (see vite.config.ts + infra/environments/*.env). The guarded
 * fallback keeps a dev build (or a test, where the global is undefined) linking to
 * the production site rather than crashing.
 */
export const PBE_NEWS_URL =
  typeof __PBE_NEWS_URL__ !== "undefined" ? __PBE_NEWS_URL__ : "https://pbe400.org";
