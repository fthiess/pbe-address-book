import { PrivacyFooter } from "./PrivacyFooter.js";

/**
 * The maintenance / outage screen (D118). The SPA's own fallback for when a
 * cached-and-already-loaded shell cannot reach the backend — a network drop, a
 * scale-to-zero cold-start timeout, or a `5xx`/`503` while Book is intentionally
 * **down for maintenance** or in an unplanned outage. It is shown from the session
 * gate's `error` state, after one automatic retry, instead of bouncing an
 * already-signed-in member through the whole Ghost re-login flow (OFC-76).
 *
 * Per the 5b-2 simplification of D118, Book does **not** try to distinguish planned
 * maintenance from an unplanned outage on this cached-SPA path — the backend may be
 * the very thing that is down, so it just shows one calm, generic "temporarily
 * unavailable, please check back" message with a manual retry. (A visitor loading
 * Book *fresh* during planned downtime gets the separate edge `maintenance.html`,
 * served by Firebase Hosting independently of Cloud Run.) Copy is calm and
 * non-alarming for an audience that skews 60+ on slow links, and reassures that the
 * member's session is preserved.
 */
export function MaintenanceOutage({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col bg-secondary">
      <main className="grid flex-1 place-items-center px-4 py-12">
        <section
          role="alert"
          aria-labelledby="outage-heading"
          className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center text-card-foreground shadow-sm"
        >
          <h1 id="outage-heading" className="text-2xl font-bold tracking-tight">
            Book is temporarily unavailable
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This is usually brief — the connection dropped, the server was waking up, or the
            directory is down for a short spell of maintenance. Your session is still active; please
            try again in a few minutes.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </section>
      </main>
      <PrivacyFooter />
    </div>
  );
}
