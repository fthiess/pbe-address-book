import type { Role } from "@pbe/shared";
import { parseAsArrayOf, parseAsString, useQueryStates } from "nuqs";
import { useCallback, useMemo } from "react";
import {
  type BoolFilter,
  type DirectoryFilters,
  type PresenceFilter,
  type VerificationFilter,
  buildFilterPredicate,
  countActiveFilters,
} from "./filters.js";

/**
 * The structured filters as **URL view state** (D31/§5.6.4): every active filter
 * lives in the query string, so a filtered view is shareable and restored by the
 * back button. Each filter field maps to a same-named query param; defaults
 * (empty string / empty list) are cleared from the URL so a pristine view stays
 * clean. Text inputs update on **replace** (no per-keystroke history spam, as the
 * search box does); discrete controls update on **push** so back/forward walk
 * through them.
 */

const filterParsers = {
  classYear: parseAsString.withDefault(""),
  constitutionId: parseAsString.withDefault(""),
  major: parseAsArrayOf(parseAsString).withDefault([]),
  country: parseAsArrayOf(parseAsString).withDefault([]),
  stateProvince: parseAsArrayOf(parseAsString).withDefault([]),
  city: parseAsString.withDefault(""),
  email: parseAsString.withDefault(""),
  phone: parseAsString.withDefault(""),
  allowNewsletterEmail: parseAsString.withDefault(""),
  allowCommentReplyEmail: parseAsString.withDefault(""),
  allowShareWithMITAA: parseAsString.withDefault(""),
  verification: parseAsString.withDefault(""),
  verifiedBefore: parseAsString.withDefault(""),
};

export interface DirectoryFiltersControl {
  filters: DirectoryFilters;
  /** Update one filter field; `commit: "push"` for discrete controls, default replace. */
  setFilter: <K extends keyof DirectoryFilters>(
    key: K,
    value: DirectoryFilters[K],
    commit?: "push" | "replace",
  ) => void;
  /** Clear every filter (used by the panel's and the Directory's Reset). */
  reset: () => void;
  /** Number of constraining filter fields (the panel badge). */
  activeCount: number;
  /** The composed row predicate for the active role. */
  predicate: (profile: import("../../lib/types.js").DirectoryProfile) => boolean;
}

export function useDirectoryFilters(role: Role): DirectoryFiltersControl {
  const [raw, setRaw] = useQueryStates(filterParsers, {
    history: "replace",
    clearOnDefault: true,
  });

  // The URL carries strings; narrow them back to the typed filter shape. Unknown
  // values are harmless — the predicate's checks ignore anything off-grammar.
  const filters = useMemo<DirectoryFilters>(
    () => ({
      classYear: raw.classYear,
      constitutionId: raw.constitutionId,
      major: raw.major,
      country: raw.country,
      stateProvince: raw.stateProvince,
      city: raw.city,
      email: raw.email as PresenceFilter,
      phone: raw.phone as PresenceFilter,
      allowNewsletterEmail: raw.allowNewsletterEmail as BoolFilter,
      allowCommentReplyEmail: raw.allowCommentReplyEmail as BoolFilter,
      allowShareWithMITAA: raw.allowShareWithMITAA as BoolFilter,
      verification: raw.verification as VerificationFilter,
      verifiedBefore: raw.verifiedBefore,
    }),
    [raw],
  );

  const setFilter = useCallback(
    <K extends keyof DirectoryFilters>(
      key: K,
      value: DirectoryFilters[K],
      commit: "push" | "replace" = "replace",
    ) => {
      void setRaw({ [key]: value }, { history: commit });
    },
    [setRaw],
  );

  const reset = useCallback(() => {
    void setRaw(null);
  }, [setRaw]);

  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);
  const predicate = useMemo(() => buildFilterPredicate(filters, role), [filters, role]);

  return { filters, setFilter, reset, activeCount, predicate };
}
