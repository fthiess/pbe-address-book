import { type Role, profilesToCsv } from "@pbe/shared";
import { Link } from "react-router-dom";
import { notifyExport } from "../../lib/api.js";
import type { DirectoryProfile } from "../../lib/types.js";

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
 */
export interface ActionBarProps {
  role: Role;
  /** The current filtered/sorted view — the export's fallback scope. */
  rows: DirectoryProfile[];
  /** The selected brother ids (a subset of the current view). */
  selectedIds: ReadonlySet<number>;
}

export function ActionBar({ role, rows, selectedIds }: ActionBarProps) {
  const selectedCount = selectedIds.size;

  const onExport = () => {
    const scope = selectedCount > 0 ? "selection" : "view";
    const exportRows = selectedCount > 0 ? rows.filter((r) => selectedIds.has(r.id)) : rows;
    const csv = profilesToCsv(exportRows, role);
    downloadCsv(csv);
    void notifyExport(scope, exportRows.length);
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onExport}
        disabled={rows.length === 0}
        className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        Export CSV{selectedCount > 0 ? ` (${selectedCount} selected)` : ""}
      </button>

      {role === "admin" && (
        <Link
          to="/brother/new"
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
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pbe-directory-${date}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
