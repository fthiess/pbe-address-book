import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";
import { AdminCard, ComingLaterBadge, SyncIcon } from "./admin/AdminCard.js";
import { BackupCard } from "./admin/BackupCard.js";
import { BannerCard } from "./admin/BannerCard.js";
import { BugReportsCard } from "./admin/BugReportsCard.js";

/** Shared styling for the "← Directory" affordance, whether button or link. */
const BACK_CLASS =
  "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] text-[length:var(--text-label)] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The Admin control panel (`/admin`; PRD §5.8) — the whole-database operations
 * that stay online. Live surfaces: Download backup, the system-message banner, and
 * (Phase 5a-2) the Bug-reports review queue. Sync with Ghost stays a calm
 * placeholder until its backend lands (the reconciliation audit, Phase 5b).
 *
 * Admin-only. The server enforces admin on every admin endpoint, so this route
 * guard is UX: a non-admin — or an admin "viewing as" a lower role (effective
 * role, N31) — is redirected to the Directory rather than shown actions that would
 * 403. The parent GateLayout has already resolved the session, so this only reads it.
 */
export function Admin() {
  const { state } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  if (state.status !== "authenticated" || state.me.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  // If the admin opened this page from the Directory, "← Directory" pops the history
  // entry (like browser Back), so the Directory's search/sort/filter/scroll are
  // restored — matching the Profile page's ← Directory (N45). On a cold deep-link
  // (no such state) it is a real `<Link to="/">` escape hatch to a fresh Directory.
  const fromDirectory = (location.state as { fromDirectory?: boolean } | null)?.fromDirectory;

  return (
    <div className="mx-auto w-full max-w-3xl">
      {fromDirectory ? (
        <button type="button" onClick={() => navigate(-1)} className={BACK_CLASS}>
          <span aria-hidden="true">←</span> Directory
        </button>
      ) : (
        <Link to="/" className={BACK_CLASS}>
          <span aria-hidden="true">←</span> Directory
        </Link>
      )}
      <header className="mt-4 mb-6">
        <h1 className="text-[length:var(--text-display)] font-bold tracking-tight">
          Administrative Tools
        </h1>
        <p className="mt-2 max-w-prose text-[length:var(--text-body)] text-muted-foreground">
          Whole-database operations and site-wide controls. These stay available while the rest of
          the directory is online.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        <BackupCard />

        <AdminCard
          icon={<SyncIcon />}
          title="Sync with Ghost (PBE News)"
          badge={<ComingLaterBadge />}
          description="Reconciles Book against the membership list on PBE News and reports any differences for review. This arrives with the Ghost integration in a later update."
        />

        <BannerCard />

        {/* Bug reports last: it is the one variable-length section, so keeping it at
            the bottom means the fixed-length controls above never get pushed down an
            unpredictable amount by a long queue. */}
        <BugReportsCard />
      </div>
    </div>
  );
}
