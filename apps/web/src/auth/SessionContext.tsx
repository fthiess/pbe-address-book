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
  | { status: "unauthenticated" }
  | { status: "error" };

/** Backoff before the single automatic retry of a transient `/api/me` failure. */
const REFRESH_RETRY_DELAY_MS = 1500;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
