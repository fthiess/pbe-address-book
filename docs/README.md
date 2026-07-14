# PBE Address Book — Documentation Index

This `docs/` tree holds the design and engineering documentation for Book. It is organized **by build**: the initial release and each later major feature get their own subfolder containing that work's complete document set (product requirements, schema, engineering design, API, build plan, user manual, decision log, and supporting material). Origin and history documents that are *not* meant to be referenced by the engineering docs — the original seed notes and the narrative design history — live under each build's own `history/` subfolder, set apart so the engineering documents stand on their own.

The intent is that the documentation grows the way the product does. Book launches with the **initial build**; as significant features are added later, each arrives with its own folder beside `initial-build/` (for example `news-search/` or `mailman/`), so no single folder becomes an undifferentiated pile and every feature's reasoning stays coherent and self-contained. One document is shared across all builds and version-spanning: the decision log, which is the canonical record of *why* Book is built the way it is and is referenced by current and future feature designs alike.

## Builds

| Build | Version | Folder | Status | Started | Design completed | Launched |
|---|---|---|---|---|---|---|
| Initial build | v1 | [`initial-build/`](initial-build/) | Design complete; implementation not yet begun | 2026-06-02 | 2026-06-07 | *(pending)* |

*Future feature builds are added as new rows and sibling folders as they are designed.*

## What's in a build folder

A build folder such as `initial-build/` contains that build's delivered documents:

- **`PRD.md`** — product requirements: scope, users, and the behavior of every page and feature.
- **`DATABASE-SCHEMA.md`** — the data model: collections, the `Profile` record, types, controlled vocabularies, and field-level visibility.
- **`ENGINEERING-DESIGN.md`** — architecture, auth, integrations, and operations.
- **`API-SPEC.md`** — the HTTP surface.
- **`VISUAL-DESIGN-BRIEF.md`** — requirements on the product's visual design derived from the other design documents in the build package.
- **`CODING-PROJECT-PLAN.md`** — the dependency-ordered build phases, environments, CI/CD, and the launch/migration sequence.
- **`USER-MANUAL.md`** — the end-user reference, whose per-control help section is the single source for Book's in-page help.
- **`DECISIONS.md`** — the ADR-style decision log (the "why"); shared across builds and referenced by later feature designs. *(Graduated from the planning vault at the Session-6c close-out.)*
- **`PRE-LAUNCH-TOOLS.md`** — the inventory of one-time migration utilities and external operational tools. *(Graduated from the planning vault at the Session-6c close-out.)*
- **`UAT-PLAN.md`** — the Phase 7.7 user-acceptance-testing plan: platform and data policy, tester provisioning, execution process, and exit criteria. *(Added 2026-07-14, DECISIONS D132.)*
- **`CUTOVER-PLAN.md`** — the production cutover plan; a stub accumulating cutover-scope items until it is written at Phase 8 planning. *(Added 2026-07-14, DECISIONS D132.)*
- **`visual-design/`** — a set of files containing the detailed visual design of the product, including design tokens, as concrete values — this is the load-bearing artifact. The light + dark sets mapped to the named shadcn/Tailwind CSS variables, the brand accent values, color palette, the type scale, and the spacing / radius / elevation scales.
- **`history/`** — origin and narrative documents, not referenced by the engineering docs:
  - **`SEED.md`** — the original implementation seed notes the project started from, preserved for historical value.
  - **`DESIGN-HISTORY.md`** — the narrative of how the design was reached, distilled from the planning session log.
  - **`DESIGN-REVIEW-PLAN.md`** — a proposal for a fresh-eyes, clean-context adversarial review of the delivered suite before implementation begins.
  - **`DESIGN-REVIEW-FINDINGS.md`** — the findings from that review and the disposition of each (a record of what was found and what was done about it).

*(`DECISIONS.md`, `PRE-LAUNCH-TOOLS.md`, and the `history/` documents were added at the Session-6c close-out, 2026-06-07, when the planning phase completed.)*
