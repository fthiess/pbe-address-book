import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Banner } from "../components/SystemBanner.js";
import { fetchBanner } from "../lib/api.js";

/**
 * The site-wide system banner (D117), fetched once for the authenticated shell and
 * shared with the Admin page's set/clear control, so the masthead banner and the
 * Admin card read one source of truth: after an admin sets or clears the banner,
 * `refresh()` re-fetches and every page updates without a full reload.
 *
 * The read outcome is exposed as `status` (OFC-183): the masthead treats the banner
 * as non-essential chrome and simply renders nothing when it's absent, but the
 * **Admin control** must not confuse "the read failed" with "there is no banner" —
 * that would hide a live banner from the admin and disable its Clear button. So a
 * failed read surfaces as `status: "error"` (a retryable state in the card) rather
 * than being swallowed to `null`, and the last-known banner is kept so the masthead
 * doesn't flicker on a transient blip.
 */
export type BannerStatus = "loading" | "ready" | "error";

interface BannerContextValue {
  banner: Banner | null;
  status: BannerStatus;
  refresh: () => Promise<void>;
}

const BannerContext = createContext<BannerContextValue | null>(null);

export function BannerProvider({ children }: { children: ReactNode }) {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [status, setStatus] = useState<BannerStatus>("loading");

  // Deliberately does NOT reset `status` to "loading" on a refresh: the initial
  // mount is the only "loading" phase, so a post-set/clear re-fetch can't briefly
  // unmount the Admin form. On failure `banner` is left as-is (last-known), never
  // nulled, so the masthead is stable and the admin keeps what info it had.
  const refresh = useCallback(async () => {
    try {
      const state = await fetchBanner();
      setBanner(
        state.active && state.message
          ? { message: state.message, severity: state.severity ?? "info" }
          : null,
      );
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <BannerContext.Provider value={{ banner, status, refresh }}>{children}</BannerContext.Provider>
  );
}

export function useBanner(): BannerContextValue {
  const context = useContext(BannerContext);
  if (!context) {
    throw new Error("useBanner must be used within a BannerProvider");
  }
  return context;
}
