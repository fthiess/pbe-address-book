import { useId, useMemo } from "react";
import { Link } from "react-router-dom";
import { Combobox } from "../../components/Combobox.js";
import type { DirectoryProfile } from "../../lib/types.js";
import { Section } from "./fields.js";
import { littleBrothers, rosterNames } from "./relationships.js";

/**
 * The Relationships editor (§5.7.4, D46). **Big Brother** is set through a
 * typeahead {@link Combobox} searching the brotherhood by Canonical Name (self
 * excluded); the chosen brother shows as a chip linking to his profile, clearable.
 * The existence and **no-cycle** rules are server-authoritative (a loop comes back
 * as a plain inline error on Save — DATABASE-SCHEMA §8). The **derived Little
 * Brothers** — the brothers who name this one as their Big Brother — render
 * read-only beneath, each a link; they are free from the in-memory dataset and
 * never stored.
 */
export function RelationshipsEditor({
  selfId,
  roster,
  rosterError,
  bigBrotherId,
  onChange,
  error,
}: {
  selfId: number;
  roster: DirectoryProfile[] | null;
  rosterError: boolean;
  bigBrotherId: number | null | undefined;
  onChange: (id: number | null) => void;
  error?: string;
}) {
  const errorId = useId();
  const names = useMemo(() => (roster ? rosterNames(roster) : null), [roster]);
  const littles = useMemo(
    () => (roster && names ? littleBrothers(roster, names, selfId) : []),
    [roster, names, selfId],
  );

  const options = useMemo(() => {
    if (!roster || !names) {
      return [];
    }
    return roster
      .filter((p) => p.id !== selfId && p.id !== bigBrotherId)
      .map((p) => ({
        value: String(p.id),
        label: names.get(p.id) ?? `#${p.id}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [roster, names, selfId, bigBrotherId]);

  const bigBrotherName =
    bigBrotherId != null ? (names?.get(bigBrotherId) ?? `#${bigBrotherId}`) : null;

  return (
    <Section title="Relationships">
      <div>
        <p className="mb-1 block text-[length:var(--text-label)] font-semibold">Big Brother</p>
        {rosterError ? (
          <p className="text-[length:var(--text-body-sm)] text-muted-foreground">
            The brotherhood list couldn't load, so the Big Brother picker is unavailable right now.
          </p>
        ) : bigBrotherId != null ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-[length:var(--text-body)]">
              <Link
                to={`/brother/${bigBrotherId}`}
                className="font-medium text-[var(--primary-emphasis)] underline-offset-2 hover:underline"
              >
                {bigBrotherName}
              </Link>
              <button
                type="button"
                onClick={() => onChange(null)}
                aria-label={`Remove Big Brother ${bigBrotherName}`}
                className="flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden="true">×</span>
              </button>
            </span>
          </div>
        ) : roster && names ? (
          <Combobox
            options={options}
            onSelect={(value) => onChange(Number(value))}
            inputLabel="Search for a Big Brother by name"
            placeholder="Search by name…"
            emptyMessage="No matching brother."
            describedBy={error ? errorId : undefined}
            adornment={<SearchIcon />}
          />
        ) : (
          <p className="text-[length:var(--text-body-sm)] text-muted-foreground">
            Loading the brotherhood…
          </p>
        )}
        {error && (
          <p id={errorId} className="mt-1 text-[length:var(--text-body-sm)] text-destructive">
            {error}
          </p>
        )}
      </div>

      {littles.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-[length:var(--text-label-up)] font-semibold uppercase tracking-wide text-muted-foreground">
            Little Brothers
            <span aria-hidden="true" title="Set in each brother's own profile">
              🔒
            </span>
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {littles.map((little) => (
              <li key={little.id}>
                <Link
                  to={`/brother/${little.id}`}
                  className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-[length:var(--text-body-sm)] text-foreground underline-offset-2 hover:underline"
                >
                  {little.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[length:var(--text-body-sm)] text-muted-foreground">
            Derived from who names this brother as their Big Brother — set it on their profiles.
          </p>
        </div>
      )}
    </Section>
  );
}

function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="6.5" cy="6.5" r="4.5" />
      <line x1="10" y1="10" x2="13.5" y2="13.5" strokeLinecap="round" />
    </svg>
  );
}
