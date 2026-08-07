import { type Role, buildRecipientList, profilesToCsv } from "@pbe/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ControlHelp } from "../../components/ControlHelp.js";
import { trackEmailsCopied, trackExportPerformed } from "../../lib/analytics.js";
import { notifyExport } from "../../lib/api.js";
import type { DirectoryProfile } from "../../lib/types.js";
import { saveBlob } from "../../lib/utils.js";
import {
  CLIPBOARD_FAILURE,
  type CopyEmailsMessage,
  copyEmailsMessage,
} from "./copy-emails-message.js";

/**
 * The manager/administrator action bar above the grid (§5.6.8, D41). Gated by the
 * same capability predicate as the Select column, so ordinary brothers never see
 * it. It carries **Export** (manager + admin) and, for admins, **Add Brother**.
 * The bulk Delete and Regenerate-Thumbnails actions were removed (D100/D114), so
 * no destructive bulk action remains.
 *
 * Export is **client-side** (D41): it serializes the in-memory, already-projected
 * rows — the current selection, or the whole current view when nothing is
 * selected — to the canonical CSV (§10), triggers the download, then fires the
 * audit ping (D92). Images are never included.
 *
 * Since a selection now persists across filters (N79/OFC-196), the export scope is
 * the **whole selected set** — resolved over the full dataset upstream, not just
 * the current view — so a disjoint selection built across several filters exports
 * in full. A persistent selection can also be entirely off-screen, so the bar
 * carries an always-visible count and a **Clear** control: the selection is never
 * silently driving an export the user can't see.
 *
 * **Copy Emails** (D167; OFC-391) sits beside Export and serves the workflow Export
 * only half-served: filter to a subset, select it, and get a pasteable `To:` line
 * instead of a spreadsheet detour. Two ways it deliberately differs from Export:
 * it has **no whole-view fallback** (an empty selection explains itself rather than
 * mailing the entire brotherhood — that is what the mailing lists are for), and it
 * honours `privacy.shareEmail` at *every* role, admins included, because a `To:`
 * line publishes an address to the other recipients in a way a downloaded CSV never
 * does. The rules live in `buildRecipientList` (`@pbe/shared`); read its module note
 * before changing any of them.
 */
export interface ActionBarProps {
  role: Role;
  /** The current filtered/sorted view — the export's fallback when nothing is selected. */
  viewRows: DirectoryProfile[];
  /** The full selected set across the dataset, already resolved and sorted (may span filters). */
  selectedRows: DirectoryProfile[];
  /** The raw count of selected ids — the count shown and the Clear affordance's gate. It may
   *  exceed `selectedRows.length` if a selected brother was deleted mid-session; the count and
   *  Clear track the raw set so a non-empty selection is always visible and clearable. */
  selectedCount: number;
  /** Clear the entire selection, including any off-view picks. */
  onClear: () => void;
}

