import {
  type Role,
  buildRecipientList,
  canExportCsv,
  copyEmailsLimit,
  exceedsCopyEmailsLimit,
  profilesToCsv,
} from "@pbe/shared";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ControlHelp } from "../../components/ControlHelp.js";
import { trackEmailsCopied, trackExportPerformed } from "../../lib/analytics.js";
import { type ExportColumns, notifyExport } from "../../lib/api.js";
import type { DirectoryProfile } from "../../lib/types.js";
import { useDetailsAutoClose } from "../../lib/useDetailsAutoClose.js";
import { saveBlob } from "../../lib/utils.js";
import {
  CLIPBOARD_FAILURE,
  type CopyEmailsMessage,
  copyEmailsMessage,
  overLimitMessage,
} from "./copy-emails-message.js";
import { displayedColumnsToCsv } from "./displayed-csv.js";
import type { ColumnKey } from "./grid-model.js";

/**
 * How long a **successful** Copy Emails notice stays up before clearing itself
 * (N165; Forrest's call). Long enough to read two lines and glance at the grid to
 * check the count, and paused entirely while the notice is hovered or focused.
 * Errors are exempt — see `CopyEmailsToast`.
 */
const AUTO_DISMISS_MS = 10_000;

/**
 * The shared look of the bar's controls. Extracted when OFC-411 reordered the row
 * and OFC-403 turned one of them into a `<summary>`: four controls in a row that
 * must read as one set, across three element types (`button`, `summary`, `Link`),
 * is exactly the drift N149 caught in the "← Directory" control.
 */
