/// <reference types="vite/client" />

/** The SPA build identifier, injected by Vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string;

/** The sibling newsletter's URL for this environment, injected by Vite `define`. */
declare const __PBE_NEWS_URL__: string;

/**
 * The Mixpanel project token for this environment, injected by Vite `define`
 * (D138). **Empty means analytics is disabled** — the default for dev and CI
 * builds; see vite.config.ts for why this one define defaults to empty rather
 * than to production.
 */
declare const __MIXPANEL_TOKEN__: string;

/**
 * The About page's copy (`src/content/about.md`), compiled to HTML at build time by
 * `aboutHtmlPlugin` in vite.config.ts (OFC-244, N116) — so no Markdown parser ships
 * in the bundle.
 */
declare module "virtual:about-html" {
  const html: string;
  export default html;
}
