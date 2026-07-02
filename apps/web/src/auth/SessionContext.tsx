import type { Role } from "@pbe/shared";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  ApiError,
  impersonate as apiImpersonate,
  signOut as apiSignOut,
  stopImpersonating as apiStopImpersonating,
  fetchMe,
} from "../lib/api.js";
import type { Me } from "../lib/types.js";
import { clearRoster } from "../lib/useRoster.js";

/**
 * The app-wide auth state. The SPA loads `GET /api/me` once on mount (the
 * self-fetch half of the split read, D82). A `401`/`403` means "signed out",
 * which routes the user to the sign-in screen; a *transient* failure (a network
 * blip or a scale-to-zero cold-start timeout) instead lands on the retryable
 * `error` state after one automatic retry, rather than bouncing an already
 * signed-in member through the whole Ghost flow (OFC-76).
 */
export type SessionState =
  | { status: "loading" }
  | { status: "authenticated"; me: Me }
  | { status: "unauthenticated" }
  | { status: "error" };

/** Backoff before the single automatic retry of a transient `/api/me` failure. */
const REFRESH_RETRY_DELAY_MS = 1500;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface SessionContextValue {
  state: SessionState;
  /** Re-fetch `/api/me` (used after the callback completes a sign-in). */
  refresh: () => Promise<void>;
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
        // A real auth failure (401/403, carried as ApiError) is a definitive
        // "signed out" — no retry, straight to the sign-in screen.
        if (error instanceof ApiError) {
          setState({ status: "unauthenticated" });
          return;
        }
        // A non-ApiError is a network error or a cold-start timeout — recoverable.
        // Retry once, then surface the error state (which offers a manual retry)
        // instead of forcing a full Ghost re-login on a momentary blip.
        if (attempt === 1) {
          await delay(REFRESH_RETRY_DELAY_MS);
          continue;
        }
        setState({ status: "error" });
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    // Drop the cached full-PII roster from the heap so it can't outlive the
    // session on a shared/family machine (OFC-118, D95).
    clearRoster();
    setState({ status: "unauthenticated" });
  }, []);

  const viewAs = useCallback(async (role: Role) => {
    await apiImpersonate(role);
    window.location.reload();
  }, []);

  const stopViewingAs = useCallback(async () => {
    await apiStopImpersonating();
    window.location.reload();
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ state, refresh, signOut, viewAs, stopViewingAs }}>
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