const BUTTON_CLASS =
  "rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The action bar above the grid (§5.6.8, D41), shown to **every role** since
 * OFC-411 — it was staff-only, gated by the same predicate as the Select column,
 * until Copy Emails was opened to brothers. What each role gets is decided per
 * action rather than by hiding the bar: **Copy Emails** for everyone (capped for
 * brothers), **Export CSV** for managers and admins (`canExportCsv`), **Add
 * Brother** for admins. The bulk Delete and Regenerate-Thumbnails actions were
 * removed (D100/D114), so no destructive bulk action remains.
 *
 * **Button order is fixed by absolute position, not by which buttons exist**
 * (Forrest's call, OFC-411): Copy Emails, then Export, then Add Brother. A user
 * promoted to manager gains Export *to the right of* the Copy Emails he already
 * knew, and an admin gains Add Brother to the right of that — nothing he had
 * already learned moves. Rare as a promotion is, "View as" performs exactly this
 * role change several times a session, and the same reasoning applies to it. The
 * one control that appears and disappears — **Clear selection** — therefore sits
 * *last*, beyond every button, where it can shift nothing.
 *
 * Export is **client-side** (D41) and offers **two files** (OFC-403): the canonical
 * all-data CSV (§10, `profilesToCsv`) and the displayed-columns CSV
 * ({@link displayedColumnsToCsv}) — the columns on screen, as they read. Both
 * serialize the in-memory, already-projected rows (the current selection, or the
 * whole current view when nothing is selected), trigger the download, then fire the
 * audit ping (D92) carrying which of the two ran. Images are never included.
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
 * them — including the OFC-411 cap, which that note explains and this component
 * only enforces.
 *
 * ⚠ **A brother's tallies mean something slightly different from a staffer's**, and
 * that is accepted rather than fixed. His projection omits `email` outright for a
 * brother with `shareEmail` off, and omits `privacy` altogether, so those records
 * reach `buildRecipientList` looking like records with no address and are reported
 * as "no email address" rather than "kept private". The exclusion is correct either
 * way; only the reason he reads is coarser, and it is coarser precisely because the
 * projection refuses to tell him which it was.
 */
export interface ActionBarProps {
  role: Role;
  /** The current filtered/sorted view — the export's fallback when nothing is selected. */
  viewRows: DirectoryProfile[];
  /** The lens's visible data columns, in the user's order — the displayed export's column set. */
  visibleColumns: readonly ColumnKey[];
  /** Resolves a row's Canonical Name, for the displayed export's Name column. */
  nameOf: (profile: DirectoryProfile) => string;
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
  visibleColumns,
  nameOf,
  selectedRows,
  selectedCount,
  onClear,
}: ActionBarProps) {
  const hasSelection = selectedCount > 0;
  const [message, setMessage] = useState<CopyEmailsMessage | null>(null);
  // Stable, so the notice's auto-dismiss timer is not restarted by every re-render
  // of this bar (a new closure in the dependency array would reset it forever).
  const dismissMessage = useCallback(() => setMessage(null), []);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  useDetailsAutoClose(exportMenu);
  // Nothing selected and nothing in view — a filter that matched no one. Both
  // exports would write a header row and no brothers.
  const nothingToExport = !hasSelection && viewRows.length === 0;

  const onExport = (columns: ExportColumns) => {
    // A menu item's click leaves the disclosure open; close it, so the download
    // isn't delivered behind a panel the user then has to dismiss.
    if (exportMenu.current) {
      exportMenu.current.open = false;
    }
    // A Copy Emails toast left standing over an export would read as this export's
    // result. Clear it first.
    setMessage(null);
    const scope = hasSelection ? "selection" : "view";
    const exportRows = hasSelection ? selectedRows : viewRows;
    const csv =
      columns === "all"
        ? profilesToCsv(exportRows, role)
        : displayedColumnsToCsv(exportRows, visibleColumns, nameOf);
    downloadCsv(csv, columns);
    void notifyExport(scope, exportRows.length, columns);
    // Usage-shape view alongside the D92 security audit ping (7a-4): scope + a
    // bucketed row count, never the exported rows. Guarded on a non-empty export: a
    // stale selection whose brothers were all deleted mid-session leaves the button
    // enabled with zero rows (ActionBar's own selectedCount-vs-selectedRows caveat),
    // and a zero-row export is a no-op, not a usage event — the guard also keeps a 0
    // out of rowCountBucket.
    if (exportRows.length > 0) {
      trackExportPerformed(scope, exportRows.length, columns);
    }
  };

  const onCopyEmails = async () => {
    // The cap is asked of the **raw selection count**, before a list is built — it
    // limits how far one press reaches, not how many addresses it yields (OFC-411;
    // the reasoning is in `email-recipients.ts`). Refusing here also means the
    // clipboard is never touched, so whatever the user had is still there.
    const limit = copyEmailsLimit(role);
    if (limit !== null && exceedsCopyEmailsLimit(role, selectedCount)) {
      setMessage(overLimitMessage(selectedCount, limit));
      return;
    }
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
        {/* Deliberately NOT disabled with an empty selection: the ticket asks for an
          explanation, and a disabled control explains nothing. */}
        <div className="inline-flex items-center gap-1.5">
          <button type="button" onClick={() => void onCopyEmails()} className={BUTTON_CLASS}>
            Copy Emails{hasSelection ? ` (${selectedCount} selected)` : ""}
          </button>
          <ControlHelp entryKey="directory.copyEmails" />
        </div>

        {canExportCsv(role) && (
          <div className="inline-flex items-center gap-1.5">
            {nothingToExport ? (
              // With no rows in view and nothing selected there is no file to offer,
              // so the control stays the plain disabled button it has always been in
              // that state. A disclosure that opens onto two dead items would be a
              // worse answer to "why can't I press this" than a disabled button.
              <button type="button" disabled className={BUTTON_CLASS}>
                Export CSV
              </button>
            ) : (
              <details ref={exportMenu} className="relative">
                <summary
                  className={`flex cursor-pointer list-none items-center gap-1.5 ${BUTTON_CLASS} [&::-webkit-details-marker]:hidden`}
                >
                  Export CSV{hasSelection ? ` (${selectedCount} selected)` : ""}
                  <ChevronDown size={15} strokeWidth={1.4} aria-hidden="true" />
                </summary>
                {/* z-30 clears the grid's sticky header (z-22), matching the Columns
                  picker and the avatar menu. Left-anchored, not right: this menu
                  hangs off the second control in a left-aligned row, so a
                  right-anchored panel would drift away from its own trigger. */}
                <div className="absolute left-0 z-30 mt-2 w-72 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                  <ExportChoice
                    title="Export displayed columns"
                    detail="The columns you have on screen now, as you see them."
                    onSelect={() => onExport("displayed")}
                  />
                  <ExportChoice
                    title="Export all data"
                    detail="Every field your role can see — the full spreadsheet."
                    onSelect={() => onExport("all")}
                  />
                </div>
              </details>
            )}
            <ControlHelp entryKey="directory.export" />
          </div>
        )}

        {role === "admin" && (
          <Link to="/brother/new" state={{ fromDirectory: true }} className={BUTTON_CLASS}>
            Add Brother
          </Link>
        )}

        {/* Last, beyond every button — it is the one control that comes and goes, so
          anywhere earlier it would shift the buttons on either side of a tick. */}
        {hasSelection && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear selection
          </button>
        )}
      </div>

      {message && <CopyEmailsToast message={message} onDismiss={dismissMessage} />}
    </div>
  );
}