export function ActionBar({
  role,
  viewRows,
  selectedRows,
  selectedCount,
  onClear,
}: ActionBarProps) {
  const hasSelection = selectedCount > 0;
  const [message, setMessage] = useState<CopyEmailsMessage | null>(null);

  const onExport = () => {
    // A Copy Emails toast left standing over an export would read as this export's
    // result. Clear it first.
    setMessage(null);
    const scope = hasSelection ? "selection" : "view";
    const exportRows = hasSelection ? selectedRows : viewRows;
    const csv = profilesToCsv(exportRows, role);
    downloadCsv(csv);
    void notifyExport(scope, exportRows.length);
    // Usage-shape view alongside the D92 security audit ping (7a-4): scope + a
    // bucketed row count, never the exported rows. Guarded on a non-empty export: a
    // stale selection whose brothers were all deleted mid-session leaves the button
    // enabled with zero rows (ActionBar's own selectedCount-vs-selectedRows caveat),
    // and a zero-row export is a no-op, not a usage event — the guard also keeps a 0
    // out of rowCountBucket.
    if (exportRows.length > 0) {
      trackExportPerformed(scope, exportRows.length);
    }
  };

  const onCopyEmails = async () => {
    const list = buildRecipientList(selectedRows);
    // Nothing to write is not a clipboard failure — say so and leave whatever the
    // user already had on their clipboard alone, rather than blanking it.
    if (list.copied === 0) {
      setMessage(copyEmailsMessage(selectedCount, list));
      return;
    }
    try {
      await navigator.clipboard.writeText(list.text);
    } catch {
      // Insecure context, or the browser refused. Unlike the bug-report copy, this
      // must surface: a silent failure leaves the *previous* clipboard contents in
      // place and the user pastes those into an email without ever knowing.
      setMessage(CLIPBOARD_FAILURE);
      return;
    }
    setMessage(copyEmailsMessage(selectedCount, list));
    // The same D92 audit ping the CSV export fires, under its own scope — this is
    // bulk PII egress with no other server-side trace. Fire-and-forget.
    void notifyExport("clipboard", list.copied);
    const skipped = list.skippedNoEmail + list.skippedPrivate + list.skippedNotLiving;
    trackEmailsCopied(list.copied, skipped > 0);
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Each button + its ? is one tight unit (gap-1.5); the parent's gap-x-6 sets
          the units apart. The 4:1 ratio is deliberate and was OFC-391's explicit
          request — with two adjacent `?` controls, a narrower parent gap leaves it
          genuinely unclear which tip belongs to which button. */}
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={onExport}
            disabled={!hasSelection && viewRows.length === 0}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV{hasSelection ? ` (${selectedCount} selected)` : ""}
          </button>
          <ControlHelp entryKey="directory.export" />
        </div>

        {/* Deliberately NOT disabled with an empty selection: the ticket asks for an
          explanation, and a disabled control explains nothing. */}
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void onCopyEmails()}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            Copy Emails{hasSelection ? ` (${selectedCount} selected)` : ""}
          </button>
          <ControlHelp entryKey="directory.copyEmails" />
        </div>

        {hasSelection && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear selection
          </button>
        )}

        {role === "admin" && (
          <Link
            to="/brother/new"
            state={{ fromDirectory: true }}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            Add Brother
          </Link>
        )}
      </div>

      {message && <CopyEmailsToast message={message} onDismiss={() => setMessage(null)} />}
    </>
  );
}

/**
 * The Copy Emails result notice (D167). Follows `VersionToast`: a fixed, centred
 * `<output>` — which carries an implicit `role="status"` polite live region, so
 * assistive tech announces it without focus being stolen — with no motion and a
 * 44px dismiss control.
 *
 * **It does not auto-dismiss**, deliberately. A timed disappearance is a time limit
 * on reading, which the a11y gate (D79) gives no reason to invent here; the notice
 * carries a count the user may well want to check against the grid, and a second
 * press of either action button replaces it anyway. `VersionToast` made the same
 * call, so the two behave alike.
 *
 * **Anchored to the bottom**, unlike `VersionToast`, whose comment records that the
 * bottom edge was "easy to miss" and moved it to a fifth of the way down. That
 * finding does not transfer: `VersionToast` is an unsolicited announcement nobody
 * asked for, so it has to catch the eye, while this one answers a button the user
 * just pressed and is already waiting on. At the top it *covers the action bar* at
 * desktop width and the search box on a phone — obscuring the controls in play to
 * report on them — which is plainly worse than being a little quieter.
 */
function CopyEmailsToast({
  message,
  onDismiss,
}: {
  message: CopyEmailsMessage;
  onDismiss: () => void;
}) {
  const error = message.tone === "error";
  return (
    <output className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        className={
          error
            ? "flex max-w-md items-start gap-3 rounded-[var(--radius-lg)] border border-destructive bg-card px-4 py-3 text-destructive shadow-[var(--shadow-popover-strong)]"
            : "flex max-w-md items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--gold-border-2)] bg-[var(--gold-bg-2)] px-4 py-3 text-[var(--gold-text-strong)] shadow-[var(--shadow-popover-strong)]"
        }
      >
        <div className="text-sm">
          <p className="font-semibold">{message.headline}</p>
          {message.detail && <p className="mt-1">{message.detail}</p>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={
            error
              ? "inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-lg text-destructive hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              : "inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-lg text-[var(--gold-text-strong)] hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          }
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </output>
  );
}

/** Build a timestamped filename and trigger a client-side CSV download. */
function downloadCsv(content: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  saveBlob(blob, `pbe-directory-${date}.csv`);
}
