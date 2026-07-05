import { Link, Navigate } from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";
import { AdminCard, BugIcon, ComingLaterBadge, SyncIcon } from "./admin/AdminCard.js";
import { BackupCard } from "./admin/BackupCard.js";
import { BannerCard } from "./admin/BannerCard.js";

/**
 * The Admin control panel (`/admin`; PRD §5.8) — the whole-database operations
 * that stay online. Phase 5a-1 ships the live surfaces (Download backup and the
 * system-message banner) plus calm placeholders for the two whose backends land
 * later: Sync with Ghost (the reconciliation audit, Phase 5b) and Bug reports (the
 * review queue, Phase 5a-2).
 *
 * Admin-only. The server enforces admin on every admin endpoint, so this route
 * guard is UX: a non-admin — or an admin "viewing as" a lower role (effective
 * role, N31) — is redirected to the Directory rather than shown actions that would
 * 403. The parent GateLayout has already resolved the session, so this only reads it.
 */
export function Admin() {
  const { state } = useSession();
  if (state.status !== "authenticated" || state.me.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] text-[length:var(--text-label)] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true">←</span> Directory
      </Link>
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

        <AdminCard
          icon={<BugIcon />}
          title="Bug reports"
          badge={<ComingLaterBadge />}
          description="Reports members file with the “Report a bug” control will appear here for you to review. This arrives in a later update."
        />

        <BannerCard />
      </div>
    </div>
  );
}
