import { type RadiusMiles, memberPoint } from "@pbe/shared";
import { useEffect, useMemo } from "react";
import type { DirectoryProfile } from "../../lib/types.js";
import { type GeoTablesStatus, loadGeoTables, useGeoTables } from "../../lib/useGeoTables.js";
import type { ProximityFilter } from "./filters.js";
import {
  type LocatedBrother,
  type NearContext,
  type NearOrigin,
  indexCities,
  nearLabel,
  parseNearToken,
  resolveNearPoint,
} from "./near.js";

/**
 * Everything between the `near` URL token and a filter that can actually run
 * (OFC-378 session B): the lazy tables, the roster members those tables can
 * place, the origin the token names, and the resolved {@link ProximityFilter} —
 * or the reason there isn't one.
 *
 * A hook of its own rather than another block inside `Directory.tsx` because it
 * is the only filter with a *fetch* between the URL and the predicate, and
 * folding that into the page put `Directory()` over Biome's cognitive-complexity
 * ceiling — a fair reading, since none of this is about laying the page out.
 *
 * Nothing here costs anything until something triggers the fetch: every memo
 * short-circuits on a null table, and the store stays idle until asked.
 */
export interface NearFilterState {
  /** What the typeahead offers from. */
  readonly context: NearContext;
  readonly status: GeoTablesStatus;
  /** The parsed token; `undefined` when unset or malformed. */
  readonly origin: NearOrigin | undefined;
  /** The runnable filter, or `undefined` — see {@link ProximityFilter}. */
  readonly proximity: ProximityFilter | undefined;
  /**
   * A one-line explanation when an origin is set and *not* being applied, for
   * the Directory header — `undefined` whenever the view needs no explaining.
   */
  readonly notice: string | undefined;
  /** Start the table fetch; idempotent, and a no-op once loaded. */
  readonly engage: () => void;
}

export function useNearFilter(
  nearToken: string,
  radiusMiles: RadiusMiles,
  profiles: readonly DirectoryProfile[] | null,
  nameOf: (profile: DirectoryProfile) => string,
): NearFilterState {
  const geo = useGeoTables();
  const origin = useMemo(() => parseNearToken(nearToken), [nearToken]);

  // The third load trigger, and the one no interaction provides: a shared
  // proximity link arrives with the Filters panel collapsed and the control
  // unfocused, so without this the Directory would sit unnarrowed until the
  // reader opened a fold he has no reason to open.
  useEffect(() => {
    if (origin !== undefined) {
      loadGeoTables();
    }
  }, [origin]);

  // Every roster member the ZIP table can place, in Canonical-Name order — the
  // source of both the "near another brother" options and the resolution of a
  // `b~<id>` token.
  //
  // ⚠ A brother who cannot be located is deliberately **absent** rather than
  // present and unusable: offering him would build a filter that silently matched
  // nobody. That covers a hidden address (`shareAddress` off, so the projection
  // omits it entirely — the same brothers the city/state filters already cannot
  // see), a postal code that is not a US ZIP, and an explicitly non-US country.
  const brothers = useMemo<ReadonlyMap<number, LocatedBrother>>(() => {
    const located = new Map<number, LocatedBrother>();
    if (geo.centroids === null || profiles === null) {
      return located;
    }
    const byName = profiles
      .map((profile) => ({ profile, name: nameOf(profile) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const { profile, name } of byName) {
      const point = memberPoint(geo.centroids, profile.address);
      if (point === undefined) {
        continue;
      }
      located.set(profile.id, {
        id: profile.id,
        name,
        point,
        city: profile.address?.city,
        state: profile.address?.stateProvince,
      });
    }
    return located;
  }, [geo.centroids, profiles, nameOf]);

  const cityIndex = useMemo(() => (geo.cities ? indexCities(geo.cities) : null), [geo.cities]);

  const context = useMemo<NearContext>(
    () => ({ centroids: geo.centroids, cities: geo.cities, brothers }),
    [geo.centroids, geo.cities, brothers],
  );

  // ⚠ `undefined` covers three situations the UI must keep apart but the
  // predicate must not: no origin chosen, the tables still loading, and an origin
  // naming a place that is not in them. In all three the Directory stays
  // UNNARROWED — an empty grid would answer "no brothers live near Boston" to a
  // question that has not been asked yet.
  const proximity = useMemo<ProximityFilter | undefined>(() => {
    if (origin === undefined || geo.centroids === null) {
      return undefined;
    }
    const point = resolveNearPoint(origin, context, cityIndex);
    return point === undefined
      ? undefined
      : { centroids: geo.centroids, origin: point, radiusMiles };
  }, [origin, context, cityIndex, geo.centroids, radiusMiles]);

  const notice = useMemo(() => {
    if (origin === undefined || proximity !== undefined) {
      return undefined;
    }
    const place = nearLabel(origin, context);
    if (geo.status === "error") {
      return `Not filtering by ${place} — location data couldn't be loaded.`;
    }
    if (geo.status === "ready") {
      return `Not filtering by ${place} — we couldn't find that location.`;
    }
    return `Finding brothers near ${place}…`;
  }, [origin, proximity, context, geo.status]);

  return { context, status: geo.status, origin, proximity, notice, engage: loadGeoTables };
}
