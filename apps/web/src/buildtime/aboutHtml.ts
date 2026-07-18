import { Marked } from "marked";

/**
 * Compile the About page's Markdown to HTML **at build time** (OFC-244, N116).
 *
 * ⚠ **This module is build-time only.** It is imported by `apps/web/vite.config.ts`
 * and must never be imported by application code: `marked` is a devDependency, and
 * pulling it in from `src/` would ship a Markdown parser to every reader for one
 * static page (the bundle runs against a 250 KB brotli ceiling and this audience is
 * on slow links by design). It lives under `src/` anyway because that is the only
 * path the vitest include glob, `apps/web/tsconfig.json`, and Biome all already
 * cover — so it is unit-tested, typechecked, and linted with no config changes.
 *
 * The output is injected with `dangerouslySetInnerHTML` (AboutPage.tsx), which is
 * defensible only because the input is a reviewed file in this repo and never user
 * content. {@link assertSafe} is what keeps that claim honest rather than merely
 * asserted: it fails the **build** on anything script-bearing or off-origin.
 */

/**
 * An HTML comment opener. `about.md` may not contain one **at all** — which is why
 * that file carries no authoring note and the guidance lives in
 * `src/content/README.md` instead.
 *
 * This started as a strip (`replace(/<!--[\s\S]*?-->/g, "")`) so the note could sit
 * atop the copy, and CodeQL's `js/incomplete-sanitization` was right to object: an
 * **unterminated** `<!--` cannot be stripped — there is no `-->` to match, and
 * looping the replace to a fixed point does not help (both verified) — and it would
 * reach the browser as raw HTML, commenting out the rest of the page. Rejecting the
 * construct outright deletes the whole class of problem instead of sanitizing it,
 * and costs only a comment in one Markdown file.
 */
const HTML_COMMENT_OPENER = "<!--";

/** `<script`, an inline `on*=` handler, or a `javascript:` URL — none may survive. */
const SCRIPT_BEARING = [
  { pattern: /<script/i, what: "a <script> tag" },
  { pattern: /\son[a-z]+\s*=/i, what: "an inline event handler (on*=)" },
  { pattern: /javascript:/i, what: "a javascript: URL" },
] as const;

/**
 * The one definition of "off-origin" used everywhere in this module — an absolute
 * URL (`https://host/x`) **or a protocol-relative one** (`//host/x`). The scheme is
 * optional in the pattern precisely because `//host/x` is the case that slips past
 * a naive `https?:` check while still resolving off-origin in a browser.
 *
 * `AboutPage.tsx` mirrors this rule when it decides whether a click is an in-app
 * navigation; keep the two in step.
 */
const OFF_ORIGIN_URL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * An off-origin `<img>`/`<iframe>`/`<embed>`. Firebase Hosting serves the SPA under
 * `default-src 'self'` (firebase.json), so an external asset is *blocked in
 * production* — but `vite preview`, which the Playwright suite runs against, sends
 * no CSP headers at all. Without this guard the failure mode is "green e2e, broken
 * staging", which is the worst kind.
 */
