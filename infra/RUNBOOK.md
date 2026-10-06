# Book — Operations Runbook

> **This is the runbook for running Book day to day:** taking it down for
> maintenance and bringing it back, forcing a cold start after a data change,
> releasing to production and rolling back, loading headshots, the Ghost seed, a
> locked-out administrator, a brother who cannot sign in, and the staging and UAT
> chores.
>
> **If something has gone badly wrong, use the other runbook.** Data lost,
> corrupted or wrongly changed; the production project damaged or gone; the
> backup-integrity check failed: all of those are in
> **[`DR-RUNBOOK.md`](DR-RUNBOOK.md)**. Building an environment's infrastructure
> from its scripts is in [`README.md`](README.md).

Commands are written for production (`pbe-book-prod`,
`ENV_FILE=infra/environments/prod.env`) unless a section is about staging. ⚠
Live production and IAM commands are Forrest's to run.

## Find your task

| I need to… | Section |
|---|---|
| Make a direct Firestore change visible | [Force a cold start](#force-a-cold-start-d181) |
| Take Book down, or bring it back | [Maintenance mode](#maintenance-mode-d118--d187--taking-book-down-and-bringing-it-back) |
| Ship staging's code to production, or roll it back | [Releasing to production](#releasing-to-production-d184--the-procedure) |
| A brother can't sign in | [Diagnosing a failed sign-in](#diagnosing-a-failed-sign-in) |
| An administrator locked themself out | [Recovering a locked-out administrator](#recovering-a-locked-out-administrator-d191) |
| Load a batch of photos | [Loading a batch of headshots](#loading-a-batch-of-headshots-d182--the-procedure) |
| Re-link profiles to Ghost members (after an old restore) | [Linking profiles to Ghost members](#linking-profiles-to-ghost-members-d183--the-procedure) |
| Reset staging, or freeze it for a UAT window | [Staging: reseeding and the freeze](#staging-reseeding-and-the-freeze) |
| Add or remove a UAT tester, or change the test photos | [The UAT fixtures bucket](#the-uat-fixtures-bucket-and-the-photo-corpus-stage-12-ofc-249) |

## Force a cold start (D181)

**The API hydrates its profile cache, its email index and the edit tokens only at
cold start.** There is no Firestore listener. So any write that does not go
through Book, whether a console edit, a restore, a bulk load, the Ghost seed or a
backfill, is **invisible until the instance is replaced**. Until then, edits to
the touched records fail with 412. Do this **immediately** after any such write.

Same image, new revision:

```bash
IMAGE="$(gcloud run services describe pbe-book-api --region us-central1 \
  --project pbe-book-prod --format='value(spec.template.spec.containers[0].image)')"
gcloud run deploy pbe-book-api --image "$IMAGE" \
  --region us-central1 --project pbe-book-prod
```

Then confirm the `N profiles cached` line in the new revision's startup log, with
the count you expect:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND textPayload:"profiles cached"' \
  --project pbe-book-prod --freshness=10m --limit=3
```

⚠ **Never** pass `--scaling=1`: it switches the service to manual scaling and
destroys D83's scale-to-zero floor (N134). ⚠ During maintenance, cold-start
**before** `maintenance-end.sh`, never after (below). On staging, a merge or
`gh workflow run "Deploy staging" --ref main` also cold-starts, but it reseeds
too.

## Maintenance mode (D118 → D187) — taking Book down and bringing it back

Maintenance exists for operations that must not run while brothers can edit: a
restore, an offline bulk load, a data migration (D100). **A release does not need
it.** `deploy-prod.yml` swaps Hosting and Cloud Run with no downtime.

```bash
bash infra/maintenance-begin.sh --dry-run     # says what it would do; changes nothing
bash infra/maintenance-begin.sh               # production: ENV_FILE=infra/environments/prod.env
# … the operation, then its forced cold start (D181) …
bash infra/maintenance-end.sh                 # same ENV_FILE
```

**What brothers see.** After `begin`, every path serves the static "Down for
maintenance" page from Hosting's edge: the bare origin, a bookmarked profile, the
"Book" link from pbe400.org. Nothing reaches Cloud Run, and Cloud Run itself is
left running. A brother who already has Book open keeps what is on screen; his
next request to the server gets the page instead of data. Static files the open
app hasn't loaded yet (an uncached headshot, a geo table, the search worker)
also come back as the page, so those features fail inside the tab rather than
showing the outage screen. After `end`, Hosting is
back on exactly the release it was serving before. There's no rebuild and no
version change, and nobody is signed out. A brother sitting on the static page
sees Book again when he reloads.

**How it works.** `begin` deploys `firebase.maintenance.json`, whose public
directory (`infra/maintenance-site/`) holds *only* `maintenance.html`, with every
path rewritten to it. The deploy carries the release message
`book-maintenance-begin`. `end` reads the live channel's release history through
the Hosting API and re-releases the version immediately before that release, the
same thing as the console's "rollback". Nothing is built or published from your
machine except the one static page, which is why this is safe on production
(OFC-449). The decisions live in `scripts/lib/maintenance.ts`, with unit tests.

**⚠ A deploy ends maintenance.** Any ordinary Hosting deploy replaces the
maintenance page: a production release, or **on staging, any merge to `main`**.
`end` therefore refuses, and changes nothing, unless the newest live release is
still the maintenance one. Otherwise it would roll that deploy back. Hold staging
merges while staging is in maintenance. If an operation ever needs downtime *and*
a new release (a data-shape change that can't be done expand/contract), the order
is `begin` → the operation → the release. The release ends maintenance, and `end`
correctly declines to run.

**⚠ Cold start before `end`, not after.** After an out-of-band Firestore write
the cache is stale until the instance is replaced (D181). Ending maintenance
first lets the first visitors see the old data, and edits to touched records get
412s.

Each script checks the edge afterwards and fails loudly if it disagrees: `begin`
that `/` and `/api/health` serve the page, `end` that `/` serves Book again. The restore and bulk-headshot pre-flights probe `/api/health`,
deliberately not `/`; see `MAINTENANCE_PROBE_PATH` in
`apps/api/src/tools/restore-support.ts`.

## Releasing to production (D184) — the procedure

Merging to `main` deploys **staging only**. Production moves only when Forrest
says so, for a specific release, and only through `Deploy production`
(`.github/workflows/deploy-prod.yml`) on a `v*` tag. The roles: on Forrest's
go-ahead, Claude reviews what is shipping, writes the notes, pushes the tag and
dispatches the workflow; **Forrest approves the pending deployment in GitHub** —
that click is the release decision. Claude never approves a production
deployment, by UI or API, even though the shared `gh` credentials could.

**Always release from `main`** — there are no release or hotfix branches
(D184). The consequence is a standing rule: **keep `main` releasable**. Merge
nothing a brother should not see; if something on `main` turns out unfit when a
release is being assembled, fix it forward or revert it on `main` first.
Tickets close when Forrest confirms the fix on staging (Gate 5), not when it
reaches production; the release notes are where "this is now live for brothers"
is recorded.

**The mechanical gate** has three layers. The `production` GitHub Environment
(repo settings, not the tree) requires Forrest's approval and admits only `v*`
tags. The workflow's first job refuses any other ref before the gate spends time
on it. And the production WIF trust condition requires the OIDC token's
`environment` claim to be `production` (`WIF_REQUIRED_ENVIRONMENT` in `prod.env`,
applied by `setup-wif.sh`), so a workflow that doesn't run in the environment
(an old tag, a branch, an edit that drops the line) cannot get a production
credential at all. ⚠ If the environment is ever deleted, a dispatch silently
re-creates it **unprotected**, and the claim would still read `production`. Check
the environment with:

```bash
gh api repos/fthiess/pbe-address-book/environments/production --jq '[.protection_rules[] | {type, reviewers: [.reviewers[]?.reviewer.login]}]'
```

and the trust condition (expect the `assertion.environment=='production'` clause) with:

```bash
gcloud iam workload-identity-pools providers describe github-provider --location=global --workload-identity-pool=github-pool --project pbe-book-prod --format='value(attributeCondition)'
```

### 1. Assemble the release

```bash
git fetch --tags origin
# The baseline is what production RUNS — the tag of the last successful
# production deploy — not the newest tag on main: after a rollback the two differ,
# and diffing from the newer one would wave the rolled-back changes through unreviewed.
LIVE=$(gh run list --workflow deploy-prod.yml --status success -L1 --json headBranch --jq '.[0].headBranch')
git log --oneline "$LIVE"..origin/main
git diff --stat "$LIVE"..origin/main -- infra/environments/prod.env firestore.rules firestore.indexes.json firebase.json ghost-bridge/
```

Then compare what production **runs** with what the deploy will set. The
deploy's `--set-env-vars` **replaces the service's whole variable set**, so a
variable set by hand on the live service (a fix applied during an incident, or a
cold-start marker) silently disappears with the next release:

```bash
gcloud run services describe pbe-book-api --region us-central1 --project pbe-book-prod --format="yaml(status.latestReadyRevisionName,spec.template.spec.containers[0].env)"
```

Every live variable should either appear in `deploy-prod.yml`'s `--set-env-vars`
list (with `prod.env`'s value) or be the `GHOST_ADMIN_API_KEY` secret reference.
Stale cold-start markers (`GENESIS_LOADED`, `SEEDED_AT`) are read by nothing,
and dropping them is harmless. **Stop if a live value that matters is missing from
`prod.env` or differs from it**: the release would undo it. This is a production
read, which the auto-mode classifier blocks by default. Forrest's go-ahead for the
release covers it and the other read-only checks below, so cite that when asking.

For every commit since the live tag, answer four questions before proposing
the release to Forrest:

- **Confirmed on staging?** Each user-facing change was live-tested there.
  Name any path staging **cannot** exercise and say how it will be checked on
  production instead — today, the Book→Ghost push (the staging Ghost mirror is
  off, so fake profiles have no `ghostMemberId`).
- **Configuration?** A `prod.env` change ships with the deploy; a new variable
  needs the `--set-env-vars` list in *both* deploy workflows.
- **Operator steps?** A tool that must run against production after the deploy
  (a backfill, a seed) is listed, in order, with its `--confirm pbe-book-prod`
  invocation and the forced cold start that follows any out-of-band Firestore
  write (D181). Each still needs Forrest's word at the time it is run.
- **Data shape?** A shape change and the code that depends on it never ship in
  the same release (expand/contract — the dev-workflow skill's
  `launch-and-cutover.md`). Say what happens to data written by this version if
  it is rolled back.

The proposal also states **what the deploy itself touches**, so Forrest doesn't
have to ask whether it changes data. The workflow publishes Hosting and the
Firestore rules file, re-applies the image and backup buckets' IAM, versioning and
lifecycle settings (identical every release), and deploys the API, which
cold-starts and re-reads the cache. It writes no Firestore record, image or
backup object, and never calls Ghost. A release changes data only through an
operator step listed above.

A change under `ghost-bridge/` means a theme upload to Ghost Pro as well —
Forrest's manual step, from the `pbe-news-ghost-theme` repo (packaged with
`git archive`, never `Compress-Archive`).

### 2. Tag, notes, dispatch (on Forrest's go-ahead)

Tags are dated: `vYYYY.MM.DD`, with `.2`, `.3` … for a second release the same
day — `v2026.10.06`, then `v2026.10.06.2`, never `-2`, which semver reads as a
pre-release of the morning's tag (Forrest's call, D194; semver itself is OFC-430's
decision, PL-14). The first release of a day always takes the bare date. Tag the exact `origin/main` commit
that was reviewed, then publish the notes as a GitHub Release on that tag — the
changes and the OFC tickets they close, **never a brother's name** (the repo is
public):

```bash
git tag -a v2026.10.05 -m "Book release v2026.10.05" <reviewed-sha>
git push origin v2026.10.05
gh release create v2026.10.05 --title "v2026.10.05" --notes-file <notes.md>
gh workflow run "Deploy production" --ref v2026.10.05
```

The gate re-runs on the tagged commit first (about four minutes for
`v2026.10.02`, and the deploy took four more after approval). When it is
green, the run pauses at **Deploy to production — waiting for review**. **Claude
then hands Forrest the run's direct link**
(`https://github.com/fthiess/pbe-address-book/actions/runs/<id>`, from
`gh run list --workflow deploy-prod.yml -L1`) and the click path: the yellow
banner's **Review deployments** → tick `production` → **Approve and deploy**. The
approval happens in GitHub, not in Firebase or the Google Cloud console.

### 3. Watch the first hour

The `CUTOVER-PLAN.md` §7 checklist, every release: the workflow's proof of life
green; Forrest signs in from pbe400.org and exercises the changed surfaces;
Cloud Run logs with **no new error types**; Mixpanel-Prod still receiving
`app = book` events. Then run any operator steps from step 1, each followed by
its cold start.

Concretely, as run for `v2026.10.02` (N182):

- the same `describe` as step 1 shows a new revision taking 100% of traffic,
  with `BOOK_API_VERSION` equal to the released commit;
- the new revision's startup line (`… N profiles cached; … bridge=…/book/`) reports
  the **same profile count** as the previous revision's last start;
- `gcloud logging read` on the service, `severity>=WARNING` since the rollout,
  turns up nothing new (`401`s on `/api/me` are ordinary signed-out visits);
- after signing in, Forrest sees the new version in Book's footer, and Mixpanel-Prod's
  live view shows his events (allow Mixpanel in any browser blocker first).

### 4. Roll back

Redeploy the tag production ran before the bad release — the same dispatch,
the same approval. Derive it fresh (shell variables from step 1 are long gone,
and the newest tag is the bad one):

```bash
PREV=$(gh run list --workflow deploy-prod.yml --status success -L2 --json headBranch --jq '.[1].headBranch')
gh workflow run "Deploy production" --ref "$PREV"
```

⚠ A dispatch runs the workflow file **as it is at that tag**, so only tags cut
after D184 can be redeployed. `v2026.09.16` carries the old, ungated workflow, and
the production trust condition (below) refuses it a credential: its deploy fails
at authentication, by design. **Rolling back the first post-D184 release
therefore means fixing forward:** `git revert` the offending merge(s) on `main`
through the usual PR, tag the result, and release it. From the second release
on, the previous tag carries the gate and redeploys normally.

That restores the SPA, the API and the Firestore rules together — about ten
minutes end to end plus the approval (the v2026.09.16 run took eight). It does **not** undo data: anything the bad version wrote
stays, which is why step 1 asks the data question in advance. A theme problem
rolls back separately, by re-uploading the previous theme zip to Ghost Pro.

## Diagnosing a failed sign-in

The sign-in page shows a brother only "Sign-in needs attention". It does not say
which check failed, and it should not. The audit log does, as a coarse `reason`
code, never the email or the token:

```bash
gcloud logging read 'jsonPayload.logType="audit" AND jsonPayload.action="auth.signin" AND jsonPayload.outcome="denied"' \
  --project pbe-book-prod --freshness=1d --limit=20 \
  --format='table(timestamp, jsonPayload.reason, jsonPayload.trace)'
```

| `reason` | What it means | Fix |
|---|---|---|
| `unlinked_member` | The email Ghost signed in with matches **no** profile | Usually the brother's Ghost address differs from Book's. An admin adds it as an alternate email on his profile |
| `ambiguous_member` | The email matches **more than one** profile (D97) | De-duplicate: remove the address from the profile that should not have it |
| `debrothered` | The profile is marked de-brothered (D115) | Working as intended, unless the mark is wrong |
| `invalid_state` | The sign-in round trip lost or replayed its nonce | Usually a stale tab or a double click: retry. If it repeats for everyone, suspect the bridge URL (`GHOST_BRIDGE_URL`'s trailing slash, N179) |
| `invalid_token` | Ghost's token failed verification (expired, wrong issuer or audience) | Isolated cases: retry. A burst: the denial-burst alert fires, so read D104/N126 |

A JWKS fault (Ghost's signing keys unreachable) is **not** a denial. It is logged
as `auth.jwks` and has its own alert (D186). Ghost rotating its member keys is
handled by itself (keys are resolved by `kid`, N191).

## Recovering a locked-out administrator (D191)

Two edits can leave an administrator unable to sign in, and Book warns before each
but does not prevent either (D191): **changing their own email** to an address
they cannot receive mail at (a typo), and **demoting themselves** when no other
administrator can actually sign in. The last-admin guard does not help with the
second — it counts admins who are usable by predicate (living, not de-brothered,
with an email), and a stale mailbox passes.

**If another administrator can sign in, they fix it in the app** — correct the
email, or restore the role, from the locked-out brother's profile. Audited, no
restart, nothing below is needed.

**On staging, reseed.** While `STAGING_AUTOSEED=true`, a deploy wipes and reseeds
`profiles` and re-applies the tester roster, which restores the roster's admin:

```bash
gh workflow run "Deploy staging" --ref main
```

(The older escape hatch — Ghost Admin's **Impersonate** on a fake admin's member —
works only while `STAGING_GHOST_MIRROR=true`, because only the mirror gives the
fake brothers Ghost members. It is `false` today. Of the two seeded admins, one is
living with an email and one is deceased; see `roleForIndex` in
`tools/fake-data/src/generate.ts` for which.)

**Otherwise — the production case while there is one administrator — repair it
out of band.** This is an out-of-band Firestore write, so D181 governs it: it is
invisible until a cold start, and an edit to the touched record gets a 412 until
then. Do it when Book is quiet, and it needs Forrest's word at the time.

1. **Firestore console → `profiles/<id>`.** For a demotion, set `role` to `admin`.
   For an email lockout, set `email` back to the working address.
2. **Email lockout only — repair Ghost too.** ⚠ Book already pushed the mistyped
   address to Ghost, and the sign-in link is sent to the address on the *Ghost
   member*. In Ghost Admin, open the member and set the same working address.
   The two must agree (case aside, D97): Book resolves the signed-in Ghost email
   against its own records and refuses a mismatch (`403 unlinked_member`).
3. **Force a cold start** (same image, new revision) and confirm
   `N profiles cached` in the new revision's startup log:

   ```bash
   IMAGE=$(gcloud run services describe pbe-book-api --region us-central1 \
     --project $PROJECT --format='value(spec.template.spec.containers[0].image)')
   gcloud run deploy pbe-book-api --image "$IMAGE" --region us-central1 --project $PROJECT
   ```

4. Sign in, and check the role or address in the app.

The durable fix is a second administrator who can really sign in.

## Loading a batch of headshots (D182) — the procedure

`npm run headshots:bulk --workspace apps/api` puts many prepared headshots onto a
**live** directory — the composite-portrait load was the first use. Per brother it
does what `PUT /api/profiles/:id/headshot` does (same `encodeHeadshot`; objects
first, pointer last), writes only `hasHeadshot` / `headshotVersion`, and skips any
profile that no longer shows the photo the operator chose against. Read D182 for
the rules; this is the runbook. Like the restore it is **invisible until a cold
start**. It supports two modes: **in maintenance** (D100; the default — uploads and
undos refuse to write unless the maintenance page is up) or **with Book up**
(`--book-up`, D181's model). Both are safe on production since D187. Before it,
the maintenance scripts republished Hosting from a local build (OFC-449), which is
why the first loads ran with `--book-up`. With Book up, the new photos are
invisible and edits to the touched records get a 412 (recovered in place, D109)
until the cold start, so run it when Book is quiet and cold-start at once.

**The plan** is a CSV, `const_id,file,expected_version`, built outside this repo (it
names real brothers' files — never commit one). `file` is a PNG or JPEG path,
relative to the plan's folder; `expected_version` is the `headshotVersion` the
profile showed when the photo was chosen, blank if it had none.

```bash
PROJECT=pbe-book-prod        # or pbe-book-staging for the rehearsal
BUCKET=pbe-book-prod-images  # IMAGE_BUCKET in infra/environments/<env>.env

# 1. Dry run: reads the live pointers, encodes every photo, writes nothing.
npm run headshots:bulk --workspace apps/api -- --project $PROJECT --bucket $BUCKET   --plan /path/to/upload-plan.csv --dry-run

# 2. The load, with Book serving. Prints the artifact path
#    (restore-artifacts/bulk-headshots-<timestamp>.json) — KEEP IT: it is the undo
#    list and the purge list.
npm run headshots:bulk --workspace apps/api -- --project $PROJECT --bucket $BUCKET   --plan /path/to/upload-plan.csv --book-up --confirm $PROJECT

# 3. IMMEDIATELY force a cold start (same image, new revision) and confirm
#    "N profiles cached" in the new revision's startup log.
IMAGE=$(gcloud run services describe pbe-book-api --region us-central1   --project $PROJECT --format='value(spec.template.spec.containers[0].image)')
gcloud run deploy pbe-book-api --image "$IMAGE" --region us-central1 --project $PROJECT

# 4. Spot-check brothers across the batch in the app.
```

(In maintenance instead: run `bash infra/maintenance-begin.sh` before step 2, with
`ENV_FILE=infra/environments/prod.env` on production, and drop `--book-up`. Run
`maintenance-end.sh` the same way after step 3's cold start.)

**Undo** — if a wrong photo turns up, or the run reported failures you do not want
to keep (add `--book-up` if the load ran that way, or put Book in maintenance first):

```bash
npm run headshots:bulk --workspace apps/api -- --project $PROJECT --bucket $BUCKET \
  --undo restore-artifacts/bulk-headshots-<timestamp>.json --confirm $PROJECT
```

(npm runs the tool with its working directory at `apps/api/`, so the relative
artifact path above is the one the load printed; an absolute path also works),
then cold start as in step 3. Undo points each profile that
still shows the run's photo back at its prior one — instantly, because the replaced
photos were never deleted — and removes the run's own objects. A profile a brother
changed since is left alone and reported. Undo and purge each write their own
record (`bulk-headshots-undo-…json` / `-purge-…json`) beside the run artifact.

**Purge** — once the result is accepted, delete the replaced photos (undo is then
impossible). It deletes only objects no profile points at, so Book can stay up:

```bash
npm run headshots:bulk --workspace apps/api -- --project $PROJECT --bucket $BUCKET \
  --purge restore-artifacts/bulk-headshots-<timestamp>.json --dry-run   # then --confirm $PROJECT
```

**Rehearsing on staging.** Staging's profiles are fake and wiped on every deploy
(N18), so rehearse with a hand-made plan: a few fake IDs (> #5000), some with a seeded
photo (use its current `headshotVersion` as `expected_version`) and some without,
pointed at a few of the AI-generated originals in
`gs://pbe-book-staging-uat/uat-photos/originals` — **never real brothers' faces on
staging**. Change one of those profiles' photos in the app after writing the plan to
see the `changed` skip. Run steps 1–4 exactly as for production (`--book-up`), then an
undo, then (after re-running the load) a purge.

## Linking profiles to Ghost members (D183) — the procedure

`npm run ghost:seed --workspace apps/api` writes each profile's `ghostMemberId`
(plus a Ghost note into a blank `adminNote`, and the real newsletter state over
the genesis placeholder). Until a profile is linked, its edits do not reach Ghost
and a primary-email edit mints a duplicate Ghost member (N180). Read D183 for the
rules; this is the runbook. It is idempotent: re-plan and re-apply whenever
profiles were skipped, or after a restore from a backup that predates the links.

⚠ **It writes to Ghost as well as Book** — a brother whose only Ghost member is at
his alternate address has that member moved to his primary. It never deletes a
Ghost member. ⚠ The plan file and the run record hold **real member emails**; they
land in `apps/api/restore-artifacts/` (gitignored — this repo is public). ⚠ Like
every out-of-band write it is **invisible until a cold start**, and edits to the
touched records get a 412 until then (D181), so apply when Book is quiet.

```bash
PROJECT=pbe-book-prod
GHOST_URL=https://pbe-news.ghost.io/ghost/api/admin   # GHOST_ADMIN_API_URL in infra/environments/<env>.env
# The Admin key rides in the environment, never on the command line:
export GHOST_ADMIN_API_KEY=$(gcloud secrets versions access latest \
  --secret ghost-admin-api-key --project $PROJECT)

# 1. Plan: reads live profiles and live Ghost, writes
#    restore-artifacts/ghost-seed-plan-<timestamp>.json, changes nothing.
npm run ghost:seed --workspace apps/api -- --project $PROJECT --ghost-url $GHOST_URL --plan

# 2. REVIEW the printed summary and the plan file: the email moves, the consent
#    overwrites, the conflicts (reported, never resolved: those profiles are not
#    linked — except book-consent-changed-since-launch, which is linked with its
#    consent left as Book has it), and the leftover / unmatched Ghost members
#    (yours to delete in Ghost Admin, or not).

# 3. Apply exactly that file. Records edited since the plan are skipped and
#    reported — re-run from step 1 to pick them up.
npm run ghost:seed --workspace apps/api -- --project $PROJECT --ghost-url $GHOST_URL \
  --apply restore-artifacts/ghost-seed-plan-<timestamp>.json --confirm $PROJECT

# 4. IMMEDIATELY force a cold start (same image, new revision) and confirm
#    "N profiles cached" in the new revision's startup log.
IMAGE=$(gcloud run services describe pbe-book-api --region us-central1 \
  --project $PROJECT --format='value(spec.template.spec.containers[0].image)')
gcloud run deploy pbe-book-api --image "$IMAGE" --region us-central1 --project $PROJECT

# 5. Admin → Ghost audit in the app: missing-member and newsletter-drift counts
#    should have collapsed to the handful the plan listed.
```

**Undo.** The apply writes `restore-artifacts/ghost-seed-run-<timestamp>.json`
before its first write — every intended action with the values it replaces — and
rewrites it with the outcome. There is no undo command (a link is harmless to
leave); to revert one by hand, delete the profile's `ghostMemberId` (and an
`adminNote` the run set), restore the recorded prior consent, move a pushed Ghost
email back, then cold start.

## Staging: reseeding and the freeze

Staging (`pbe-book-staging`) holds fake data only (D72). Whether a deploy wipes
and reseeds it is **switched by the repo variable `STAGING_AUTOSEED`**, so check it
before assuming either behaviour:

```bash
gh variable list | grep STAGING_AUTOSEED
```

- **`true` (or unset)**: every deploy wipe-reseeds `profiles` **and** `users`
  (per-viewer stars), re-mirrors Ghost and re-applies the tester roster (N18, N90).
  Hand edits do not survive a merge.
- **`false`**: the UAT freeze. A deploy ships code but leaves staging's data and
  stars as they are, so a deploy cannot replace a tester's in-progress profile
  with a blank one. Roster and photo changes must then be run by hand (below),
  and Gate 4's migration pause is back in force (D189).

**Reset staging without a merge** (about 4 minutes; reseeds if `STAGING_AUTOSEED`
allows it):

```bash
gh workflow run "Deploy staging" --ref main
```

⚠ The fake-data generator is one sequential PRNG stream, so any change to
`generate.ts` moves every later fake brother: the right id gets the wrong person
(D168). The usable staging admin is #5003, not #5004 (N189).

## The UAT fixtures bucket and the photo corpus (Stage 1.2; OFC-249)

`gs://pbe-book-staging-uat` (`UAT_FIXTURES_BUCKET` in `environments/staging.env`)
holds the two fixture sets that must never enter this **public** repo: the prepared
UAT photo corpus, and the tester roster CSV, which carries real brothers' names and
email addresses. `provision-staging.sh` §6f creates it with the same private posture
as the other buckets — uniform access, public access prevented. It exists on
**staging only**: production has no UAT, `prod.env` leaves the name unset, and
§6f/§6g skip (D185). The name used to default from `PROJECT_ID`, which is how an
empty `pbe-book-prod-uat` appeared at cutover; it was deleted under OFC-425.

⚠ **It is a separate bucket from the image bucket on purpose, and must stay that
way.** The Book runtime service account holds `objectAdmin` on
`pbe-book-staging-images` so it can write headshots; a roster of real member PII
parked there would sit inside the running application's blast radius. This bucket
grants the runtime SA nothing at all. Do not "simplify" it into a prefix on the
image bucket.

⚠ **Read the redundancy note in §6g before drawing conclusions about access.** The
CI deployer's bucket-scoped `objectViewer` grant is documentation of intent, not a
restriction: `setup-wif.sh` gives it project-level `roles/storage.admin`, and D185
declined to narrow that.
The property that actually holds is the *absence* of a runtime-SA binding.

### Preparing and uploading the photo corpus

The corpus is ~400 AI-generated 1024² PNG headshots. They are transcoded **once**,
through the production `encodeHeadshot` — the same code path a real member upload
takes — into the 512² headshot and 96² thumbnail WEBPs the app serves, and the
result is what lives in the bucket. Encoding at seed time instead would pull ~540 MB
to a GitHub runner and run ~800 sharp operations on **every** deploy to recompute a
byte-identical result; preparing once reduces that to ~12 MB of WEBP the seeder
copies like any other fixture.

```bash
# 1. Transcode locally. --out is gitignored (uat-artifacts/); --dry-run previews.
npm run prepare:uat-photos --workspace apps/api -- \
  --source "/path/to/book_fake_headshots" --out ./uat-artifacts/uat-photos
```

```bash
# 2. Upload the prepared set. This is what seed:staging-images reads.
gcloud storage rsync -r ./uat-artifacts/uat-photos \
  gs://pbe-book-staging-uat/uat-photos/prepared --project=pbe-book-staging
```

```bash
# 3. Optional: archive the 1024² originals so the prepared set is reproducible
#    from the bucket alone, without anyone's local copy.
gcloud storage rsync -r ./book_fake_headshots \
  gs://pbe-book-staging-uat/uat-photos/originals --project=pbe-book-staging
```

The upload writes `manifest.json` alongside the derivatives, recording the count and
the sizes the set was encoded at. That last part is load-bearing: the corpus is
prepared once and then sits in the bucket indefinitely, so if `HEADSHOT_SIZE` or
`THUMBNAIL_SIZE` ever change, the seeder compares and **warns** rather than quietly
serving wrong-sized fixtures. Re-run steps 1 and 2 when that happens.

### The tester roster

The same bucket holds `roster/uat-testers.csv` — the UAT tester cohort, and the only
**real** member PII anywhere in this environment. Columns: `profileId`, `firstName`,
`lastName`, `classYear`, `email`, `role`; only the names and `email` are required.

```bash
# Edit locally (keep it OUT of the repo), then upload:
gcloud storage cp ./pbe_book_uat_roster.csv \
  gs://pbe-book-staging-uat/roster/uat-testers.csv --project=pbe-book-staging
```

```bash
# Preview what a roster change would do — always do this before a real run:
GOOGLE_CLOUD_PROJECT=pbe-book-staging \
UAT_ROSTER_URI=gs://pbe-book-staging-uat/roster/uat-testers.csv \
GHOST_ADMIN_API_URL=https://staging.pbe400.org/ghost/api/admin \
GHOST_NEWSLETTER_ID=6a3ebdd8415f8e0001858cb0 \
GHOST_ADMIN_API_KEY="$(gcloud secrets versions access latest --secret=ghost-admin-api-key --project=pbe-book-staging)" \
  npm run seed:staging-testers --workspace tools/fake-data -- --dry-run
```

Testers occupy their own id block from `TESTER_ID_FLOOR` (#9001+), so they never
overwrite a generated fixture. A blank `profileId` is auto-assigned; the first data
row defaults to `admin` and the rest to `brother`.

**Adding or removing a tester is a CSV edit plus a reseed.** `seed:staging` wipes
`profiles` before the tool runs, so a dropped row never comes back and its Ghost
member is deleted as a labelled orphan. Shrinking the cohort back to one person is
the same operation.

⚠ **Ghost matching is by email, deletion by label** (`book-uat-tester`). Ghost
enforces email uniqueness globally, so an account that already exists under a roster
address is adopted rather than duplicated — scoping matching to the label alone
produces `422 Member already exists`, which is how this was found. Once adopted, a
member is inside the delete scope; in practice the only such account is the
operator's own, which is row 1 and never removed.

⚠ **`send_email=false` on member creation is load-bearing.** Since D154
ghost-staging sends real mail through a verified Mailgun domain, and these are real
brothers' addresses. A tester must never learn they exist from a provisioning run.

⚠ **During UAT, `STAGING_AUTOSEED=false`** stops the whole reseed, this step
included — which is the point: a deploy must not replace a tester's in-progress
profile with a blank one. Roster changes during the window are run by hand.

### How the seeder uses it

`seed:staging-images` reads `UAT_FIXTURES_BUCKET` (passed through by the deploy
workflow). Assignment is deterministic — profiles in ascending id order, photos in
ascending index order — so a reseed puts the same face on the same brother; random
assignment would make "my photo changed" a bug report nobody could reproduce. The
corpus holds 438 photos (OFC-355 added the last thirty, to match the population of
the time), and it covers the current `hasHeadshot` population of 419 with 19 to
spare, so no profile falls back to a placeholder. A successful deploy logs
`419 from the UAT corpus, 0 from the committed placeholders` and then `19 prepared
photo(s) unused` (reseed of 2026-10-04). ⚠ The population is a property of the
generator, not the corpus. `generateProfiles()` draws from one sequential PRNG
stream, so any change to `generate.ts` can move it. The 438 → 419 drop most likely
came from D179's fake-ZIP change (#219), the only `generate.ts` change since the
last reseed. Read the count from the latest deploy log rather than trusting this
paragraph; the number to check is `0 from the committed placeholders`.
Should the corpus ever again be smaller than the population, the lowest ids take
the real faces and the rest fall back to the eight committed placeholders. Faces
are never repeated to close such a gap: a duplicated face reads as a data
integrity bug, whereas a placeholder reads as "no photo on file", which is both true
and what roughly a third of the real membership will show. Photos beyond the
population size are simply unused — `planPhotoAssignments` caps at the population
and logs the surplus.

**Every failure here is non-fatal.** Bucket unset, manifest missing, download
failed — each logs a loud warning and falls back to placeholders for the whole
population. A deploy must not break because an optional fixture set is unreachable.
