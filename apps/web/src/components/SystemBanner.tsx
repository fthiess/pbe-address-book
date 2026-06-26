/** The site-wide admin-set banner (D117; DATABASE-SCHEMA §6.3 `SystemBanner`). */
export interface Banner {
  message: string;
  severity: "info" | "warning";
}

/**
 * The system-banner slot the app shell always renders. When an admin has set a
 * banner it shows site-wide for every role until cleared; otherwise it renders
 * nothing. The `GET /api/banner` source and the admin set/clear control land
 * with the Admin page in Phase 5 (D117) — for now the shell passes `null`, so
 * the slot exists and is wired but stays empty.
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
          ? "bg-destructive px-4 py-2 text-center text-sm font-medium text-destructive-foreground"
          : "bg-accent px-4 py-2 text-center text-sm font-medium text-accent-foreground"
      }
    >
      {banner.message}
    </div>
  );
}
