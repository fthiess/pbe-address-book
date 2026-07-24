import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  REAUTH_FAILED,
  REAUTH_SUCCESS,
  REAUTH_WINDOW_NAME,
  useSession,
} from "../auth/SessionContext.js";
import { trackSignedIn } from "../lib/analytics.js";
import { ApiError, completeSignIn } from "../lib/api.js";

/** API-SPEC §2 denial codes → reassuring, actionable copy. */
const DENIAL_MESSAGE: Record<string, string> = {
  unlinked_member:
    "We couldn't match your membership to a directory record yet. Please contact an administrator to be added.",
  ambiguous_member:
    "Your email matches more than one record. Please contact an administrator so we can sort it out.",
  debrothered:
    "This account no longer has directory access. If you believe this is a mistake, please contact an administrator.",
};

/**
 * The `/auth/callback` page that completes the Ghost bridge (ENGINEERING-DESIGN
 * §2.1; API-SPEC §2). It reads the fragment-carried JWT and `state` nonce,
 * **clears the fragment immediately** so the token never lingers in history,
 * POSTs them to `/api/auth/session`, and on success refreshes the session and
 * lands the user in the app. A denial is shown as calm, contact-an-admin copy.
 */
export function AuthCallback() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return; // guard against React StrictMode's double-invoke (single-use nonce)
    }
    started.current = true;

    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = fragment.get("token");
    const state = fragment.get("state");
    // Strip the fragment before anything else — it carries the bearer token.
    window.history.replaceState(null, "", window.location.pathname);

    // Popup mode (OFC-236/D109): this callback is running inside the child window the
    // session layer opened to re-auth a mid-edit lapse. Instead of navigating a fresh
    // app in, it hands the restored session back to the opener (the untouched editor
    // tab) via a same-origin postMessage and closes — the cookie set by
    // `completeSignIn` is already shared across the tabs on this origin. The distinct
    // window name (never set on a normal top-level sign-in) is the reliable marker.
    const opener = window.opener as Window | null;
    const isReauthPopup = window.name === REAUTH_WINDOW_NAME && opener != null;
    const post = (type: string) => opener?.postMessage({ type }, window.location.origin);

    if (!token || !state) {
      if (isReauthPopup) {
        post(REAUTH_FAILED);
        window.close();
        return;
      }
      setMessage("This sign-in link is missing information. Please start again.");
      return;
    }

    completeSignIn(token, state)
      .then(async () => {
        if (isReauthPopup) {
          post(REAUTH_SUCCESS);
          window.close();
          return;
        }
        // A completed fresh, top-level sign-in (the re-auth popup returned above) —
        // the funnel end 7a-2 left open. Fired here rather than in the identify
        // effect so it counts real sign-ins, not every authenticated mount. It runs
        // before the identify() the app shell fires on mount, so it lands on the
        // anonymous device id; Simplified ID Merge folds it into the brother once
        // identify() resolves the uuid (N123).
        trackSignedIn();
        await refresh();
        navigate("/", { replace: true });
      })
      .catch((error) => {
        if (isReauthPopup) {
          post(REAUTH_FAILED);
          window.close();
          return;
        }
        const code = error instanceof ApiError ? error.code : undefined;
        setMessage(
          (code && DENIAL_MESSAGE[code]) ??
            "We couldn't complete your sign-in. Please try signing in again.",
        );
      });
  }, [navigate, refresh]);

  return (
    <div className="grid min-h-dvh place-items-center bg-secondary px-4">
      <section
        aria-labelledby="callback-heading"
        aria-live="polite"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center text-card-foreground shadow-sm"
      >
        {message ? (
          <>
            <h1 id="callback-heading" className="text-xl font-bold tracking-tight">
              Sign-in needs attention
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">{message}</p>
            <button
              type="button"
              onClick={() => navigate("/", { replace: true })}
              className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <h1 id="callback-heading" className="text-xl font-bold tracking-tight">
              Signing you in…
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              One moment while we verify your membership.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
