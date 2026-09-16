# tools/migration

One-time, pre-launch migration utilities (the Ghost-account dedup, the
pull-and-seed utility, the initial bulk-loader, and the family-tree / yearbook /
MITAA adapters). These are **standalone programs that never ship in the deployed
service** (DECISIONS D57); they are kept in-repo for history and reproducibility.

This directory is an intentional placeholder in Phase 0. The tools themselves
are built in Phase 8 (pre-launch migration and cutover) and inventoried in
[`PRE-LAUNCH-TOOLS.md`](../../docs/initial-build/PRE-LAUNCH-TOOLS.md).

**As built (2026-09-15, DECISIONS D180):** the genesis loader did not land here.
It is `apps/api/src/tools/csv-to-snapshot.ts` (+ `genesis-convert.ts`, the pure,
tested half) and `apps/api/src/tools/load-headshots.ts`, because they reuse the
API package's restore internals and image encoder — the precedent `restore.ts`
and `prepare-uat-photos.ts` set. The Ghost-account cleanup script lives in the
workspace (`pbe-data-merge/apply_ghost_cleanup.py`), outside this public repo.
The pull-and-seed utility is deferred (OFC-340).
