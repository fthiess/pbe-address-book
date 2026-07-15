import { type ReactNode, createContext, useContext } from "react";
import { type Stars, useStarsState } from "./useStars.js";

/**
 * The viewer's personal **star set**, hosted once above the routes (OFC-256).
 *
 * Stars were originally Directory-local state (`useStars` inside the Directory
 * page), which meant the Profile page — a sibling route under the authenticated
 * gate, not a Directory child — had no way to show or toggle a brother's star.
 * Hoisting the set into a per-instance context on the shell (mirroring
 * {@link SelectionProvider}, N79/OFC-196) gives both surfaces one source of truth:
 * a star toggled on a Profile is reflected on the Directory the moment the user
 * navigates back, with no reload.
 *
 * The set is private, transient, session-scoped state (D31's fourth bucket): never
 * in a shared link, dropped on a full reload or in a new tab, and it must outlive
 * the Directory's remount on navigation. The provider sits inside the gate, so a
 * sign-out unmounts it and clears the set for free. It seeds from the caller's own
 * `/api/me` stars, delivered with the session (D39).
 */
const StarsCtx = createContext<Stars | null>(null);

export function StarsProvider({
  initial,
  children,
}: {
  /** The viewer's starred ids from the session (`/api/me`), read once at mount. */
  initial: readonly number[];
  children: ReactNode;
}) {
  const stars = useStarsState(initial);
  return <StarsCtx.Provider value={stars}>{children}</StarsCtx.Provider>;
}

export function useStars(): Stars {
  const ctx = useContext(StarsCtx);
  if (!ctx) {
    throw new Error("useStars must be used within a StarsProvider");
  }
  return ctx;
}
