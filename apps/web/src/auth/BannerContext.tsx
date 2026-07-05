import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Banner } from "../components/SystemBanner.js";
import { fetchBanner } from "../lib/api.js";

/**
 * The site-wide system banner (D117), fetched once for the authenticated shell and
 * shared with the Admin page's set/clear control. Kept in its own small context —
 * separate from the session — so the masthead banner and the Admin card read one
 * source of truth: after an admin sets or clears the banner, `refresh()` re-fetches
 * and every page updates without a full reload. A failed fetch is swallowed to
 * `null` (no banner) so a banner outage can never block the directory.
 */
interface BannerContextValue {
  banner: Banner | null;
  refresh: () => Promise<void>;
}

const BannerContext = createContext<BannerContextValue | null>(null);

export function BannerProvider({ children }: { children: ReactNode }) {
  const [banner, setBanner] = useState<Banner | null>(null);

  const refresh = useCallback(async () => {
    try {
      const state = await fetchBanner();
      setBanner(
        state.active && state.message
          ? { message: state.message, severity: state.severity ?? "info" }
          : null,
      );
    } catch {
      // The banner is non-essential chrome; a failed fetch shows nothing rather
      // than surfacing an error or blocking the page.
      setBanner(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <BannerContext.Provider value={{ banner, refresh }}>{children}</BannerContext.Provider>;
}

export function useBanner(): BannerContextValue {
  const context = useContext(BannerContext);
  if (!context) {
    throw new Error("useBanner must be used within a BannerProvider");
  }
  return context;
}
