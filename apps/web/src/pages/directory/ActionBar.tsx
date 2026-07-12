import { type Role, profilesToCsv } from "@pbe/shared";
import { Link } from "react-router-dom";
import { notifyExport } from "../../lib/api.js";
import type { DirectoryProfile } from "../../lib/types.js";
import { saveBlob } from "../../lib/utils.js";

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

  const onExport = () => {
    const scope = hasSelection ? "selection" : "view";
    const exportRows = hasSelection ? selectedRows : viewRows;
    const csv = profilesToCsv(exportRows, role);
    downloadCsv(csv);
    void notifyExport(scope, exportRows.length);
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onExport}
        disabled={!hasSelection && viewRows.length === 0}
        className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        Export CSV{hasSelection ? ` (${selectedCount} selected)` : ""}
      </button>

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
  );
}

/** Build a timestamped filename and trigger a client-side CSV download. */
function downloadCsv(content: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  saveBlob(blob, `pbe-directory-${date}.csv`);
}
