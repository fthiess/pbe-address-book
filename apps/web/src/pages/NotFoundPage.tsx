import { Link } from "react-router-dom";

/**
 * The catch-all page for an unknown URL (OFC-202). Book is a single-page app behind
 * Firebase Hosting's `** → /index.html` rewrite (D126), so an unknown path cannot
 * cheaply return a *true* HTTP 404 — Hosting has no route table and serves the shell
 * at `200`. This renders an honest "page not found" inside the app shell instead of
 * the old silent fall-through to the Directory, with a calm way back. (Forrest's
 * call, 2026-07-11: a client-rendered 404 UI is the right cost for an internal
 * members app; a real HTTP 404 would mean teaching a backend layer every valid
 * route.) It sits inside the session gate, so an unknown URL opened while signed out
 * still lands on the sign-in screen, not here.
 */
export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-border bg-card p-6">
        <h1 className="text-[length:var(--text-h3)] font-bold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist. It may have been moved, or the link may be
          mistyped.
        </p>
        <Link
          to="/"
          className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Go to the Directory
        </Link>
      </div>
    </section>
  );
}
