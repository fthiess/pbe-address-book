import type { Role } from "@pbe/shared";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { resetIdentity, trackViewAsEnded, trackViewAsStarted } from "../lib/analytics.js";
import {
  ApiError,
  impersonate as apiImpersonate,
  signOut as apiSignOut,
  stopImpersonating as apiStopImpersonating,
  fetchMe,
  setReauthHandler,
  setUnauthorizedHandler,
  startSignIn,
} from "../lib/api.js";
import { bumpReauthSignal } from "../lib/reauthSignal.js";
import type { Me } from "../lib/types.js";
import { clearRoster } from "../lib/useRoster.js";

/**
 * The app-wide auth state. The SPA loads `GET /api/me` once on mount (the
 * self-fetch half of the split read, D82). Only a `401`/`403` means "signed out",
 * which routes the user to the sign-in screen; every other failure — a network
 * blip, a scale-to-zero cold-start timeout, or a `5xx`/`503` while Book is down for
 * maintenance or in an outage (D118) — lands on the retryable `error` state after
 * one automatic retry, which renders the maintenance/outage screen rather than
 * bouncing an already-signed-in member through the whole Ghost flow (OFC-76, D118).
 */
export type SessionState =
  | { status: "loading" }
  | { status: "authenticated"; me: Me }
  /**
   * Signed out. `expired` marks the *mid-session* case — a session that was live
   * and then lapsed under us (a gated call came back 401, OFC-193) — so the
   * sign-in screen can explain the involuntary sign-out, distinct from a first-time
   * visitor who simply hasn't signed in yet.
   */
  | { status: "unauthenticated"; expired?: boolean }
  | { status: "error" };

/** Backoff before the single automatic retry of a transient `/api/me` failure. */
const REFRESH_RETRY_DELAY_MS = 1500;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * How long to wait for the re-auth child window before giving up. A still-valid Ghost
 * session re-bounces silently in a second or two (the common case — only Book's
 * session hit its 4-hour cap); the long ceiling covers the rare case where the Ghost
 * session also lapsed and the brother completes a magic-link sign-in in the popup.
 */
const REAUTH_TIMEOUT_MS = 3 * 60_000;

/** The unique window name that marks the re-auth popup (read by AuthCallback). */
export const REAUTH_WINDOW_NAME = "pbe-reauth";
/** The typed messages `/auth/callback` posts back to the opener (OFC-236). */
export const REAUTH_SUCCESS = "pbe-reauth-success";
export const REAUTH_FAILED = "pbe-reauth-failed";

/**
 * The D109 non-destructive re-auth (OFC-236). Opens a **child window** (not an iframe
 * — D107's `frame-ancestors` forecloses framing) to the Ghost bridge; the bridge
 * hands the fresh token to Book's own `/auth/callback`, which — seeing it has an
 * opener — re-establishes the `__session` cookie, posts a typed message back, and
 * closes (AuthCallback popup mode). The editor tab never navigates, so its in-memory
 * form is untouched and nothing lands on disk (D95). Resolves:
 *   - `true`  on the success message (or if the window closes and a `/api/me` probe
 *              now succeeds — the message was missed);
 *   - `false` if the popup is blocked, is dismissed without signing in, or times out —
 *              the caller then keeps the form and shows the "sign in on another tab"
 *              affordance (the popup fires after the Save round-trip, so a slow link
 *              can outrun the browser's user-gesture window and block it).
 */
