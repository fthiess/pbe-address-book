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
 * it. It carries **Export** and **Copy Emails** (manager + admin) and, for admins,
 * **Add Brother**.
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
 * instead of a spreadsheet detour. **Three** ways it deliberately differs from
 * Export: it has **no whole-view fallback** (an empty selection explains itself
 * rather than mailing the entire brotherhood — that is what the mailing lists are
 * for); it **omits deceased and de-brothered brothers**, on the reasoning that
 * force-clears `allowNewsletterEmail` at mark-deceased (D80), since composing an
 * email is an outbound action; and it honours `privacy.shareEmail` at *every* role,
 * admins included, because a `To:` line publishes an address to the other
 * recipients in a way a downloaded CSV never does. The rules live in
 * `buildRecipientList` (`@pbe/shared`); read its module note before changing any of
 * them.
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
    // `relative` so the result notice can anchor to the bar's own bottom edge —
    // see CopyEmailsToast on why that beats a viewport-fixed position.
    <div className="relative mb-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
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
    </div>
  );
}

/**
 * The Copy Emails result notice (D167). Borrows `VersionToast`'s semantics — an
 * `<output>`, which carries an implicit `role="status"` polite live region, so
 * assistive tech announces it without focus being stolen — with no motion and a
 * 44px dismiss control.
 *
 * **It does not auto-dismiss**, deliberately. A timed disappearance is a time limit
 * on reading, which the a11y gate (D79) gives no reason to invent here; the notice
 * carries a count the user may well want to check against the grid, and a second
 * press of either action button replaces it anyway. `VersionToast` made the same
 * call, so the two behave alike.
 *
 * ⚠ **Positioned `absolute` against the action bar, NOT `fixed` to the viewport —
 * and that difference is the whole point (N163).** It lands just under the bar,
 * which is to say just below the top of the grid: close enough to the button that
 * pressed it to read as its answer, without covering the controls still in play.
 * Two viewport-fixed attempts each failed one end of the page — a top-percentage
 * offset covered the action bar at desktop width and the search box on a phone,
 * while the bottom edge stranded the notice a screen away from the button. Anchoring
 * to the bar is right at *every* viewport height and every amount of content above
 * it (banner, heading, filter panel, the phone's Options fold), with no magic number
 * to re-tune. `z-40` clears the grid's sticky header, which tops out at 22.
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
    <output className="absolute inset-x-0 top-full z-40 mt-2 flex justify-center px-4">
      {/* `items-center` centres the text against the dismiss control, and the button's
          `-my-2` lets its 44px hit area overhang the padding box instead of setting the
          notice's height. Without both, a one-line message rendered the same height as
          a two-line one with the text pinned to the top — which reads as a blank second
          line (OFC-391 live test). The 44px target itself is untouched. */}
      <div
        className={
          error
            ? "flex max-w-md items-center gap-3 rounded-[var(--radius-lg)] border border-destructive bg-card px-4 py-3 text-destructive shadow-[var(--shadow-popover-strong)]"
            : "flex max-w-md items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--gold-border-2)] bg-[var(--gold-bg-2)] px-4 py-3 text-[var(--gold-text-strong)] shadow-[var(--shadow-popover-strong)]"
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
              ? "-my-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-lg text-destructive hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              : "-my-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-lg text-[var(--gold-text-strong)] hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
