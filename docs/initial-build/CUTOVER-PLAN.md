# PBE Address Book — Cutover Plan (Phase 8)

Written 2026-09-15 (DECISIONS **D180**), under a compressed schedule: the
production environment, the genesis data load and the Ghost flip all happen
between the afternoon of Tuesday 2026-09-15 and the evening of Wednesday
2026-09-16, ahead of a soft launch to the UAT cohort and the public launch at
the Reunion on Saturday 2026-09-19 (immovable). The stub this replaces, and the
items it had parked, are in `history/` and folded into the sections below.

The plan follows the dev-workflow skill's `launch-and-cutover.md`: every launch
must be **reversible** (a tested way back), **observable** (health legible within
minutes) and **incremental** (exposure grows in steps).

## 1. Scope and preconditions

**In scope for cutover:** `pbe-book-prod` provisioned; the production deploy
workflow; the genesis load of the merged roster (1,480 brothers) and the initial
headshot corpus (135 photos); the live Ghost site's account cleanup (384
duplicate accounts deleted, 33 names/emails corrected) so that one Ghost address
maps to one Book profile; the Book-integrated theme on `pbe400.org`;
`book.pbe400.org` on Firebase Hosting with a managed certificate; Mixpanel-Prod
on from the first session.

**Deliberately deferred to Stage 5 (post-launch), each with a ticket:**

- The Ghost pull-and-seed of `ghostMemberId` (OFC-340). ⚠ Consequence: the
  Book→Ghost push (`routes/ghost-push.ts`) **no-ops for every brother** until it
  runs, so an email or newsletter-preference edit in Book does not propagate to
  Ghost. Sign-in is unaffected (it resolves by email, not by `ghostMemberId`).