async function runReauth(): Promise<boolean> {
  // Open the child window **first**, synchronously, before the `startSignIn` round-trip
  // — the popup already fires after the Save's fetch, so spending the network latency of
  // `startSignIn` before `window.open` would eat more of the browser's transient-user-
  // activation budget and get the popup blocked on exactly the slow links this audience
  // skews toward. Open a blank window now, then navigate it once the relay URL is minted.
  let popup: Window | null;
  try {
    popup = window.open("", REAUTH_WINDOW_NAME, "width=480,height=680");
  } catch {
    return false;
  }
  if (!popup) {
    return false;
  }
  const child = popup;
  try {
    const { signInUrl } = await startSignIn();
    child.location.href = signInUrl;
  } catch {
    child.close();
    return false;
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let pollId = 0;
    let timeoutId = 0;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      resolve(ok);
    };
    const onMessage = (event: MessageEvent) => {
      // Same-origin only: the message comes from our own `/auth/callback` (D104).
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data?.type === REAUTH_SUCCESS) {
        finish(true);
      } else if (event.data?.type === REAUTH_FAILED) {
        finish(false);
      }
    };
    window.addEventListener("message", onMessage);
    // Fallback signal: the window closed without a message (dismissed, or the message
    // was missed). Probe the session with a **raw** fetch — NOT `fetchMe`, whose 401
    // would fire the app-wide bounce (`onUnauthorized`) and destroy the very edit form
    // this recovery exists to preserve. A plain `res.ok` tells a completed re-auth from
    // a giving-up with no side effects.
    pollId = window.setInterval(() => {
      if (child.closed) {
        window.clearInterval(pollId);
        fetch("/api/me", { credentials: "same-origin" }).then(
          (res) => finish(res.ok),
          () => finish(false),
        );
      }
    }, 500);
    timeoutId = window.setTimeout(() => finish(false), REAUTH_TIMEOUT_MS);
  });
}

interface SessionContextValue {
  state: SessionState;
  /** Re-fetch `/api/me` (used after the callback completes a sign-in). */
  refresh: () => Promise<void>;
  /**
   * Patch the signed-in brother's own headshot pointer on `me.profile` in place —
   * called after they change their own photo — so the masthead avatar updates
   * immediately without a full `/api/me` refetch (which would flash the loading
   * state). A no-op unless authenticated with a loaded profile.
   */
  applyOwnHeadshot: (hasHeadshot: boolean, headshotVersion?: string) => void;
  /** Clear the Book session and return to the signed-out state. */
  signOut: () => Promise<void>;
  /**
   * Start "View as" impersonation, then hard-reload so the directory re-downloads
   * at the new projection (N31 — a soft `/api/me` refresh would leave the already-
   * fetched bulk dataset at the old role).
   */
  viewAs: (role: Role) => Promise<void>;
  /** Stop "View as" impersonation, then hard-reload back to the real role (N31). */
  stopViewingAs: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  // A ref mirror of the live status so the (identity-stable) 401 handler can read
  // the current state without being re-registered on every transition.
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  // A ref mirror of the effective (possibly-impersonated) role, so `stopViewingAs`
  // can record which role is being exited without closing over stale state (7a-4).
  const effectiveRoleRef = useRef<Role | null>(
    state.status === "authenticated" ? state.me.role : null,
  );
  effectiveRoleRef.current = state.status === "authenticated" ? state.me.role : null;

  // The app-wide 401 handler (OFC-193). A mid-session 401 means the cookie stopped
  // resolving to a live session — flip to signed-out and drop the cached roster from
  // the heap (D95), so the whole app (Directory, Profile, and any open Admin page)
  // falls to the sign-in screen at once. Gated on *was-authenticated*: a 401 during
  // the initial `/api/me` load is already handled by `refresh` below (and must not be
  // mislabeled an "expired" involuntary sign-out — the visitor was never signed in).
  const handleUnauthorized = useCallback(() => {
    if (statusRef.current !== "authenticated") {
      return;
    }
    clearRoster();
    // Drop the Mixpanel identity alongside the roster (7a-2). An expired session is
    // as much an end-of-session as the sign-out button, and on a shared machine the
    // next brother must not inherit this one's device id — see `resetIdentity`.
    resetIdentity();
    setState({ status: "unauthenticated", expired: true });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
    return () => setUnauthorizedHandler(null);
  }, [handleUnauthorized]);

