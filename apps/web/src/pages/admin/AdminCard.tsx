import type { ReactNode } from "react";

/** The filled primary action (Set banner) — brand teal, matching the app's precedent. */
export const ADMIN_BTN_PRIMARY =
  "inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-primary px-4 py-2 text-[length:var(--text-label)] font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/** The outlined secondary action (Download, Clear) — card surface with a border. */
export const ADMIN_BTN_SECONDARY =
  "inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-input bg-card px-4 py-2 text-[length:var(--text-label)] font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/**
 * A control card on the Admin page (PRD §5.8; visual-design `Admin.dc.html`): a
 * rounded surface with a tinted icon chip, a heading, an optional status badge, a
 * description, an optional right-aligned header action (e.g. a Download button),
 * and an optional body below the header (the banner form, a placeholder note).
 * Token-styled so it tracks light/dark; the icon is decorative (`aria-hidden`).
 */
export function AdminCard({
  icon,
  title,
  badge,
  description,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-card p-6 text-card-foreground shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-9 flex-shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-secondary text-primary"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[length:var(--text-h)] font-bold">{title}</h2>
            {badge}
          </div>
          {description && (
            <p className="mt-2 max-w-prose text-[length:var(--text-body-sm)] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="flex-shrink-0 self-center">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * A calm "not yet available" badge for the surfaces whose backend lands later
 * (Sync with Ghost → 5b; Bug reports → 5a-2). Deliberately understated for the
 * 60+ audience — a plain, muted pill, not a loud "Coming soon!".
 */
export function ComingLaterBadge({ children = "Not yet available" }: { children?: ReactNode }) {
  return (
    <span className="rounded-[var(--radius-pill)] border border-border bg-muted px-2.5 py-0.5 text-[length:var(--text-caption)] font-semibold text-muted-foreground">
      {children}
    </span>
  );
}

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Download tray + down arrow (backup). */
export function DownloadIcon() {
  return (
    <svg aria-hidden="true" {...ICON_PROPS}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/** Circular refresh arrows (Ghost reconciliation audit). */
export function SyncIcon() {
  return (
    <svg aria-hidden="true" {...ICON_PROPS}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

/** A simple bug (bug reports). */
export function BugIcon() {
  return (
    <svg aria-hidden="true" {...ICON_PROPS}>
      <path d="M8 2l1.5 1.5" />
      <path d="M16 2l-1.5 1.5" />
      <path d="M9 7a3 3 0 0 1 6 0v1H9z" />
      <rect x="7" y="8" width="10" height="10" rx="5" />
      <path d="M12 12v6" />
      <path d="M7 11H3" />
      <path d="M21 11h-4" />
      <path d="M7 16H4" />
      <path d="M20 16h-3" />
    </svg>
  );
}

/** A megaphone (system banner). */
export function MegaphoneIcon() {
  return (
    <svg aria-hidden="true" {...ICON_PROPS}>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l3.5 4V6L6 10H4a1 1 0 0 0-1 1z" />
      <path d="M9 10.5 20 5v14l-11-5.5" />
      <path d="M6 18v2" />
    </svg>
  );
}
