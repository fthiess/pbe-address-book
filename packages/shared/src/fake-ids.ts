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

/**
 * The lowest id assigned to a UAT **tester** profile (D156; OFC-248).
 *
 * Testers get their own block rather than overwriting generated records, which is
 * what keeps every deliberate fixture intact — the planted Canonical Name collision
 * pair at #5001/#5002, the deceased-and-email-less nominal admin at #5003, the
 * usable admin at #5004, and the six managers after them. `generateProfiles()`
 * never emits an id at or above this floor, so the two populations cannot collide
 * and a tester is never dressed with a seeded fake headshot.
 *
 * ⚠ **Above {@link FAKE_ID_FLOOR}, deliberately — never below it** *(Forrest's call,
 * Stage 1.2)*. Placing testers at, say, #4001 would sort them ahead of the fake data,
 * but D65 reserves everything *below* 5001 for real signing numbers, and that rule is
 * what makes "is this record fake?" answerable from the id alone — in a log, a backup
 * snapshot, or a restore artifact (which per D150 is the whole member directory in
 * plaintext). Tester rows carry real names and real email addresses, so they are the
 * *last* records that should wear real-looking ids. The "sorts first" benefit is also
 * illusory: the Directory's default sort is Canonical Name ascending (D38), not id.
 *
 * The gap from #6200 (the top of a default 1,200-record generated set) to here leaves
 * the generator room to grow without the two blocks ever meeting.
 */
export const TESTER_ID_FLOOR = 9001;
