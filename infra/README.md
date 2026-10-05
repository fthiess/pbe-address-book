# Infrastructure — provisioning playbook

> **This document is for building Book's environments and for routine
> operations** (maintenance, releases, cold starts, an admin lockout, staging and
> UAT chores). **If Book's data is lost or corrupted, the production project is
> damaged, or the backup-integrity check has failed, use the disaster runbook
> instead: [`DR-RUNBOOK.md`](DR-RUNBOOK.md).**

How Book's cloud environment is built, as a reproducible playbook. This is the
interim, imperative form; the fuller ephemeral setup/teardown automation (and
the Terraform-vs-scripts decision) is Phase 7 work (DECISIONS **D102**). For now
this folder is both the **runbook** (read it) and the **provisioner** (run it).

Each environment is its own GCP project (`pbe-book-staging`, later
`pbe-book-prod`) — the project is the isolation boundary; nothing is shared but
the billing account. Resource names are identical across environments except the
GCS bucket, whose name is globally unique (so it carries the environment).

## What's automated

[`provision-staging.sh`](provision-staging.sh) builds an environment from
scratch: project → billing → APIs → Firestore (native, regional, with delete
protection and point-in-time recovery enforced on every run — D185) → private image
bucket → private backup bucket → least-privilege runtime service account →
backup-scheduler service account → Cloud Run deploy → the backup schedule. It
is parameterized and idempotent where cheap to be, so it can recreate or converge
an environment.

```bash
# from the repo root, authenticated as an owner of the billing account
PROJECT_ID=pbe-book-staging REGION=us-central1 \
BILLING_ACCOUNT=00839F-755E1F-BA1FA4 \
bash infra/provision-staging.sh
```

**Production** (`pbe-book-prod`, built 2026-09-15 — DECISIONS D180) uses the
same script with the environment file selected by `ENV_FILE`; the three scripts
default to `environments/staging.env`:

```bash
ENV_FILE=infra/environments/prod.env BILLING_ACCOUNT=00839F-755E1F-BA1FA4 bash infra/provision-staging.sh
ENV_FILE=infra/environments/prod.env bash infra/setup-wif.sh
ENV_FILE=infra/environments/prod.env bash infra/provision-observability.sh
```

⚠ `ENV_FILE` matters: the scripts `source` the env file with `set -a`, so a
`PROJECT_ID` exported in the shell is **overridden** by the file's value — the
file, not the environment, decides which project is touched. The custom domain +
managed TLS for `book.pbe400.org` is a console step (`CUTOVER-PLAN.md` §3), and
the production deploy is `.github/workflows/deploy-prod.yml` (a manual dispatch
on a release tag — see "Releasing to production" below), never this script's
Cloud Run step after first bring-up.

**The backup-integrity project** (`pbe-book-verify`, D151/D193) is built by its own
script, [`provision-verify-project.sh`](provision-verify-project.sh), against the
environment it verifies. ⚠ It grants that project read on production's backup and
image buckets, so it is Forrest's to run. Its procedure, first run and alert test
are in [`DR-RUNBOOK.md`](DR-RUNBOOK.md), "The integrity job itself".

## What's interactive / not in the script (and why)

These need a human in a browser or are environment-policy choices, so they're
documented rather than scripted:

- **`gcloud auth login`** — authenticate the CLI as an owner. One-time per machine.
- **`gcloud auth application-default login`** — sets ADC so local tools (the
  staging seeder) can reach the project. On the consent screen, **tick "See,
  edit, configure, and delete your Google Cloud data"** (the `cloud-platform`
  scope) or it fails.
- **Seeding fake data** (staging only — D72), after ADC:
  ```bash
  GOOGLE_CLOUD_PROJECT=pbe-book-staging npm run seed:staging --workspace tools/fake-data
  ```
  There is no write path yet, so after seeding force a fresh Cloud Run revision so
  the in-memory cache re-hydrates (Phase 2 adds write-driven refresh):
  ```bash
  gcloud run services update pbe-book-api --region us-central1 \
    --update-env-vars SEEDED_AT=$(date +%s)
  ```

## Keyless CI deploys (Workload Identity Federation)

