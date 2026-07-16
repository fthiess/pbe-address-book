import { Bug, Download, MailWarning, Megaphone, RefreshCw } from "lucide-react";
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

// The Admin cards' icons are Lucide glyphs rendered at a shared 18px (the card
// chip's size), kept behind these thin semantic aliases so the consuming cards
// (BackupCard, GhostAuditCard, BugReportsCard, BounceReportCard, BannerCard)
// name the meaning, not the glyph, and the size lives in one place. Decorative —
// `aria-hidden`, the card's heading carries the accessible name.

/** Download tray + down arrow (backup). */
export function DownloadIcon() {
  return <Download size={18} aria-hidden="true" />;
}

/** Circular refresh arrows (Ghost reconciliation audit). */
export function SyncIcon() {
  return <RefreshCw size={18} aria-hidden="true" />;
}

/** A simple bug (bug reports). */
export function BugIcon() {
  return <Bug size={18} aria-hidden="true" />;
}

/** An envelope with a warning (email-bounce report). */
export function MailWarningIcon() {
  return <MailWarning size={18} aria-hidden="true" />;
}

/** A megaphone (system banner). */
export function MegaphoneIcon() {
  return <Megaphone size={18} aria-hidden="true" />;
}
