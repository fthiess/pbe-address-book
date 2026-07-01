import type { NameRecord } from "@pbe/name-search";
import { useCallback, useId, useMemo, useState } from "react";
import { Combobox, type ComboboxOption } from "../../components/Combobox.js";
import type { DirectoryProfile } from "../../lib/types.js";
import { useNameSearch } from "../directory/search/useNameSearch.js";
import { RelationshipChip } from "./RelationshipChip.js";
import { FIELD_LABEL_CLASS, Section } from "./fields.js";
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

  const bigBrotherName =
    bigBrotherId != null ? (names?.get(bigBrotherId) ?? `#${bigBrotherId}`) : null;

  return (
    <Section title="Relationships">
      <div>
        <p className={`mb-1 block ${FIELD_LABEL_CLASS}`}>Big Brother</p>
        {rosterError ? (
          <p className="text-[length:var(--text-body-sm)] text-muted-foreground">
            The brotherhood list couldn't load, so the Big Brother picker is unavailable right now.
          </p>
        ) : bigBrotherId != null ? (
          <div className="flex flex-wrap items-center gap-2">
            <RelationshipChip
              id={bigBrotherId}
              name={bigBrotherName ?? `#${bigBrotherId}`}
              onRemove={() => onChange(null)}
              removeLabel={`Remove Big Brother ${bigBrotherName}`}
            />
          </div>
        ) : roster && names ? (
          <BigBrotherPicker
            roster={roster}
            names={names}
            selfId={selfId}
            onSelect={onChange}
            describedBy={error ? errorId : undefined}
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
          <p className={`flex items-center gap-1.5 ${FIELD_LABEL_CLASS}`}>
            Little Brothers
            <span aria-hidden="true" title="Set in each brother's own profile">
              🔒
            </span>
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {littles.map((little) => (
              <li key={little.id}>
                <RelationshipChip id={little.id} name={little.name} />
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[length:var(--text-body-sm)] text-muted-foreground">
            Set automatically based on who names this brother as their Big Brother.
          </p>
        </div>
      )}
    </Section>
  );
}

/**
 * The Big-Brother typeahead, matched by the **same** Name Search the Directory
 * uses — `useNameSearch` (fuzzy + Beider-Morse phonetics + the common-nickname
 * dictionary, in the Web Worker with an instant substring fallback; D35/D110/D123).
 * So "Bill" surfaces the Williams here exactly as it does on the Directory. The
 * matcher runs only while this picker is on screen (a brother with no Big Brother),
 * so the index isn't built on every profile open. The Combobox reports its query
 * back through `onQueryChange`; the resulting id set drives the option filter.
 */
function BigBrotherPicker({
  roster,
  names,
  selfId,
  onSelect,
  describedBy,
}: {
  roster: DirectoryProfile[];
  names: Map<number, string>;
  selfId: number;
  onSelect: (id: number) => void;
  describedBy?: string;
}) {
  const [query, setQuery] = useState("");

  const nameRecords = useMemo<NameRecord[]>(
    () =>
      roster
        .filter((p) => p.id !== selfId)
        .map((p) => ({
          id: p.id,
          firstName: p.firstName,
          middleName: p.middleName,
          lastName: p.lastName,
          fullLegalName: p.fullLegalName,
          mugName: p.mugName,
          canonicalName: names.get(p.id),
        })),
    [roster, selfId, names],
  );

  const { matchedIds } = useNameSearch(nameRecords, query);

  const options = useMemo(
    () =>
      roster
        .filter((p) => p.id !== selfId)
        .map((p) => ({ value: String(p.id), label: names.get(p.id) ?? `#${p.id}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [roster, selfId, names],
  );

  // Filter through Name Search: `null` (empty query) shows everyone; otherwise keep
  // only the matched ids. (The Combobox's own substring filter is bypassed.)
  const filter = useCallback(
    (option: ComboboxOption) => matchedIds === null || matchedIds.has(Number(option.value)),
    [matchedIds],
  );

  return (
    <Combobox
      options={options}
      onSelect={(value) => onSelect(Number(value))}
      onQueryChange={setQuery}
      filter={filter}
      inputLabel="Search for a Big Brother by name"
      placeholder="Search by name…"
      emptyMessage="No matching brother."
      describedBy={describedBy}
      adornment={<SearchIcon />}
    />
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
