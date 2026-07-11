import type { Role } from "@pbe/shared";
import { useState } from "react";
import { useSession } from "../auth/SessionContext.js";
import { PrivacyFooter } from "../components/PrivacyFooter.js";
import { devSignIn, startSignIn } from "../lib/api.js";

const DEV_ROLES: Role[] = ["brother", "manager", "admin"];

/**
 * The signed-out screen. In production it offers the single Ghost sign-in, which
 * redirects through the relay (`POST /api/auth/start` → the relay URL). In local
 * development it also shows a role switcher backed by `/api/dev/session` (D72);
 * that block is compiled out of the production bundle by `import.meta.env.DEV`.
 */
export function SignIn() {
  const { state, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // An involuntary, mid-session sign-out — the 4-hour cap lapsed under an open tab
  // (D22), or access was revoked (N53). The message stays cause-agnostic ("signed
  // out", not "due to inactivity") so it's accurate either way; explaining it turns
  // the otherwise-baffling "why am I signed out?" into a calm, expected prompt, while
  // a first-time visitor sees nothing extra (OFC-193).
  const expired = state.status === "unauthenticated" && state.expired === true;

  async function ghostSignIn() {
    setBusy(true);
    setMessage(null);
    try {
      const { signInUrl } = await startSignIn();
      window.location.assign(signInUrl);
    } catch {
      setBusy(false);
      setMessage("Sign-in is unavailable right now. Please try again in a moment.");
    }
  }

  async function chooseDevRole(role: Role) {
    setBusy(true);
    setMessage(null);
    try {
      await devSignIn(role);
      await refresh();
    } catch {
      // Without this, a dev-sign-in failure (API restart, blip) left `busy` true
      // forever, disabling every sign-in button with no error and no retry (OFC-77).
      setBusy(false);
      setMessage("Sign-in is unavailable right now. Please try again in a moment.");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-secondary">
      <main className="grid flex-1 place-items-center px-4 py-12">
        <section
          aria-labelledby="signin-heading"
          className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-card-foreground shadow-sm"
        >
          <img src="/crest.svg" alt="" aria-hidden="true" className="mx-auto size-12" />
          <h1 id="signin-heading" className="mt-4 text-center text-2xl font-bold tracking-tight">
            PBE Address Book
          </h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            A private directory for brothers of Phi Beta Epsilon. Sign in with your pbe400.org
            membership to continue.
          </p>

          {expired && (
            // Polite (not an error): a calm, expected explanation of the involuntary
            // sign-out. `<output>`'s implicit "status" live region announces it on the
            // screen change; AA-contrast info styling (OFC-193).
            <output className="mt-4 block rounded-lg border border-border bg-secondary px-3 py-2 text-center text-sm text-foreground">
              You've been signed out. Please sign in again.
            </output>
          )}

          <button
            type="button"
            onClick={() => void ghostSignIn()}
            disabled={busy}
            className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            Sign in
          </button>

          {message && (
            <p role="alert" className="mt-3 text-center text-sm text-destructive">
              {message}
            </p>
          )}

          {import.meta.env.DEV && (
            <div className="mt-8 rounded-xl border border-dashed border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Local development
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sign in as a role without Ghost (dev only).
              </p>
              <div className="mt-3 flex gap-2">
                {DEV_ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => void chooseDevRole(role)}
                    disabled={busy}
                    className="flex-1 rounded-lg border border-border bg-background px-2 py-2 text-sm font-medium capitalize hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
      <PrivacyFooter />
    </div>
  );
}
