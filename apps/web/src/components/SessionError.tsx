import { PrivacyFooter } from "./PrivacyFooter.js";

/**
 * The retryable session-load error screen (OFC-76). Shown when `GET /api/me`
 * fails for a *transient* reason (a network blip, or a scale-to-zero cold-start
 * timeout) even after one automatic retry — as distinct from a real 401/403,
 * which routes to sign-in. The point is to keep an already-signed-in member from
 * being bounced through the whole Ghost re-login flow over a momentary hiccup;
 * they just press "Try again," which re-runs the same load. Copy is calm and
 * non-alarming for an audience that skews 60+ on slow links.
 */
export function SessionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col bg-secondary">
      <main className="grid flex-1 place-items-center px-4 py-12">
        <section
          role="alert"
          aria-labelledby="session-error-heading"
          className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center text-card-foreground shadow-sm"
        >
          <h1 id="session-error-heading" className="text-2xl font-bold tracking-tight">
            We couldn’t reach the directory
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This is usually a brief hiccup — the connection dropped, or the server was waking up.
            Your session is still active; please try again.
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