/**
 * One item in the Export menu (OFC-403): a title and the line that tells the two
 * files apart. The detail is inside the button rather than beside it so the whole
 * two-line block is one target — 44px tall without arithmetic — and so a screen
 * reader hears the distinction as part of the item's name rather than as loose text
 * it may never reach.
 */
function ExportChoice({
  title,
  detail,
  onSelect,
}: {
  title: string;
  detail: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="block w-full rounded-lg px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}

/**
 * The Copy Emails result notice (D167). Borrows `VersionToast`'s semantics — an
 * `<output>`, which carries an implicit `role="status"` polite live region, so
 * assistive tech announces it without focus being stolen — with no motion and a
 * 44px dismiss control.
 *
 * **A success notice clears itself after {@link AUTO_DISMISS_MS}; an error notice
 * never does** (N165). The a11y objection to a self-clearing message is that it
 * imposes a time limit on reading (SC 2.2.1) — but a *status message* is governed by
 * SC 4.1.3, which the live region already satisfies in full: a screen reader is
 * given the entire text the moment it appears, however briefly it is on screen. The
 * only reader actually at risk is a sighted slow one, and the fix for that is to
 * **pause the countdown on hover and on focus**, which is what `paused` does — not
 * to leave the notice standing forever. An error is different in kind: it reports
 * that the copy did *not* happen, so it waits to be acknowledged.
 *
 * ⚠ **The timer restarts in full when the pointer or focus leaves**, rather than
 * resuming a remainder. That is deliberate: tracking elapsed time across pauses buys
 * a nicety nobody can perceive, at the cost of state that has to stay correct across
 * re-renders and message changes.
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
  const [paused, setPaused] = useState(false);

  // `message` is in the dependency list as a **re-run trigger**, not as a value the
  // effect reads — which is why the linter is suppressed rather than obeyed here.
  // Two presses in a row can produce messages of the same `tone`, so `error` does
  // not change and the countdown would not restart: the second notice would inherit
  // the first's remaining time and vanish early. Dropping it is a real bug.
  // biome-ignore lint/correctness/useExhaustiveDependencies: message re-runs the timer; see above
  useEffect(() => {
    // An error waits to be acknowledged; a hovered or focused notice is being read.
    if (error || paused) {
      return;
    }
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [error, paused, onDismiss, message]);

  return (
    <output
      className="absolute inset-x-0 top-full z-40 mt-2 flex justify-center px-4"
      // Pointer *and* keyboard: React's onFocus/onBlur map to focusin/focusout, so
      // they fire for the dismiss button inside. Without the focus half, tabbing to
      // the button could have it vanish under the user's hands.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
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

/**
 * Build a timestamped filename and trigger a client-side CSV download. The two
 * exports get **different names** (OFC-403) so a Downloads folder holding both
 * still says which is which — and so the browser doesn't quietly rename the second
 * one `(1)`, which says nothing at all.
 */
function downloadCsv(content: string, columns: ExportColumns): void {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const stem = columns === "all" ? "pbe-directory" : "pbe-directory-columns";
  saveBlob(blob, `${stem}-${date}.csv`);
}