- The observability provisioning (`provision-observability.sh` against prod) and
  the backup-integrity job repoint (OFC-333); the a11y fixes (OFC-261 →
  Stage 3.2); the CI/CD topology repoint — **production deploys from a release
  tag** (Forrest's call, D180), so `main` keeps its meaning and nothing moves.
- OFC-369 (sticky uuid miss), OFC-371 (one tester's upstream block), the two
  UAT cosmetics (OFC-420, OFC-418) and the error-popup bug (OFC-422).

**Preconditions checked before the load:** the genesis snapshot converts with
zero errors; the restore dry-run passes structural validation; the emulator
rehearsal shows the sole usable admin and the all-`true` privacy block on loaded
data (D163's obligation — verified on the emulator 2026-09-15, re-verified on
prod after the load).

## 2. Rollback plan (written first)

Book production has **no users to protect** until the theme flip makes it
reachable, which keeps the rollback simple.

| Trigger | Lever | Time |
|---|---|---|
| Sign-in fails for Forrest or for more than one tester in the first hour | Ghost Admin → Design → activate the previous theme (`pbe-news-ghost-theme-prev-20260626.zip`) and remove the `/book/` route from `routes.yaml`. Book becomes unreachable from the newsletter; nobody else notices. | < 5 min |
| A privacy regression (a `no-store` route caching, an `/img/` object served `public`) | Same theme rollback, then fix and redeploy | < 5 min |
| Bad data (a mapping error visible across many records) | `restore.ts --file <corrected snapshot>` after `maintenance-on.sh`; the tool takes a safety snapshot first | < 15 min |
| A broken deploy | Dispatch `Deploy production` on the previous tag | ~15 min (gate re-runs) |

Numeric thresholds from the methodology apply to the soft-launch cohort: a new
class of client error in more than a trickle of sessions, or sign-in denials
above a handful, means hold exposure (no announcement) and investigate.

**Data written during a bad window:** brothers may edit their own profiles from
the first sign-in. A theme rollback loses nothing (Book keeps its data); a data
restore replaces edits made since the snapshot — the safety snapshot the tool
writes first is the record of them.

## 3. Production environment bring-up

All three infra scripts now take `ENV_FILE` (default `staging.env`);
`infra/environments/prod.env` is the single source of production values.

```bash
# from the repo root, as an owner of the billing account
ENV_FILE=infra/environments/prod.env BILLING_ACCOUNT=00839F-755E1F-BA1FA4 bash infra/provision-staging.sh
ENV_FILE=infra/environments/prod.env bash infra/setup-wif.sh
# paste the printed book-backup-scheduler uniqueId into prod.env BACKUP_INVOKER_SUBJECT
```

Done ahead of the script on 2026-09-15: project created and billed, Firebase
enabled (`firebase projects:addfirebase pbe-book-prod`), and the Ghost Admin key
stored as Secret Manager `ghost-admin-api-key` in the prod project.

**Console-only steps (no CLI):** Firebase Hosting → Add custom domain
`book.pbe400.org` → put the TXT verification and A records into Namecheap DNS →
wait for the managed certificate. ⚠ Start this first; the certificate is the
one step nobody controls. ⚠ The custom domain resolves to the same shared
Hosting IP as staging (`199.36.158.100`), so it fixes hostname reputation but
not an IP-level block (OFC-371).

Then confirm the two things the stub warned fail silently: Cloud Run reports
**Max: 1** at the service level (N134; never `--scaling=1`), and the backup
bucket is public-access-prevented and receives its first snapshot after the
first scheduled run.

## 4. The production deploy

`.github/workflows/deploy-prod.yml` is a manual dispatch on a **release tag**. It
re-runs the full verification gate (`ci.yml` via `workflow_call`) against the
promoted commit and deploys only on green — the asymmetry with staging is the
point (D143). It has no seeding, mirroring or tester steps and refuses a
`-staging` project id.

```bash
git tag -a v2026.09.16 -m "Book production launch" <sha> && git push origin v2026.09.16
gh workflow run "Deploy production" --ref v2026.09.16
gh run watch
```

The workflow's last step curls `/api/health` on the Cloud Run URL.

## 5. Genesis data load

The bulk loader is **convert, then restore** (D180): `csv-to-snapshot.ts` turns
the merged roster CSV into a version-2 restore snapshot, and the existing
offline restore (D101) validates and writes it. Real PII stays under the
gitignored `apps/api/restore-artifacts/`.

```bash
# 1. Convert (pure; writes nothing to any cloud). --admin makes Forrest the sole admin (OFC-238).
npm run genesis:convert --workspace apps/api -- \
  --csv "<roster>.csv" --headshots "<headshots dir>" --admin 849 \
  --out restore-artifacts/genesis.json
# 2. Dry-run the restore against prod, then run it. --force: no maintenance page on an empty site.
npm run restore --workspace apps/api -- --file restore-artifacts/genesis.json \
  --project pbe-book-prod --force --no-safety-snapshot --skip-ghost-audit --dry-run
npm run restore --workspace apps/api -- --file restore-artifacts/genesis.json \
  --project pbe-book-prod --force --no-safety-snapshot --skip-ghost-audit --confirm pbe-book-prod
# 3. Headshots: the SAME encode path as a member upload, under the snapshot's keys.
npm run genesis:headshots --workspace apps/api -- --source "<headshots dir>" \
  --snapshot restore-artifacts/genesis.json --project pbe-book-prod \
  --bucket pbe-book-prod-images --confirm pbe-book-prod
# 4. Cold start so the cache hydrates (there is no Firestore listener):
gcloud run services update pbe-book-api --region us-central1 --project pbe-book-prod --update-env-vars GENESIS=1
```

Then verify **on loaded data, not by reading a constant** (D163): sign in as
#849, `GET /api/me` shows all five privacy flags `true`; the Directory count is
1,480 minus the two de-brothered records; a deceased brother renders the
In Memoriam line; a headshot renders for a brother in the corpus.

Conversion facts recorded for the record: one 1930 row whose name is literally
"scratched out" is **skipped** (add in-app); one phone without its `+` country
prefix and one alternate email equal to its primary are **dropped**; one Sports
line is **truncated** to the 120-character cap — all four reported by the tool.

## 6. Ghost: account cleanup, theme and portal flip

**Cleanup (replaces Stage 2.2's manual dedup, OFC-339):** the actions CSV Forrest
prepared is applied by `pbe-data-merge/apply_ghost_cleanup.py` (workspace, not
this repo) — 384 deletes, 32 name corrections, 1 email change, every row
verified against the live member's uuid first. Its `--report` measures the
launch's key metric: **815 Ghost members remain, 800 match a Book email, 15 do
not** (those 15 cannot sign in until their Book email or Ghost address is
corrected; the list is a private workspace file).

**Theme:** package with `git archive --format=zip HEAD` (never an exclusion glob;
never `Compress-Archive` — landmines in memory) and upload via Ghost Admin →
Design. Merge `ghost-bridge/routes-snippet.yaml`'s `/book/` entry into the live
`routes.yaml` (download, edit, upload — never replace). `book_url` defaults to
production (D139), so no setting change is needed on pbe400.org. Verify
`https://pbe400.org/book/` returns 200 and the D55 flip (account links → Book)
is live.

## 7. Staged exposure and the first-hour watch

1. **Forrest** signs in from pbe400.org → Book, edits his own profile, views a
   deceased brother and a brother with a headshot, exports nothing.
2. **The first-hour checklist:** `/api/health` ok; Cloud Run logs flowing with
   **no new error types**; the Cache-Control probe matrix on `book.pbe400.org`
   (`/api/profiles`, `/api/me`, `/api/profiles/:id`, `/api/admin/backup` →
   `no-store`; `/img/**` → `private, …, immutable`, never `public`; shell
   `no-cache, must-revalidate`; hashed assets `public, …, immutable` — D146);
   Mixpanel-Prod shows Book events under `app = book`; the rollback lever
   (previous theme zip) is at hand.
3. **Soft launch:** email to the UAT cohort plus a few brothers in the know,
   Wednesday evening. Watch sign-in denials in the logs for 24 hours.
4. **Public launch:** the Reunion, Saturday 2026-09-19 (OFC-347).

## 8. Post-launch steady state and what is still owed

- Run `provision-observability.sh` against prod (alerts armed by the first
  backup); repoint the integrity job (OFC-333); confirm the first backup lands.
- Run the Ghost pull-and-seed (OFC-340) to turn the Book→Ghost push on; then the
  alignment audit cadence.
- Tighten the Cloud Build SA and `run-sources-*` grant (infra/README.md).
- Re-triage Stage 5 after the Reunion (LAUNCH-SCHEDULE.md).