  // The D109 non-destructive re-auth coordinator (OFC-236). A recovery-participating
  // call (the edit-form writes and the directory reads) that gets a mid-session 401
  // awaits this; on success it retries transparently. Deduped to a **single** popup so
  // concurrent 401s — a held Save, the roster read, and the images that failed with it
  // — all ride one re-auth. Gated on *was-authenticated*: a first-load 401 (handled by
  // `refresh`) must never spawn a popup, so it resolves `false` and the caller bounces.
  const reauthInFlight = useRef<Promise<boolean> | null>(null);
  const requestReauth = useCallback((): Promise<boolean> => {
    if (statusRef.current !== "authenticated") {
      return Promise.resolve(false);
    }
    if (reauthInFlight.current) {
      return reauthInFlight.current;
    }
    const attempt = runReauth().then((ok) => {
      if (ok) {
        // Re-arm the images that 401'd during the lapse so they reload (R18/D109).
        bumpReauthSignal();
      }
      return ok;
    });
    reauthInFlight.current = attempt;
    void attempt.finally(() => {
      // Identity-guard the clear so a settling attempt can't null out a newer in-flight
      // one that replaced it in a close microtask race.
      if (reauthInFlight.current === attempt) {
        reauthInFlight.current = null;
      }
    });
    return attempt;
  }, []);

  useEffect(() => {
    setReauthHandler(requestReauth);
    return () => setReauthHandler(null);
  }, [requestReauth]);

  const refresh = useCallback(async () => {
    setState({ status: "loading" });
    // Two attempts: a transient failure gets one automatic retry after a short
    // backoff before the retryable error screen is shown (OFC-76).
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const me = await fetchMe();
        setState({ status: "authenticated", me });
        return;
      } catch (error) {
        // Only a real auth failure (401/403) is a definitive "signed out" — no
        // retry, straight to the sign-in screen.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setState({ status: "unauthenticated" });
          return;
        }
        // Everything else is recoverable and must NOT force a re-login: a network
        // error, a cold-start timeout, or a 5xx/503 while Book is **down for
        // maintenance or in an outage** (D118 — a 503 must read as unavailable, not
        // as signed-out). Retry once, then surface the outage screen with a manual
        // retry (OFC-76 keeps an already-signed-in member out of the whole Ghost flow).
        if (attempt === 1) {
          await delay(REFRESH_RETRY_DELAY_MS);
          continue;
        }
        setState({ status: "error" });
      }
    }
  }, []);

  const applyOwnHeadshot = useCallback((hasHeadshot: boolean, headshotVersion?: string) => {
    setState((prev) => {
      if (prev.status !== "authenticated" || !prev.me.profile) {
        return prev;
      }
      // Destructure-omit `headshotVersion` (not `delete`) so a removal clears it.
      const { headshotVersion: _drop, ...rest } = prev.me.profile;
      const profile =
        headshotVersion === undefined
          ? { ...rest, hasHeadshot }
          : { ...rest, hasHeadshot, headshotVersion };
      return { status: "authenticated", me: { ...prev.me, profile } };
    });
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    // Drop the cached full-PII roster from the heap so it can't outlive the
    // session on a shared/family machine (OFC-118, D95).
    clearRoster();
    // Same reasoning, applied to analytics identity (7a-2, D138).
    resetIdentity();
    setState({ status: "unauthenticated" });
  }, []);

  const viewAs = useCallback(async (role: Role) => {
    await apiImpersonate(role);
    // On success only, and right before the reload — like `resetIdentity` on
    // sign-out, this is a session-transition analytics event owned here (7a-4). The
    // reload's pagehide flush delivers it (verified at live-test; no proxy yet, D140).
    trackViewAsStarted(role);
    window.location.reload();
  }, []);

  const stopViewingAs = useCallback(async () => {
    await apiStopImpersonating();
    const exited = effectiveRoleRef.current;
    if (exited) {
      trackViewAsEnded(exited);
    }
    window.location.reload();
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider
      value={{ state, refresh, applyOwnHeadshot, signOut, viewAs, stopViewingAs }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}
