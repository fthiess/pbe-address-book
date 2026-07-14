import type { BannerSeverity } from "@pbe/shared";

/** The site-wide admin-set banner (D117; DATABASE-SCHEMA §6.3 `SystemBanner`). */
export interface Banner {
  message: string;
  severity: BannerSeverity;
}

/**
 * The system-banner slot the app shell always renders. When an admin has set a
 * banner it shows site-wide for every role until cleared; otherwise it renders
 * nothing. The `GET /api/banner` source + the admin set/clear control are wired
 * from Phase 5a-1 (D117).
 *
 * The message is deliberately set at 16px (`text-base`) semibold and centered so a
 * short notice reads clearly across the full width. Both severities carry the same
 * **symmetric** hairline rules top and bottom (`border-y`), differing only in colour
 * (OFC-240): **warning** takes the destructive red bg with a darker-red rule
 * (`--destructive-border`); **info** takes the brand **amber** (`--gold-bg-2`, the
 * design's announcement tint) with a gold rule (`--gold-border-2`). The rules make a
 * notice stand out from the page rather than blending into a neutral bar. The
 * masthead drops its own bottom border when a banner shows (AppShell), so the
 * banner's rules are the only lines at that seam.
 */
export function SystemBanner({ banner }: { banner: Banner | null }) {
  if (!banner) {
    return null;
  }
  const warning = banner.severity === "warning";
  return (
    <div
      // Announce a freshly-set banner without stealing focus.
      aria-live="polite"
      className={
        warning
          ? "border-y border-[var(--destructive-border)] bg-destructive px-4 py-2.5 text-center text-base font-semibold text-destructive-foreground"
          : "border-y border-[var(--gold-border-2)] bg-[var(--gold-bg-2)] px-4 py-2.5 text-center text-base font-semibold text-[var(--gold-text-strong)]"
      }
    >
      {banner.message}
    </div>
  );
}
