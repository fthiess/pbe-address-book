import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";
import { BackToDirectory, useDirectoryReturn } from "../components/BackToDirectory.js";
import { BackupCard } from "./admin/BackupCard.js";
import { BannerCard } from "./admin/BannerCard.js";
import { BounceReportCard } from "./admin/BounceReportCard.js";
import { BugReportsCard } from "./admin/BugReportsCard.js";
import { GhostAuditCard } from "./admin/GhostAuditCard.js";

/**
 * The Admin control panel (`/admin`; PRD §5.8) — the whole-database operations
 * that stay online. Live surfaces: Download backup, the system-message banner, and
 * (Phase 5a-2) the Bug-reports review queue, and (Phase 5b-2) the Book/Ghost
 * alignment audit and the email-bounce report — both download-only, read-only
 * reports (the audit changes nothing in Book; D103 as amended in 5b-2).
 *
 * Admin-only. The server enforces admin on every admin endpoint, so this route
 * guard is UX: a non-admin — or an admin "viewing as" a lower role (effective
 * role, N31) — is redirected to the Directory rather than shown actions that would
 * 403. The parent GateLayout has already resolved the session, so this only reads it.
 */
export function Admin() {
  const { state } = useSession();
  const location = useLocation();
  // If the admin opened this page from the Directory, "← Directory" pops the history
  // entry (like browser Back), so the Directory's search/sort/filter/scroll are
  // restored — matching the Profile page's ← Directory (N45). On a cold deep-link
  // (no such state) it is a real `<Link to="/">` escape hatch to a fresh Directory.
  //
  // The pop goes through the shared `useDirectoryReturn` (D169) rather than a local
  // `navigate(-1)`: a pop whose target has been pruned out of the session history is
  // a **silent** no-op, so the bare version leaves a button that visibly does
  // nothing. This page stashes no Directory URL, so its fallback is a clean
  // Directory — lossy, but a working control rather than a dead one.
  //
  // Hooks run before the admin guard below: an early return must not sit between
  // them, or the hook order changes with the session.
  const fromDirectory = (location.state as { fromDirectory?: boolean } | null)?.fromDirectory;
  const backToDirectory = useDirectoryReturn(fromDirectory ? 1 : 0);
  if (state.status !== "authenticated" || state.me.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <BackToDirectory onPop={fromDirectory ? backToDirectory : null} />
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

        <GhostAuditCard />

        <BounceReportCard />

        <BannerCard />

        {/* Bug reports last: it is the one variable-length section, so keeping it at
            the bottom means the fixed-length controls above never get pushed down an
            unpredictable amount by a long queue. */}
        <BugReportsCard />
      </div>
    </div>
  );
}
