/**
 * Schema defaults that more than one program has to agree on (DATABASE-SCHEMA
 * §3.3). Shared rather than re-declared per call site, on the D50 precedent: one
 * source, no drift.
 */

import type { PrivacyFlags } from "./types.js";

/**
 * The privacy block a brand-new brother starts with: **all five toggles on**
 * (D163). Reachability has defaulted open since D45; `shareEmergency` and
 * `shareSpousePartner` joined it when D163 reversed D93's opt-in default
 * (OFC-373) — a brother records an emergency contact or a spouse precisely in
 * order to share it, and emergency information nobody may read serves no
 * purpose. Read D163 before flipping either back: it is the third pass over the
 * question and the two before it (D93, and OFC-268 declined at N107) landed the
 * other way.
 *
 * ⚠ **Every writer of a new `Profile` must start from this constant**, not from
 * a hand-written literal. The value lives here because it is not the API's to
 * own: the create route (`POST /api/profiles`), the staging tester seed, and —
 * critically — the **Phase 8 bulk-loader that will write the ~1,199 production
 * records** must all agree, and that loader does not go through the create
 * route. A literal copied by hand is how this decision silently becomes a no-op
 * for every real brother (PRE-LAUNCH-TOOLS.md carries the same warning).
 *
 * ⚠ **This is a schema default, not a safety fallback.** Two all-`false` privacy
 * blocks exist elsewhere and are deliberately *not* this constant:
 * `apps/api/src/data/cache.ts` (a stored record whose `privacy` is malformed or
 * missing) and `apps/web/src/pages/profile/patch.ts` (a block that never reached
 * the client, N70). Those answer "we don't know what this brother chose", for
 * which all-hidden is the only defensible read. **Do not unify them with this.**
 *
 * Frozen so a consumer cannot mutate the shared object; spread it to build a
 * record's own block.
 */
export const DEFAULT_PRIVACY: Readonly<PrivacyFlags> = Object.freeze({
  shareEmail: true,
  sharePhone: true,
  shareAddress: true,
  shareEmergency: true,
  shareSpousePartner: true,
});
