# App content

Repo-authored copy that is compiled into the SPA at **build time**. Today that is
`about.md`, the About page's text (OFC-244, DECISIONS N116).

`about.md` is compiled to HTML by `aboutHtmlPlugin` in `apps/web/vite.config.ts`,
using `compileAboutHtml` from `../buildtime/aboutHtml.ts`. `marked` is a
devDependency, so **no Markdown parser ships in the bundle** — the app imports only
the finished HTML string, via the virtual module `virtual:about-html`.

Editing the copy is an ordinary Markdown edit. `npm run dev` picks it up without a
restart.

## Rules the compiler enforces

Each of these **fails the build** rather than reaching a reader, so a mistake is
loud and immediate:

- **Start headings at `##`.** `AboutPage.tsx` renders the page's single `<h1>`; a
  second one breaks heading order (WCAG 1.3.1, and the axe check is CI-gated).
  Headings nested in a blockquote or list count too.
- **No HTML comments.** Not even closed ones — that is why this guidance lives in
  a README instead of at the top of `about.md`. An unterminated `<!--` cannot be
  stripped (there is no `-->` to match) and would comment out the rest of the page
  in the browser, so the compiler rejects the construct outright rather than trying
  to sanitize it.
- **No `<script>`, no inline `on*=` handler, no `javascript:` URL.** The compiled
  HTML is injected with `dangerouslySetInnerHTML`; these guards are what make that
  defensible.
- **No off-origin images or embeds**, including protocol-relative (`//host/x`)
  ones. Firebase Hosting serves the SPA under `default-src 'self'`, while
  `vite preview` — what the Playwright suite runs against — sends no CSP headers at
  all, so an external asset would pass local tests and break on staging.

Links are handled for you: an external link gets `target="_blank"`,
`rel="noopener noreferrer"`, and an "(opens in a new tab)" accessible name, while a
root-relative link (e.g. `/brother/me/edit`) is routed in-app rather than
triggering a full page reload.

## Naming

Member-facing copy says **"PBE Address Book"** on first use and **"the Address
Book"** thereafter. Never a bare "Book" — that is internal shorthand for code and
docs only (N116). A unit test asserts this over `about.md`.
