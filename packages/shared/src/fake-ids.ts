import type { Role } from "./types.js";

/**
 * The lowest fake Constitution ID (D65). Real signing numbers are below this, so
 * the whole generated fake dataset occupies ids `>= FAKE_ID_FLOOR`. Shared (OFC-83)
 * so the fake-data generator and the dev identity provider agree on one floor
 * rather than each hardcoding 5001 independently.
 */
export const FAKE_ID_FLOOR = 5001;

/**
 * The fixed profile id each dev-login role maps to — the first three fake records
 * (brother/manager/admin), so a dev session has a real record to back `/api/me`
 * and the directory's own-row overlay (D82). Derived from {@link FAKE_ID_FLOOR}
 * and shared with the generator (OFC-83): the generator assigns ids sequentially
 * from the same floor, so these three are guaranteed present in any dataset that
 * holds at least three records, and can never silently drift from the seed shape.
 */
export const DEV_PROFILE_IDS: Record<Role, number> = {
  brother: FAKE_ID_FLOOR,
  manager: FAKE_ID_FLOOR + 1,
  admin: FAKE_ID_FLOOR + 2,
};
