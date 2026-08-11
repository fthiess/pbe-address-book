/**
 * GENERATED FILE — do not edit.
 *
 * Written by `npm run build:tables --workspace tools/geo-data`; the URLs carry a
 * content hash so the tables can be served immutably (OFC-378, D177). The gate's
 * `assert:geo-tables` step fails if this manifest and the files in
 * `apps/web/public/geo/` ever disagree.
 *
 * ⚠ These tables must be **fetched**, never imported: D74's bundle ceiling sums
 * every chunk in `dist/assets`, and the ZIP table alone is larger than the
 * headroom.
 */

export interface GeoTable {
  /** Absolute path, served by Firebase Hosting from `apps/web/public`. */
  readonly url: string;
  /** Data rows, excluding the provenance comments and the column header. */
  readonly rows: number;
}

export const GEO_TABLES: { readonly zips: GeoTable; readonly cities: GeoTable } = {
  zips: { url: "/geo/zips.d36cc600.csv", rows: 41151 },
  cities: { url: "/geo/cities.6e3ade17.csv", rows: 3590 },
};
