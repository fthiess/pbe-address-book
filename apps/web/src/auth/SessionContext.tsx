import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, signOut as apiSignOut, fetchMe } from "../lib/api.js";
import type { Me } from "../lib/types.js";

/**
 * The app-wide auth state. The SPA loads `GET /api/me` once on mount (the
 * self-fetch half of the split read, D82); a `401`/`403` means "signed out",
 * which routes the user to the sign-in screen.
 */
export type SessionState =
  | { status: "loading" }
  | { status: "authenticated"; me: Me }
  | { status: "unauthenticated" };

interface SessionContextValue {
  state: SessionState;
  /** Re-fetch `/api/me` (used after the callback completes a sign-in). */
  refresh: () => Promise<void>;
  /** Clear the Book session and return to the signed-out state. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setState({ status: "authenticated", me });
    } catch (error) {
      // 401/403 (or any load failure) lands the user on the sign-in screen.
      if (!(error instanceof ApiError)) {
        // A genuine network error is still "not signed in" for routing purposes.
      }
      setState({ status: "unauthenticated" });
    }
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    setState({ status: "unauthenticated" });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ state, refresh, signOut }}>
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