const OFF_ORIGIN_ASSET =
  /<(?:img|iframe|embed|object)\b[^>]*\b(?:src|data)\s*=\s*["']?(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * A rendered `<h1>` anywhere in the output. The token scan below catches the common
 * case with a better message, but it only walks **top-level** tokens — a heading
 * nested in a blockquote or list item (`> # Title`) still reaches the renderer. This
 * is the backstop that actually holds.
 */
const RENDERED_H1 = /<h1[\s>]/i;

/** Escape a string for interpolation into a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isExternal(href: string): boolean {
  return OFF_ORIGIN_URL.test(href);
}

/**
 * Turn a heading's plain text into a URL fragment. Deliberately conservative —
 * lower-case, ASCII word characters, single hyphens — so the resulting id needs
 * no escaping to be safe in a URL and stays stable if the heading's punctuation
 * is edited. "Something not right? Tell us" → `something-not-right-tell-us`.
 *
 * These ids are a **public surface**: `PrivacyFooter` links `/about#privacy`, so
 * renaming the "Privacy" heading in about.md silently breaks that link. A unit
 * test pins the anchors the app depends on for exactly that reason.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Throw on compiled HTML that must never reach a reader. Build-time, so a mistake
 * in the copy is a failed build rather than a shipped hazard.
 */
function assertSafe(html: string): void {
  for (const { pattern, what } of SCRIPT_BEARING) {
    if (pattern.test(html)) {
      throw new Error(`about.md compiled to HTML containing ${what}; that is not allowed.`);
    }
  }
  if (OFF_ORIGIN_ASSET.test(html)) {
    throw new Error(
      "about.md references an off-origin image or embed. The production CSP is " +
        "default-src 'self', so it would be blocked on staging while passing local e2e.",
    );
  }
  if (RENDERED_H1.test(html)) {
    throw new Error(
      "about.md produced an <h1>: the About page renders the page's only top-level " +
        "heading, so a second one breaks heading order (WCAG 1.3.1). Note a heading " +
        "nested in a blockquote or list counts — start every heading at '##'.",
    );
  }
}

/**
 * Compile the About copy. Beyond running `marked`, this:
 *
 * - **rejects an HTML comment** outright (see {@link HTML_COMMENT_OPENER}) — marked
 *   passes raw HTML straight through, and an unterminated comment cannot be
 *   sanitized, so `about.md` simply may not contain one;
 * - **rejects an `<h1>`**, because AboutPage.tsx renders the page's only `<h1>` —
 *   a second one breaks heading order (axe `heading-order`, WCAG 1.3.1). Checked
 *   against the lexed tokens rather than by regex, so a `#` inside a code fence
 *   isn't mistaken for a heading;
 * - **marks external links** `target="_blank" rel="noopener noreferrer"` with an
 *   "(opens in a new tab)" accessible name, matching the convention the masthead's
 *   PBE News link already follows (AppShell.tsx).
 */
export function compileAboutHtml(markdown: string): string {
  if (markdown.includes(HTML_COMMENT_OPENER)) {
    throw new Error(
      "about.md must not contain an HTML comment: marked passes raw HTML through, " +
        "and an unterminated '<!--' would comment out the rest of the page in the " +
        "browser. Put authoring notes in src/content/README.md instead.",
    );
  }

  const source = markdown;
  const marked = new Marked();
  // Per-compile, not module-level: each call must start clean, or a second
  // compile in the same process (the unit tests, or a watch-mode rebuild) would
  // see the first one's anchors and report a false duplicate.
  const seenIds = new Set<string>();

  for (const token of marked.lexer(source)) {
    if (token.type === "heading" && token.depth === 1) {
      throw new Error(
        "about.md must start its headings at '##': the About page renders its own " +
          "<h1>, so a top-level heading here breaks heading order (WCAG 1.3.1).",
      );
    }
  }

  marked.use({
    renderer: {
      // marked v16+ passes the renderer a token object, not positional arguments
      // (https://marked.js.org/using_pro). Nested inline content is rendered by
      // handing the child tokens back to the parser.

      // Headings carry a slugged id so a section can be linked directly — the
      // privacy footer points at `/about#privacy` (OFC-281). marked has emitted
      // no ids of its own since v5, so this is the whole mechanism. Generalized
      // rather than special-casing the one section that needs it today: every
      // section becomes addressable, which is what the Ghost theme will want in
      // 7.6. Note that a *link* alone is not enough — AboutPage must also scroll
      // to the hash, because a client-side navigation does not.
      heading(token) {
        const text = this.parser.parseInline(token.tokens);
        const id = slugify(token.text);

        // Two guards, in the spirit of the rest of this compiler: a bad anchor is
        // a failed build, not a shipped page that quietly misbehaves.
        //
        // An **empty** slug (a heading of pure punctuation) would emit `id=""` —
        // invalid, and unlinkable while looking like an anchor. A **duplicate**
        // slug is worse than invalid: the browser resolves a fragment to the
        // first match, so adding a second similarly-titled section would
        // silently redirect `/about#privacy` to the wrong part of the page —
        // failing precisely the promise the privacy link exists to keep.
        if (!id) {
          throw new Error(
            `about.md heading ${JSON.stringify(token.text)} has no letters or digits, so it yields an empty anchor id. Give it some word text.`,
          );
        }
        if (seenIds.has(id)) {
          throw new Error(
            `about.md has two headings that both produce the anchor "#${id}" (most recently ${JSON.stringify(token.text)}). Fragment links resolve to the first match, so this would silently point links at the wrong section — reword one of them.`,
          );
        }
        seenIds.add(id);

        return `<h${token.depth} id="${escapeAttribute(id)}">${text}</h${token.depth}>\n`;
      },

      link(token) {
        const text = this.parser.parseInline(token.tokens);
        const href = escapeAttribute(token.href);
        const title = token.title ? ` title="${escapeAttribute(token.title)}"` : "";
        if (!isExternal(token.href)) {
          return `<a href="${href}"${title}>${text}</a>`;
        }
        // The visible text stays as written; the accessible name gains the
        // new-tab warning (WCAG 3.2.5), as the PBE News link does.
        const label = escapeAttribute(`${token.text} (opens in a new tab)`);
        return `<a href="${href}"${title} target="_blank" rel="noopener noreferrer" aria-label="${label}">${text}</a>`;
      },
    },
  });

  const html = marked.parse(source, { async: false });
  assertSafe(html);
  return html;
}
