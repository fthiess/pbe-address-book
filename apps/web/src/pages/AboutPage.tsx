import aboutHtml from "virtual:about-html";
import { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

/**
 * The About page (OFC-244, N116): what the PBE Address Book is, how to report a
 * problem, its open-source and trademark position, and the analytics disclosure.
 * Reached from the avatar menu; it sits inside the session gate like every other
 * page, so it is members-only.
 *
 * The copy lives in `src/content/about.md` and is compiled to HTML **at build
 * time** (`aboutHtmlPlugin`, vite.config.ts), so editing it is a Markdown edit and
 * no Markdown parser ships in the bundle. The page renders the single `<h1>`; the
 * Markdown starts at `##`, which the compiler enforces.
 */
export function AboutPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const proseRef = useRef<HTMLDivElement>(null);

  /**
   * The injected HTML holds plain `<a href="/…">` elements, not router `<Link>`s, so
   * an internal link (today `/brother/me/edit`) would trigger a **full page reload**
   * — refetching the whole bundle and roster on exactly the slow connections this app
   * is built for. Delegate such clicks to the router instead.
   *
   * A real DOM listener on the container rather than a JSX `onClick`: the handler
   * belongs to the injected subtree, not to this presentational `<div>`, and binding
   * it here keeps the div free of an interaction handler it does not semantically own.
   *
   * Deliberately narrow — only a plain left-click on a *relative*, non-`target` href
   * is intercepted, so Ctrl/Cmd/Shift-click and middle-click still open a new tab as
   * a reader expects, and external links (which the compiler marks `target="_blank"`)
   * are never touched. Keyboard activation of a link dispatches a click, so Enter is
   * covered by the same path.
   */
  useEffect(() => {
    const container = proseRef.current;
    if (!container) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest("a");
      const href = anchor?.getAttribute("href");
      // In-app iff it is a root-relative path — and `//host/x` is NOT one: it is
      // protocol-relative and resolves off-origin, so a bare `startsWith("/")`
      // would hand an external URL to the router. Mirrors OFF_ORIGIN_URL in
      // buildtime/aboutHtml.ts, which marks such links `target="_blank"`
      // (checked below as a second line of defence).
      if (!href?.startsWith("/") || href.startsWith("//")) return;
      if (anchor?.hasAttribute("target")) return;

      event.preventDefault();
      void navigate(href);
    };

    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [navigate]);

  /**
   * Scroll to the `#fragment` a link asked for. The browser does this itself on a
   * full page load, but **not** on a client-side navigation — and the privacy
   * footer's `/about#privacy` (OFC-281) is exactly that: a router `<Link>` from
   * another page. Without this the reader lands at the top of About and has to
   * hunt for the section he asked for.
   *
   * Focus moves with the scroll, so the jump works for keyboard and screen-reader
   * users rather than only visually (WCAG 2.4.3). The heading isn't natively
   * focusable, hence the temporary `tabIndex`; it is removed on blur so the
   * heading never becomes a stop in normal tab order.
   */
  useEffect(() => {
    if (!hash) return;

    // Decoded because a fragment arrives percent-encoded: every anchor the
    // compiler generates today is plain ASCII, so this is belt-and-braces rather
    // than a live case — but an undecoded lookup fails by silently landing at the
    // top of the page, which is indistinguishable from the link being broken.
    let fragment = hash.slice(1);
    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      // A malformed escape sequence — fall back to the raw fragment.
    }

    const target = document.getElementById(fragment);
    if (!target) return;

    target.scrollIntoView({ block: "start" });
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
  }, [hash]);

  return (
    <section className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-border bg-card p-6">
        <h1 className="text-[length:var(--text-h3)] font-bold">About the PBE Address Book</h1>
        {/* ⚠ `dangerouslySetInnerHTML` — the only use of it in this app, and the reason
            biome.json turns `noDangerouslySetInnerHtml` off for this one file (Biome
            cannot suppress on a JSX *attribute*, so a file-scoped override is the only
            available shape; same pattern as the Combobox.tsx entry beside it).

            It is defensible because the HTML is compiled **at build time** from a
            reviewed file in this repo (src/content/about.md) and never from user
            content or a network response — and because that claim is *enforced*, not
            merely asserted: compileAboutHtml() fails the build on a <script>, an
            inline on*= handler, a javascript: URL, or an off-origin asset. Do not
            point this div at any other source of HTML. See src/buildtime/aboutHtml.ts
            and its unit tests. */}
        <div
          ref={proseRef}
          className="about-prose mt-4"
          dangerouslySetInnerHTML={{ __html: aboutHtml }}
        />
        {/* No build id here on purpose: PrivacyFooter already carries it on every page
            (OFC-63), so repeating it inside the card just showed "Version <sha>" twice
            on one screen. */}
        <Link
          to="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Go to the Directory
        </Link>
      </div>
    </section>
  );
}