[`setup-wif.sh`](setup-wif.sh) wires up deploy-on-merge: GitHub Actions deploys
the API (Cloud Run), the SPA (Firebase Hosting), and the Firestore security rules
with **no service-account key anywhere**. A key would be a long-lived secret in a
*public* repo's secret store;
instead GitHub mints a short-lived OIDC token that Google trusts **only for this
one repository** (`fthiess/pbe-address-book`), enforced by an attribute condition
on the OIDC provider. That condition is the load-bearing security control. On
production it also requires the OIDC `environment` claim to be `production`
(`WIF_REQUIRED_ENVIRONMENT` in `prod.env`, D184): only a job running in the
approval-gated GitHub Environment can get a production credential. Re-run the
script with `ENV_FILE=infra/environments/prod.env` after changing it.

```bash
# once per environment, authenticated as a project owner
PROJECT_ID=pbe-book-staging GITHUB_REPO=fthiess/pbe-address-book \
bash infra/setup-wif.sh
```

It creates a workload identity pool + provider, a dedicated `github-deployer`
service account (deploy-only least privilege: `run.admin`,
`cloudbuild.builds.editor`, `artifactregistry.writer`, `storage.admin`,
`firebasehosting.admin`, `firebaserules.admin`,
`serviceusage.serviceUsageConsumer` (the firestore-rules deploy preflight reads
whether the Firestore API is enabled), plus `iam.serviceAccountUser` scoped to the
runtime `book-api` SA and the Cloud Build SA), and the `workloadIdentityUser`
binding that lets the repo impersonate it. It prints the provider resource name + SA email —
the two non-secret values that go in
[`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml).

That workflow triggers on the **push to `main` directly** (D143). A red `main` is
still never deployed, but the guarantee is carried by **branch protection**, not by
a post-merge test run: `main` requires a pull request whose `Verify gate` check
passed `strict` (branches up to date before merging), and admin bypass is off — so
a commit can only reach `main` already-green. The workflow previously waited on a
CI `workflow_run`; that post-merge re-run was removed because it replayed the
PR run against an identical tree.

**Node-version landmine (don't "fix" it):** the Firebase deploy step pins the
Firebase CLI to **Node 20**, even though the rest of the repo is on Node 24. Under
Node 24, `google-auth-library`'s STS token exchange (how the CLI redeems the WIF
credential) dies with `Premature close` (an undici failure) and the deploy fails
with a misleading "have you run firebase login?". `gcloud` is unaffected (its STS
client is not Node). Keep the Node-20 override until firebase-tools ships a fixed
auth library — this will apply to prod too.

**Considered and declined (D185): narrowing the deployer's storage grant and
giving Cloud Build its own service account.** This README used to suggest both
"for production later". Neither would change what a compromised deployer could
do. The deploy workflows set IAM, versioning and lifecycle on the image and
backup buckets, so the deployer needs bucket *admin* there, not `objectAdmin`.
And `run.admin` plus `serviceAccountUser` on the runtime SA already lets it run
code with everything Book can reach. Cloud Build still runs as the Compute Engine
default SA, which holds `roles/editor` on production (checked 2026-10-03), but
only the deployer can start a build, and only from this repo's Dockerfile.
Book's deploy trust boundary is the WIF condition plus Forrest's approval in the
`production` environment (D184), and that is where the hardening went.

## Observability — audit retention, metrics, alerting, log-reader SA (7a-3c)

[`provision-observability.sh`](provision-observability.sh) makes Book's three log
streams (audit / diagnostic / access — ENGINEERING-DESIGN §6.1) actually *observed*.
The streams already emit distinguishable structured JSON (`logType`, `severity`,
`action`); until this script runs, nothing routes, retains, measures, or alerts on
them — `audit-log.ts`'s claim that `logType:"audit"` "routes this stream to its
longer-retention bucket" is aspirational until then. Like the other two scripts it
is **Forrest-run** (it makes live IAM / sink / alert changes) and idempotent.

```bash
# from the repo root, authenticated as a project owner, with the beta components.
# ALERT_EMAIL is read from environments/staging.env (its single home); override here
# only to redirect. Optionally set LOG_READER_PRINCIPAL to grant an assumer (below).
PROJECT_ID=pbe-book-staging REGION=us-central1 \
bash infra/provision-observability.sh
```

It spans **two** project-native GCP products — no new Book dependency:

- **Cloud Logging** — a user-defined **audit bucket** with **90-day retention**
  (P16, aligned with the backup/headshot windows); a **sink** routing
  `jsonPayload.logType="audit"` (from this service) into it; two **log-based
  counter metrics** (`book_auth_signin_denied`, `book_auth_jwks_failure` — kept
  distinct so a Ghost JWKS outage can't inflate the denial metric and a forged-token
  burst can't hide in the JWKS one, N126); and the keyless **log-reader SA**.
- **Cloud Monitoring** — an **email notification channel** and four alert
  policies: the **sign-in-denial burst**, the two **backup** policies (7b-2, below),
  and the **Ghost-JWKS failure** alert (D186: more than `JWKS_FAILURE_THRESHOLD`,
  default 1, `auth.jwks` events in 10 minutes, meaning brothers are being refused
  sign-in because Ghost's key endpoint is unreachable). Cloud Monitoring's own
  infrastructure sends the email; Book has no mail wiring and is not involved.

Two design points worth keeping in view:

- **Least-privilege read (not project-wide `logging.viewer`).** The log-reader SA
  gets `roles/logging.viewAccessor` **conditioned to the audit bucket's `_AllLogs`
  view** — true "viewer over the audit stream" only. Because only the audit sink
  targets that bucket, the view contains audit entries and nothing else; the SA
  cannot read the diagnostic stream or any other logs. It is **keyless** — consumers
  impersonate it (the Linter's D58/§5.2 off-Ghost-path pattern), never a downloaded
  key in this public repo's blast radius. **Who may assume it is a separate grant:**
  set `LOG_READER_PRINCIPAL` (a full IAM member string, e.g. `user:you@example.com`)
  to grant `roles/iam.serviceAccountTokenCreator` on the SA — paired with SA creation
  the way `setup-wif.sh` pairs the deployer SA with its `workloadIdentityUser`
  binding. It is **unset by default**: no consumer is built yet (the D91 local-model
  agent, OFC-214), so the SA has no assumer until one is named — an announced gap,
  not a silent one.
- **Idempotent, and it *converges*.** Re-running reconciles every resource to the
  script's declared values — including the alert policy (edited `DENIAL_BURST_THRESHOLD`
  or a changed `ALERT_EMAIL` is applied to the existing policy, not skipped). The
  file/`staging.env` is the source of truth, so a threshold tuned only in the console
  is overwritten on the next run — tune it in `DENIAL_BURST_THRESHOLD` (or
  `JWKS_FAILURE_THRESHOLD`), not the console.
- **D91 stops at the SA.** The script provisions the reader identity and **does
  not** connect it to any cloud LLM. The planned log-reader agent is first-party /
  on-premise / **local-model** only — no audit content egresses to an external LLM.
  Wiring a cloud model to this SA would violate D91 and must be a separate, explicit
  decision (this is the crux any future alerting-to-Slack/Claude flow, OFC-214, must
  reconcile).

Production runs the same script with `ENV_FILE=infra/environments/prod.env`
(see "What's automated"); the retention horizon and least-privilege posture carry
over unchanged, and `prod.env` gives the policies honest production names.

### Verifying observability (7a-3c) — the synthetic-denial live test

The alert has a synthesizable signal today: a burst of denied sign-ins. After the
API is deployed and has served at least one request (so the audit stream exists):

1. **Fire a burst of denials.** Each `POST /api/auth/session` with a bogus
   token/state is a denied sign-in (`401`) and emits one `auth.signin` `denied`
   audit line. Fire more than the threshold (default **10 per 5-minute window**):
   ```bash
   for i in $(seq 1 15); do \
     curl -s -o /dev/null -X POST https://pbe-book-staging.web.app/api/auth/session \
       -H 'content-type: application/json' -d '{"token":"x","state":"y"}'; \
   done
   ```
2. **Confirm the audit lines landed** (and are routed) in Logs Explorer or the CLI:
   ```bash
   gcloud logging read \
     'jsonPayload.logType="audit" AND jsonPayload.action="auth.signin" AND jsonPayload.outcome="denied"' \
     --project pbe-book-staging --freshness=10m --limit=20
   ```
3. **Watch the metric climb, then the alert trip.** Cloud Monitoring evaluates the
   `book_auth_signin_denied` metric over the 5-minute window; when the summed count
   crosses the threshold the policy fires and Cloud Monitoring emails `ALERT_EMAIL`.
   (Metric ingestion + evaluation lags a couple of minutes — this is not instant.)
4. **Confirm retention routing.** The same denial lines should appear when reading
   the audit bucket's view, proving the sink routes `logType=audit` there:
   ```bash
   gcloud logging read 'jsonPayload.logType="audit"' \
     --project pbe-book-staging --bucket=audit-logs --location=us-central1 \
     --view=_AllLogs --limit=5
   ```

### Verifying the Ghost-JWKS alert (D186) — a synthetic audit entry

Ghost-staging can't be made to fail its JWKS endpoint on demand, so this test
starts one step later. It writes the exact audit line Book emits on a JWKS fault,
attached to the Cloud Run service, through the Logging API. That proves the
metric, the policy and the email end to end. It does **not** prove Book emits the
line; the auth route's unit tests cover that.

Run it on **staging only**. The entries land in the audit bucket with the 90-day
retention, so they go to their own log name (`book-synthetic-test`) and carry a
`trace` that marks them as synthetic. The metric and the audit sink filter on the
payload and the Cloud Run service, not the log name.

```bash
PROJECT=pbe-book-staging
REV="$(gcloud run services describe pbe-book-api --region us-central1 --project "$PROJECT" --format='value(status.latestReadyRevisionName)')"
for i in 1 2 3; do
  curl -s -X POST https://logging.googleapis.com/v2/entries:write \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H 'content-type: application/json' \
    -d "{\"logName\":\"projects/$PROJECT/logs/book-synthetic-test\",
         \"resource\":{\"type\":\"cloud_run_revision\",\"labels\":{\"project_id\":\"$PROJECT\",
           \"service_name\":\"pbe-book-api\",\"revision_name\":\"$REV\",
           \"location\":\"us-central1\",\"configuration_name\":\"pbe-book-api\"}},
         \"entries\":[{\"severity\":\"ERROR\",\"jsonPayload\":{\"logType\":\"audit\",
           \"action\":\"auth.jwks\",\"outcome\":\"error\",\"trace\":\"synthetic-jwks-test-$i\"}}]}"
done
```

Within a few minutes the `book_auth_jwks_failure` metric shows 3 and the policy
fires an email to `ALERT_EMAIL`. It closes itself 30 minutes after the count
drops back.

## The automated backup (7b-2)

`provision-staging.sh` creates the backup bucket, its 90-day lifecycle rule, the
`book-backup-scheduler` service account, and a Cloud Scheduler job that POSTs to
`/api/internal/backup` twice daily (03:10 and 15:10 UTC) with an OIDC token.
`provision-observability.sh` adds the three log-based metrics and both alert
policies.

**Why twice daily and not once (D149).** Not for RPO — at ~2 edits/month the
expected loss between any of these cadences is a fraction of one edit. Two other
reasons decide it. In a system that can go months without a write, the backup's
real job is to *exercise the pipeline*: each run re-proves Firestore is readable,
the service account holds its grants, the bucket exists, and the last deploy did
not break the path — the failure that hurts a low-write system is a backup that
broke in March and is found in September. And concretely, 12h between healthy runs
is what makes the metric-absence alert possible at all: Cloud Monitoring caps that
trigger window at 23.5h, so a 24h cadence cannot be watched for absence. Trimming
back to daily would silently delete that alert, not just coarsen it.

**Why an endpoint and not a cron:** Cloud Run is scaled to zero (D83), so no
process is alive to hold a timer. The schedule has to come from outside.

**The one configuration value that will bite you.** Book pins the scheduler's
`sub` claim, and a Google OIDC token's `sub` is the service account's **numeric
unique ID**, not its email. `provision-staging.sh` derives the live value for its
own deploy and warns if `environments/staging.env` disagrees — but the GitHub
deploy workflow cannot run `gcloud` and trusts `staging.env` alone, so a stale
value there means the next CI deploy ships a service that rejects every scheduler
token, and backups stop with no symptom until the staleness alert fires a day
later. Read the correct value with:

```bash
gcloud iam service-accounts describe book-backup-scheduler@pbe-book-staging.iam.gserviceaccount.com --project pbe-book-staging --format='value(uniqueId)'
```

### Verifying the backup (7b-2) — force a run

```bash
gcloud scheduler jobs run book-daily-backup --location=us-central1 --project=pbe-book-staging
```

Then confirm, in order:

1. **A snapshot object landed.** `gcloud storage ls gs://pbe-book-staging-backups/backups/`
   — one new `<ISO>.json`, with colons replaced by dashes.
2. **It carries the manifest.** Download it and check `version: 2`, non-empty
   `collections.profiles`, and an `images` entry per brother with a headshot.
3. **The audit line exists:**
   ```bash
   gcloud logging read 'jsonPayload.logType="audit" AND jsonPayload.action="backup.auto"' --project pbe-book-staging --freshness=10m --limit=5
   ```
4. **The staleness detector works.** Because staging's schedule sits paused
   between test sessions, the *first* run after a gap legitimately reports a stale
   history and trips the alert — that is the detector working, not a
   misconfiguration. To see the line:
   ```bash
   gcloud logging read 'jsonPayload.logType="diagnostic" AND jsonPayload.message="backup staleness threshold exceeded"' --project pbe-book-staging --freshness=1h --limit=5
   ```
   Run the job a second time immediately afterwards and the line should be
   **absent**, because the snapshot from step 1 is now minutes old.

5. **The absence backstop is armed.** `provision-observability.sh` creates a
   metric-absence policy that fires when no successful backup has been recorded in
   20 hours — the only detector that sees a job which never ran at all. ⚠ It is
   **inert until the first successful backup**, because Monitoring needs one data
   point before it can call a series absent, so do not read early silence on a
   fresh environment as health. And ⚠ its window is **arithmetically coupled to
   the twice-daily cadence**: it must exceed the 12h gap between healthy runs and
   stay under Monitoring's 23.5h ceiling. Moving the schedule back to daily does
   not coarsen this alert, it **deletes** it (D148 → D149).

This is a backup-integrity backstop, **not** an availability monitor — it is up to
20 hours slow and exercises only the Firestore-read/GCS-write/OIDC path. "Book is
down" is a separate instrument: a Cloud Monitoring uptime check against
`/api/health` (OFC-329).

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

## Restoring from a backup, and disaster recovery

These moved to **[`DR-RUNBOOK.md`](DR-RUNBOOK.md)** (PL-6b, OFC-333/OFC-356): restoring
a live environment in place from a backup (D101/D150), standing Book up from
nothing (D102), and the backup-integrity job (D151) — what it proves, how it is
provisioned (`provision-verify-project.sh`), and what to do when it alerts.

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
day (semver is OFC-430's decision, PL-14). Tag the exact `origin/main` commit
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

## Architecture invariants the playbook encodes

- Cloud Run: `--max-instances=1 --min-instances=0` — single authoritative
  instance, scale-to-zero cost floor (D83). **Both levels are pinned (OFC-209):**
  `--max-instances` is *revision*-level only, and a new service carries a
  platform-default *service*-level umbrella of **20** that no gcloud flag clears
  (`gcloud run services update --max-instances=1` does not touch it — verified on
  577.0.0). The script pins it via the v2 REST `scaling.maxInstanceCount` PATCH so
  the console reports "Max: 1" and the invariant is enforced at both levels. Don't
  substitute `--scaling=1`: that is MANUAL mode, which pins one instance running
  permanently and destroys the scale-to-zero floor. A deploy preserves the pin.
- **No Cloud CDN and no external load balancer** — member images are app-served
  from the private bucket (D126).
- Cloud Run: `--memory 1Gi` — the headshot pipeline decodes uploaded images with
  sharp in-process (4c-1), and the single instance also holds the whole profile
  cache, so a decode spike is a whole-app OOM risk at the default 512 MiB; the
  upload route also serializes decodes through an in-process concurrency-1
  semaphore (N42). **This applies to prod too.**
- The private image bucket has **object versioning** on and a **90-day
  noncurrent-age Delete lifecycle rule** (D94/N42): the headshot pipeline deletes
  each superseded object on replace/remove, which — with versioning — only
  archives it, so a mistake is recoverable for 90 days before the rule purges it.
- The **runtime** service account (`book-api@…`) holds `storage.objectAdmin` on
  the image bucket (not just `objectViewer`): the 4c-1 pipeline creates and deletes
  headshot/thumbnail objects, not only reads them.
- The **deploy workflow reconciles the image bucket** (that `objectAdmin` grant +
  versioning + lifecycle) on every run, so these can't drift from this script on an
  already-provisioned environment (DECISIONS N48) — the gap that once left staging's
  runtime SA read-only and 500'd the first upload. Keep the same step in any prod
  deploy workflow.
- **`gcloud storage`, never `gsutil`.** Google drops `gsutil` from the default
  gcloud bundle from **March 2027**. An audit on 2026-10-03 (OFC-312) found no
  script, workflow or tool using it, so nothing breaks; don't introduce it.
- `--allow-unauthenticated` is intentional: the endpoint is reachable, but
  authentication is enforced by the app's session layer (D126); staging is fake
  data only (D72).

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

## Testing the Book→Ghost write path against ghost-staging (Phase 5b-1)

The write path (create/update/delete a Ghost member) only runs when the Cloud Run
service has a Ghost Admin key; without it the app uses the succeed-and-log stub and
edits never reach Ghost. Testing it against ghost-staging (never production — D72)
is opt-in, in three parts:

**One-time: the Admin key in Secret Manager.** The key is `{id}:{secret}` from
ghost-staging's custom integration. It is **never** in the repo:

```bash
# create the secret (printf, not echo — no trailing newline in the value)
printf '%s' '<ID>:<SECRET>' | gcloud secrets create ghost-admin-api-key \
  --project=pbe-book-staging --replication-policy=automatic --data-file=-
# the Cloud Run runtime SA reads it at request time…
gcloud secrets add-iam-policy-binding ghost-admin-api-key --project=pbe-book-staging \
  --member=serviceAccount:book-api@pbe-book-staging.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
# …and the deploy SA reads it for the seed-mirror step (below)
gcloud secrets add-iam-policy-binding ghost-admin-api-key --project=pbe-book-staging \
  --member=serviceAccount:github-deployer@pbe-book-staging.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

The deploy wires `--set-secrets GHOST_ADMIN_API_KEY=ghost-admin-api-key:latest`
plus the non-secret `GHOST_ADMIN_API_URL` / `GHOST_NEWSLETTER_ID` (in
`environments/staging.env`). To rotate the key, add a new version
(`gcloud secrets versions add ghost-admin-api-key --data-file=-`) — `:latest`
follows it on the next deploy.

**Per testing session: the mirror.** ghost-staging needs real members matching the
fake profiles. Set the repo variable `STAGING_GHOST_MIRROR=true`; the next deploy's
seed step runs `mirror:ghost-staging`, a **delta reconcile** that creates/updates/
deletes only Ghost members with a fake `@example.test` email to match the fake
profiles and writes each real `ghostMemberId` back into Firestore. Re-running it (another
deploy, or the script by hand) is the **reset** after a session mutated Ghost — it
only fixes what changed, so it is cheap after the initial ~1k-member build. The fake
generator no longer mints ids, so with the flag off every profile cleanly skips the
push (no stale-id `502`); the mirror is the sole source of real ids.

Run it by hand (e.g. to reset mid-session without a deploy):

```bash
GOOGLE_CLOUD_PROJECT=pbe-book-staging \
GHOST_ADMIN_API_URL=https://staging.pbe400.org/ghost/api/admin \
GHOST_NEWSLETTER_ID=6a3ebdd8415f8e0001858cb0 \
GHOST_ADMIN_API_KEY="$(gcloud secrets versions access latest --secret=ghost-admin-api-key --project=pbe-book-staging)" \
  npm run mirror:ghost-staging --workspace tools/fake-data   # add `-- --dry-run` to preview
```

When done testing, set `STAGING_GHOST_MIRROR=false` (or unset it) so ordinary
deploys neither touch nor depend on ghost-staging. The `@example.test` email scope
means the mirror can never touch your own account or the linter member on
ghost-staging (real emails), and it cleans up members the real write path creates
during a session (which carry no distinguishing label).

## Teardown

To remove an environment entirely, delete the project (reclaims everything;
the id stays reserved):

```bash
gcloud projects delete pbe-book-staging
```
