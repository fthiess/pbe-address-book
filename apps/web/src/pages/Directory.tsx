import { formatClassYear, resolveCanonicalNames } from "@pbe/shared";
import { useQueryState } from "nuqs";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "../auth/SessionContext.js";
import { Avatar } from "../components/Avatar.js";
import { LoadingOverlay } from "../components/LoadingOverlay.js";
import { fetchProfiles } from "../lib/api.js";
import type { DirectoryProfile } from "../lib/types.js";
import { useDelayedFlag } from "../lib/useDelayedFlag.js";

/** A class-year token, rendering the unknown (null) case as `'??` (§4). */
function classYearLabel(classYear: number | null): string {
  return classYear === null ? "'??" : formatClassYear(classYear);
}

/**
 * The directory list — the walking-skeleton render of every (visible) brother
 * (Phase 1b gate). It is a plain accessible table, deliberately not the full
 * Directory: the pinned/reorderable columns, virtualization, fuzzy/phonetic
 * search, stars, and filters are Phase 3. A simple name search (URL-synced via
 * nuqs) is included to exercise the routing/query-state wiring.
 *
 * Canonical Names are derived client-side from the in-memory dataset via the
 * shared `resolveCanonicalNames` (one O(n) ambiguity pass, §5.1) — never stored.
 */
export function Directory() {
  const { state } = useSession();
  const myId = state.status === "authenticated" ? state.me.profileId : null;

  const [profiles, setProfiles] = useState<DirectoryProfile[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useQueryState("q", { defaultValue: "" });

  // Resolve every visible brother's Canonical Name in one pass when the dataset
  // arrives; a name is then an O(1) lookup keyed by Constitution ID.
  const names = useMemo(() => resolveCanonicalNames(profiles ?? []), [profiles]);
  const nameOf = (p: DirectoryProfile): string => names.get(p.id) ?? `${p.firstName} ${p.lastName}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchProfiles(controller.signal)
      .then((response) => setProfiles(response.profiles))
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
        }
      });
    return () => controller.abort();
  }, []);

  const loading = profiles === null && !error;
  const showOverlay = useDelayedFlag(loading, 500);

  if (error) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        We couldn't load the directory just now. Please refresh to try again.
      </p>
    );
  }

  const term = q.trim().toLowerCase();
  const rows = (profiles ?? []).filter(
    (p) => term === "" || nameOf(p).toLowerCase().includes(term),
  );

  return (
    <section aria-labelledby="directory-heading">
      {showOverlay && <LoadingOverlay />}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="directory-heading" className="text-xl font-bold tracking-tight">
            Directory
          </h1>
          {profiles && (
            <p className="text-sm text-muted-foreground">
              {rows.length} of {profiles.length} brothers
            </p>
          )}
        </div>
        <div className="w-full sm:w-64">
          <label htmlFor="directory-search" className="sr-only">
            Search brothers by name
          </label>
          <input
            id="directory-search"
            type="search"
            value={q}
            onChange={(event) => void setQ(event.target.value)}
            placeholder="Search by name…"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {profiles && rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No brothers match “{q}”.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Brothers in the PBE directory</caption>
            <thead>
              <tr className="bg-secondary text-left text-secondary-foreground">
                <th scope="col" className="px-4 py-2 font-semibold">
                  Name
                </th>
                <th scope="col" className="px-4 py-2 font-semibold">
                  Class
                </th>
                <th scope="col" className="px-4 py-2 font-semibold">
                  Email
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border even:bg-card/50">
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={nameOf(p)} size={30} />
                      <span className="font-medium">{nameOf(p)}</span>
                      {p.id === myId && (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">
                          You
                        </span>
                      )}
                      {p.deceased.isDeceased && (
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          In Memoriam
                        </span>
                      )}
                    </span>
                  </th>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">
                    {classYearLabel(p.classYear)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {p.email ? (
                      <a className="underline-offset-2 hover:underline" href={`mailto:${p.email}`}>
                        {p.email}
                      </a>
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
