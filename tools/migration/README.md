# tools/migration

One-time, pre-launch migration utilities (the Ghost-account dedup, the
pull-and-seed utility, the initial bulk-loader, and the family-tree / yearbook /
MITAA adapters). These are **standalone programs that never ship in the deployed
service** (DECISIONS D57); they are kept in-repo for history and reproducibility.

This directory is an intentional placeholder in Phase 0. The tools themselves
are built in Phase 8 (pre-launch migration and cutover) and inventoried in
[`PRE-LAUNCH-TOOLS.md`](../../docs/initial-build/PRE-LAUNCH-TOOLS.md).
