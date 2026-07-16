import type { NameRecord } from "@pbe/name-search";
import { Lock, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Combobox, type ComboboxOption } from "../../components/Combobox.js";
import { ControlHelp } from "../../components/ControlHelp.js";
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
        <div className="mb-1 flex items-center gap-1.5">
          <p className={`block ${FIELD_LABEL_CLASS}`}>Big Brother</p>
          <ControlHelp entryKey="profile.bigBrother" />
        </div>
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
            <span
              aria-hidden="true"
              title="Set in each brother's own profile"
              className="inline-flex items-center"
            >
              <Lock size={13} />
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

  // Build the fuzzy/phonetic index only once the user actually engages the field
  // (types into it), not on every profile-with-no-big-brother edit that never
  // touches it (OFC-119). Once engaged, stay engaged so clearing the query doesn't
  // tear the worker down.
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (query.trim() !== "") {
      setEngaged(true);
    }
  }, [query]);

  // One pass over the roster, reused for both the search records and the options,
  // instead of filtering the full ~1,166-member list several times per build (OFC-119).
  const candidates = useMemo(() => roster.filter((p) => p.id !== selfId), [roster, selfId]);

  const nameRecords = useMemo<NameRecord[]>(
    () =>
      candidates.map((p) => ({
        id: p.id,
        firstName: p.firstName,
        middleName: p.middleName,
        lastName: p.lastName,
        fullLegalName: p.fullLegalName,
        mugName: p.mugName,
        canonicalName: names.get(p.id),
      })),
    [candidates, names],
  );

  const { matchedIds } = useNameSearch(nameRecords, query, engaged);

  const options = useMemo(
    () =>
      candidates
        .map((p) => ({ value: String(p.id), label: names.get(p.id) ?? `#${p.id}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [candidates, names],
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
      adornment={<Search size={15} strokeWidth={1.5} aria-hidden="true" />}
    />
  );
}
