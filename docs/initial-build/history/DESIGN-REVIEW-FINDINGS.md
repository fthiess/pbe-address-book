# PBE Address Book — Design-Review Findings  *(retired — see the composite)*

> **This file has been superseded.** The clean-context design review produced eight raw reviewer reports (in [`raw-dr-feedback/`](raw-dr-feedback)), which have been consolidated into a single authoritative punch list:
>
> ### → [`DESIGN-REVIEW-COMPOSITE.md`](DESIGN-REVIEW-COMPOSITE.md)
>
> That composite is the **single source going forward** — the de-duplicated, grouped register of all findings, and the surface where the **triage session** records each finding's disposition (its §12 worksheet) and any resulting new decisions (`D77+` in [`../DECISIONS.md`](../DECISIONS.md)).

This document was the original empty triage template (one flat findings table with Disposition/Action columns). It was never populated; the composite replaced it because consolidating two reviewers × four reviews (125 raw findings) needed grouping, provenance, and synthesis that a single flat table could not carry. The review method and reviewer setup remain in [`DESIGN-REVIEW-PLAN.md`](DESIGN-REVIEW-PLAN.md).

The severity and disposition legends, and the workflow, now live in the composite (§1). They are repeated here only so an old inbound link still finds them:

- **Severity (reviewer-assigned):** `blocker` · `should-fix` · `minor` · `question`.
- **Disposition (triage):** `(a) fix` (note if it changes a decision → new `D##`) · `(b) as-designed` · `(c) deferral` (cross-check `PRD.md` §3.2) · `(d) external-context`.
