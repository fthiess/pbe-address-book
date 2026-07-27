#!/usr/bin/env bash
#
# Provision (or re-provision) a Book environment on GCP from scratch.
#
# This is the imperative "playbook" form of Book's infrastructure. DECISIONS
# D102 calls for ephemeral, script-provisioned environments; the fuller
# setup/teardown + backup-integrity automation (and the Terraform-vs-scripts
# decision) is Phase 7. Until then, this script is the reproducible record of how
# an environment is built — run it to recreate one, or read it as the runbook.
#
# Parameterized by project id and region, so the same script builds STAGING and,
# later, PROD. It is idempotent where that is cheap: steps that would error on
# "already exists" are guarded, so it can be re-run to converge an environment.
#
# Architecture notes baked in (see docs/initial-build/DECISIONS.md):
#   - Cloud Run is scale-to-zero, capped at one instance (D83).
#   - Member images are app-served from a PRIVATE bucket — no Cloud CDN, no
#     external load balancer (D126).
#   - The service allows unauthenticated *invocation*; real auth is enforced by
#     the app's session layer (D126). Staging holds fake data only (D72).
#
# Prerequisites (interactive, not scripted here):
#   - gcloud installed; `gcloud auth login` as an owner of the billing account.
#   - Run from the REPO ROOT (the Cloud Run deploy builds `.` via the Dockerfile).
#
# Usage:
#   PROJECT_ID=pbe-book-staging REGION=us-central1 \
#   BILLING_ACCOUNT=00839F-755E1F-BA1FA4 \
#   bash infra/provision-staging.sh
#
set -euo pipefail

# Load the shared environment values (single source of truth; OFC-84) so this
# script, setup-wif.sh, and the deploy workflow agree. The ${VAR:-default}
# fallbacks below still apply to anything the file omits (or if it is absent).
ENV_FILE="$(dirname "$0")/environments/staging.env"
# shellcheck disable=SC1090,SC1091
if [ -f "${ENV_FILE}" ]; then set -a; . "${ENV_FILE}"; set +a; fi

PROJECT_ID="${PROJECT_ID:-pbe-book-staging}"
REGION="${REGION:-us-central1}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"
IMAGE_BUCKET="${IMAGE_BUCKET:-${PROJECT_ID}-images}"
# Private UAT fixtures (photo corpus + tester roster CSV; OFC-248/OFC-249). Kept
# apart from IMAGE_BUCKET because the roster is real member PII and the Book runtime
# SA must have no access to it — see section 6f.
UAT_FIXTURES_BUCKET="${UAT_FIXTURES_BUCKET:-${PROJECT_ID}-uat}"
SERVICE="${SERVICE:-pbe-book-api}"
SA_NAME="${SA_NAME:-book-api}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# The automated daily backup (D63/D101/D102; 7b-2). The bucket holds off-platform
# PII and is treated as crown jewels: ACL-restricted, never public, GCS default
# encryption at rest, and snapshots aged out at BACKUP_RETENTION_DAYS (P16 — the
# same 3-month horizon as the audit log and superseded headshot versions).
BACKUP_BUCKET="${BACKUP_BUCKET:-${PROJECT_ID}-backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-90}"
BACKUP_SA_NAME="${BACKUP_SA_NAME:-book-backup-scheduler}"
BACKUP_SA_EMAIL="${BACKUP_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BACKUP_JOB_NAME="${BACKUP_JOB_NAME:-book-daily-backup}"
# TWICE daily, 03:10 and 15:10 UTC (D149). Cron is in BACKUP_TIME_ZONE.
#
# Not chosen for RPO — at Book's write volume (~2 edits/month, D102) the expected
# loss between any of these cadences is a fraction of one edit. Two things decide
# it. First, in a system that can go months without a write, the backup's real job
# is to EXERCISE THE PIPELINE: each run re-proves Firestore is readable, the
# service account still holds its grants, the bucket exists, the schedule fires,
# and the last deploy did not break the path. The failure that actually hurts a
# low-write system is a backup that broke in March and is discovered in September.
# Second, and concretely: 12h between successful runs is what makes the external
# metric-ABSENCE alert constructible at all, since Cloud Monitoring caps its
# trigger window at 23.5h and a 24h cadence therefore cannot be watched that way
# (D148 → D149).
#
# The two runs are exactly 12h apart on purpose — an uneven split would make the
# longer gap the one both thresholds have to tolerate, costing detection speed for
# no benefit.
BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-10 3,15 * * *}"
BACKUP_TIME_ZONE="${BACKUP_TIME_ZONE:-Etc/UTC}"
# The `aud` Book requires in the scheduler's OIDC token. A deliberately FIXED
# logical string, not the Cloud Run URL: the URL is not known until after the
# service is deployed, but the deploy needs this value in its environment — and
# Book verifies the claim itself (the service is --allow-unauthenticated because
# Hosting fronts it), so nothing downstream requires it to be a real address.
BACKUP_AUDIENCE="${BACKUP_AUDIENCE:-https://${PROJECT_ID}.example/api/internal/backup}"

# Ghost auth-bridge config (Phase 1b). Defaults target the SELF-HOSTED
# ghost-staging at staging.pbe400.org (D72, amended — auth is tested against an
# isolated open-source Ghost, not live pbe400.org). GHOST_BRIDGE_TARGET selects
# which callback the relay routes to. Prod cutover overrides these with pbe400.org.
GHOST_JWKS_URL="${GHOST_JWKS_URL:-https://staging.pbe400.org/members/.well-known/jwks.json}"
GHOST_JWT_ISSUER="${GHOST_JWT_ISSUER:-https://staging.pbe400.org/members/api}"
GHOST_JWT_AUDIENCE="${GHOST_JWT_AUDIENCE:-https://staging.pbe400.org/members/api}"
GHOST_BRIDGE_URL="${GHOST_BRIDGE_URL:-https://staging.pbe400.org/book}"
GHOST_BRIDGE_TARGET="${GHOST_BRIDGE_TARGET:-staging}"

# Ghost Admin API (Phase 5b-1 write path). The key is NOT here — it is in Secret
# Manager (secret `ghost-admin-api-key`, created out-of-band) and referenced by the
# Cloud Run deploy via --set-secrets below. These two are non-secret.
GHOST_ADMIN_API_URL="${GHOST_ADMIN_API_URL:-https://staging.pbe400.org/ghost/api/admin}"
GHOST_NEWSLETTER_ID="${GHOST_NEWSLETTER_ID:-6a3ebdd8415f8e0001858cb0}"

# A freshly-created service account is not immediately visible to the rest of GCP:
# for several seconds after creation, commands that reference it can fail with
# "does not exist" (eventual consistency). provision-observability.sh learned this
# the hard way on its first cold provision and carries the same helper; this is the
# sibling copy, kept local because the two scripts are run independently and
# neither sources the other. With `set -e` an un-retried loss of that race aborts
# the whole provisioning run, so retrying is the difference between a cold run that
# works and one that fails halfway.
retry_gcp() {
  local attempt=1 max=8
  until "$@"; do
    if (( attempt >= max )); then
      echo "!! command still failing after ${max} attempts: $*" >&2
      return 1
    fi
    echo "    (attempt ${attempt}/${max} failed — waiting 8s for propagation…)" >&2
    sleep 8
    attempt=$(( attempt + 1 ))
  done
}

echo "==> Project ${PROJECT_ID} | region ${REGION} | bucket ${IMAGE_BUCKET}"

# 1. Project (create only if absent; the id is permanent and globally unique).
if ! gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating project ${PROJECT_ID}"
  gcloud projects create "${PROJECT_ID}" --name="PBE Book ${PROJECT_ID}"
fi
gcloud config set project "${PROJECT_ID}" >/dev/null

# 2. Billing (required before any billable resource).
if [[ -n "${BILLING_ACCOUNT}" ]]; then
  echo "==> Linking billing account ${BILLING_ACCOUNT}"
  gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}" >/dev/null
else
  echo "!! BILLING_ACCOUNT not set — skipping. Billable steps will fail until billing is linked."
fi

# 3. Enable the APIs the environment needs (idempotent).
echo "==> Enabling APIs"
gcloud services enable \
  run.googleapis.com firestore.googleapis.com storage.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  --project "${PROJECT_ID}"

# 4. Firestore — native mode, single region. The location is PERMANENT.
if ! gcloud firestore databases describe --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating Firestore (native, ${REGION})"
  gcloud firestore databases create --location="${REGION}" --type=firestore-native --project "${PROJECT_ID}"
fi

# 4b. TTL policies so lapsed sessions and spent login nonces are reaped
#     server-side (D125). The app also checks expiry on read, so the policy is a
#     sweeper, not the enforcement point. Idempotent: re-enabling is a no-op.
echo "==> Enabling Firestore TTL on sessions.expiresAt and authNonces.expiresAt"
gcloud firestore fields ttls update expiresAt \
  --collection-group=sessions --enable-ttl --project "${PROJECT_ID}" --quiet || true
gcloud firestore fields ttls update expiresAt \
  --collection-group=authNonces --enable-ttl --project "${PROJECT_ID}" --quiet || true

# 5. Private image bucket (uniform access; public access prevented).
if ! gcloud storage buckets describe "gs://${IMAGE_BUCKET}" >/dev/null 2>&1; then
  echo "==> Creating private image bucket gs://${IMAGE_BUCKET}"
  gcloud storage buckets create "gs://${IMAGE_BUCKET}" \
    --location="${REGION}" --uniform-bucket-level-access --public-access-prevention \
    --project "${PROJECT_ID}"
fi

# 5a. Object versioning + a 90-day noncurrent-age lifecycle (D94/N42). The headshot
#     pipeline deletes each superseded version's objects on replace/remove; with
#     versioning on, that delete only *archives* the object as a noncurrent version,
#     so a mistaken replace/remove is recoverable — until the lifecycle rule purges
#     noncurrent versions 90 days later. Both updates are idempotent.
echo "==> Enabling object versioning + 90-day noncurrent lifecycle on gs://${IMAGE_BUCKET}"
gcloud storage buckets update "gs://${IMAGE_BUCKET}" --versioning --project "${PROJECT_ID}"
LIFECYCLE_FILE="$(mktemp)"
cat >"${LIFECYCLE_FILE}" <<'JSON'
{ "rule": [ { "action": { "type": "Delete" }, "condition": { "daysSinceNoncurrentTime": 90 } } ] }
JSON
gcloud storage buckets update "gs://${IMAGE_BUCKET}" \
  --lifecycle-file="${LIFECYCLE_FILE}" --project "${PROJECT_ID}"
rm -f "${LIFECYCLE_FILE}"

# 6. Runtime service account + least-privilege roles (idempotent bindings).
if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating service account ${SA_EMAIL}"
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="Book API (Cloud Run)" --project "${PROJECT_ID}"
fi
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/datastore.user" --condition=None >/dev/null
# The runtime SA now WRITES and DELETES headshot/thumbnail objects (4c-1 pipeline),
# not just reads them, so it needs objectAdmin (get/create/delete/list) on the
# bucket rather than objectViewer.
gcloud storage buckets add-iam-policy-binding "gs://${IMAGE_BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/storage.objectAdmin" >/dev/null

# 6b. The automated-backup bucket (D63/D101; 7b-2). Same private posture as the
#     image bucket — uniform access, public access PREVENTED — because it holds a
#     full copy of every brother's record. Object versioning is deliberately OFF:
#     snapshots are write-once under unique timestamped names, so there is nothing
#     to supersede, and versioning would only defeat the lifecycle rule below.
if ! gcloud storage buckets describe "gs://${BACKUP_BUCKET}" >/dev/null 2>&1; then
  echo "==> Creating private backup bucket gs://${BACKUP_BUCKET}"
  gcloud storage buckets create "gs://${BACKUP_BUCKET}" \
    --location="${REGION}" --uniform-bucket-level-access --public-access-prevention \
    --project "${PROJECT_ID}"
fi

# 6c. Retention: delete snapshots at BACKUP_RETENTION_DAYS (P16/D101 — 3 months).
#     This is the ONLY thing that deletes a backup; Book has no delete path at all
#     (see the BackupStore seam), which is why the runtime SA below never gets
#     objectAdmin. Converges on re-run, so an edited horizon is actually applied.
echo "==> Setting ${BACKUP_RETENTION_DAYS}-day lifecycle on gs://${BACKUP_BUCKET}"
BACKUP_LIFECYCLE_FILE="$(mktemp)"
cat >"${BACKUP_LIFECYCLE_FILE}" <<JSON
{ "rule": [ { "action": { "type": "Delete" }, "condition": { "age": ${BACKUP_RETENTION_DAYS} } } ] }
JSON
gcloud storage buckets update "gs://${BACKUP_BUCKET}" \
  --lifecycle-file="${BACKUP_LIFECYCLE_FILE}" --project "${PROJECT_ID}"
rm -f "${BACKUP_LIFECYCLE_FILE}"

# 6d. The runtime SA's access to the backup bucket: CREATE and READ, never ADMIN.
#     - objectCreator: write the nightly snapshot.
#     - objectViewer:  list/read for the pre-flight staleness check, whose only
#                      input is what is actually in the bucket.
#     Together these still cannot DELETE or OVERWRITE an existing object, so a
#     compromised API cannot destroy backup history — the one property that makes
#     the bucket a recovery asset rather than another thing an attacker owns
#     (D101 "backup-as-crown-jewels"). Read access adds nothing to the blast
#     radius: the API already holds the same PII in memory.
echo "==> Granting ${SA_NAME} objectCreator+objectViewer on gs://${BACKUP_BUCKET}"
gcloud storage buckets add-iam-policy-binding "gs://${BACKUP_BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/storage.objectCreator" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${BACKUP_BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/storage.objectViewer" >/dev/null

# 6e. The Cloud Scheduler identity that triggers the nightly backup. A dedicated
#     service account with NO project roles: it never touches Firestore or GCS
#     itself, it only mints an OIDC token that Book verifies in-code (D58/D78, the
#     Linter-roster pattern). Its authority is exactly "may ask Book to back up".
if ! gcloud iam service-accounts describe "${BACKUP_SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating service account ${BACKUP_SA_EMAIL}"
  gcloud iam service-accounts create "${BACKUP_SA_NAME}" \
    --display-name="Book nightly backup (Cloud Scheduler)" --project "${PROJECT_ID}"
fi

# The `sub` claim Book pins is the service account's NUMERIC UNIQUE ID, not its
# email — configuring the email fails every token with "unexpected subject".
# Derived live here so provisioning is always self-consistent…
# Retried: on a cold run this `describe` immediately follows the account's own
# creation and can lose the propagation race described at the top of this file.
BACKUP_SUBJECT_LIVE=""
read_backup_subject() {
  BACKUP_SUBJECT_LIVE="$(gcloud iam service-accounts describe "${BACKUP_SA_EMAIL}" \
    --project "${PROJECT_ID}" --format='value(uniqueId)' 2>/dev/null)"
  [[ -n "${BACKUP_SUBJECT_LIVE}" ]]
}
retry_gcp read_backup_subject
if [[ -z "${BACKUP_SUBJECT_LIVE}" ]]; then
  echo "ERROR: could not read the uniqueId of ${BACKUP_SA_EMAIL}." >&2
  exit 1
fi
# …but the GitHub deploy workflow builds its Cloud Run environment from
# environments/staging.env alone and cannot run gcloud, so the value has to be
# recorded there too (the same shape as WIF_PROVIDER's baked-in project number).
# Warn LOUDLY on drift rather than silently papering over it: a stale value here
# means the next CI deploy ships a service that rejects every scheduler token,
# and the backup stops with no other symptom.
if [[ "${BACKUP_INVOKER_SUBJECT:-}" != "${BACKUP_SUBJECT_LIVE}" ]]; then
  echo "!! BACKUP_INVOKER_SUBJECT in environments/staging.env is '${BACKUP_INVOKER_SUBJECT:-<unset>}'"
  echo "!! but ${BACKUP_SA_EMAIL} has uniqueId '${BACKUP_SUBJECT_LIVE}'."
  echo "!! This run deploys the correct value, but the next CI deploy will NOT."
  echo "!! Update environments/staging.env: BACKUP_INVOKER_SUBJECT=${BACKUP_SUBJECT_LIVE}"
fi
BACKUP_INVOKER_SUBJECT="${BACKUP_SUBJECT_LIVE}"

# 6f. The private UAT fixtures bucket (Stage 1.2; OFC-248/OFC-249). Holds the
#     prepared UAT photo corpus and the tester roster CSV — the latter carrying real
#     brothers' names and email addresses, which is why neither may ever enter this
#     PUBLIC repo. Same private posture as the other two buckets: uniform access,
#     public access PREVENTED.
#
#     ⚠ SEPARATE from IMAGE_BUCKET deliberately, and it must stay that way. The Book
#     runtime SA holds objectAdmin on the image bucket (needed to write headshots),
#     so a roster of real member PII parked there would sit inside the running
#     application's blast radius. This bucket grants the runtime SA NOTHING — the
#     only reader is CI. Never "simplify" it into a prefix on the image bucket.
#
#     No lifecycle rule and no versioning: the contents are hand-curated fixtures
#     with no natural expiry, replaced by re-upload rather than by accumulation.
if ! gcloud storage buckets describe "gs://${UAT_FIXTURES_BUCKET}" >/dev/null 2>&1; then
  echo "==> Creating private UAT fixtures bucket gs://${UAT_FIXTURES_BUCKET}"
  gcloud storage buckets create "gs://${UAT_FIXTURES_BUCKET}" \
    --location="${REGION}" --uniform-bucket-level-access --public-access-prevention \
    --project "${PROJECT_ID}"
fi

# 6g. Read access for the CI deployer, which runs the seeders (OFC-249's image seed
#     reads the photo corpus; OFC-248's roster tool reads the CSV).
#
#     ⚠ Honest note: this grant is REDUNDANT today. setup-wif.sh gives the deployer
#     project-level roles/storage.admin, which already covers every bucket in the
#     project, so this adds no access it does not have. It is here to state intent at
#     the bucket and to keep the deploy working if that project-wide grant is ever
#     narrowed — a reasonable future hardening. Do not read it as evidence that the
#     deployer's access to this bucket is read-only; it is not.
#
#     The security property that DOES hold is the absence below it: no binding for
#     ${SA_EMAIL}. Book's runtime — the internet-facing part — has no path to the
#     roster at all.
echo "==> Granting ${DEPLOYER_SA:-<deployer>} objectViewer on gs://${UAT_FIXTURES_BUCKET}"
if [ -n "${DEPLOYER_SA:-}" ]; then
  gcloud storage buckets add-iam-policy-binding "gs://${UAT_FIXTURES_BUCKET}" \
    --member="serviceAccount:${DEPLOYER_SA}" --role="roles/storage.objectViewer" >/dev/null
else
  echo "!! DEPLOYER_SA unset (environments/staging.env) — skipping the CI read grant."
fi

# 7. Deploy the API to Cloud Run (built remotely by Cloud Build from ./Dockerfile).
# The Ghost Admin key rides from Secret Manager via --set-secrets, but only if the
# secret exists (it is created out-of-band); otherwise deploy without it (the app
# then runs the succeed-and-log stub, N65 — the Ghost write path is simply inert).
echo "==> Deploying ${SERVICE} to Cloud Run"
SECRET_FLAG=()
if gcloud secrets describe ghost-admin-api-key --project "${PROJECT_ID}" >/dev/null 2>&1; then
  SECRET_FLAG=(--set-secrets "GHOST_ADMIN_API_KEY=ghost-admin-api-key:latest")
else
  echo "    (note: secret ghost-admin-api-key not found — deploying without the Ghost Admin key)"
fi
gcloud run deploy "${SERVICE}" \
  --source . --region "${REGION}" --project "${PROJECT_ID}" \
  --service-account "${SA_EMAIL}" \
  --max-instances 1 --min-instances 0 \
  --memory 1Gi \
  --set-env-vars "IMAGE_BUCKET=${IMAGE_BUCKET},GHOST_JWKS_URL=${GHOST_JWKS_URL},GHOST_JWT_ISSUER=${GHOST_JWT_ISSUER},GHOST_JWT_AUDIENCE=${GHOST_JWT_AUDIENCE},GHOST_BRIDGE_URL=${GHOST_BRIDGE_URL},GHOST_BRIDGE_TARGET=${GHOST_BRIDGE_TARGET},GHOST_ADMIN_API_URL=${GHOST_ADMIN_API_URL},GHOST_NEWSLETTER_ID=${GHOST_NEWSLETTER_ID},BACKUP_BUCKET=${BACKUP_BUCKET},BACKUP_AUDIENCE=${BACKUP_AUDIENCE},BACKUP_INVOKER_SUBJECT=${BACKUP_INVOKER_SUBJECT}" \
  "${SECRET_FLAG[@]}" \
  --allow-unauthenticated --quiet

# 7b. Pin the SERVICE-level max-instances to 1 as well (OFC-209).
#
# `--max-instances` above is REVISION-level only — gcloud documents it as "for
# this Revision", and running `gcloud run services update --max-instances=1`
# leaves the service-level value untouched (verified on gcloud 577.0.0, which is
# why the ticket's proposed one-liner does not work). A freshly created service
# carries a platform-default service-level umbrella of 20, so the console reports
# "Scaling: Auto (Min: 0, Max: 20)" while D83 says one instance.
#
# It is inert in practice — no revision may exceed 1, so the umbrella can never be
# reached — but leaving it at 20 means the console misreports the architecture and
# a future revision-level regression would have 19 instances of headroom to run
# into. The v2 REST `ServiceScaling.maxInstanceCount` field is the only lever that
# sets it; a PATCH with an update mask leaves scalingMode AUTOMATIC (scale-to-zero
# intact — do NOT reach for `--scaling=1`, which is MANUAL mode and pins one
# instance permanently, destroying D83's cost floor).
#
# Verified 7b-1: a full deploy rollover succeeds with the service capped at 1, and
# `gcloud run deploy` does NOT reset it — so this converges once and stays.
echo "==> Pinning service-level max-instances to 1 (OFC-209)"
# `-f` matters: without it curl exits 0 on a 403/404/500 and the pin would fail
# SILENTLY, leaving the umbrella at 20 while this script printed success — the
# very failure mode OFC-209 was filed about. `-S` keeps the error visible under
# `-s`. With `set -e` a rejected PATCH now aborts provisioning.
curl -fsS -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/services/${SERVICE}?updateMask=scaling.maxInstanceCount" \
  -d '{"scaling":{"maxInstanceCount":1}}' >/dev/null

# …and confirm it actually landed, rather than trusting a 200. The PATCH returns
# a long-running operation, so the value can take a moment to be readable; the v1
# annotation is the same number the console header reports.
PINNED=""
for _ in 1 2 3 4 5 6; do
  PINNED=$(gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" \
    --format="value(metadata.annotations['run.googleapis.com/maxScale'])" 2>/dev/null || true)
  [[ "${PINNED}" == "1" ]] && break
  sleep 5
done
if [[ "${PINNED}" != "1" ]]; then
  echo "ERROR: service-level max-instances is '${PINNED:-unknown}', expected 1 (OFC-209/D83)." >&2
  echo "       The revision cap may still be 1, but the service umbrella is not pinned." >&2
  exit 1
fi
echo "    service-level max-instances = 1 (confirmed)"

echo "==> Cloud Run URL:"
SERVICE_URL="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" \
  --format="value(status.url)")"
echo "    ${SERVICE_URL}"

# 7c. The nightly backup schedule (D63/D102; 7b-2). Cloud Scheduler is the external
#     clock Book cannot be: under D83 the service is scaled to zero, so there is no
#     process alive to hold an in-process timer, and an in-process cron would simply
#     never fire.
#
#     TARGET is the run.app URL, NOT the Hosting domain — Cloud Scheduler invokes
#     Cloud Run "on the run.app URL, not on custom domains" (Cloud Scheduler docs,
#     "Create a job"), and going direct also skips a hop that has nothing to add.
#
#     AUTH is an OIDC token for BACKUP_SA_EMAIL with `aud` = BACKUP_AUDIENCE, which
#     Book verifies in-code against its own pinned subject + audience. Note the
#     service is --allow-unauthenticated (Hosting fronts it, D126), so Cloud Run's
#     platform IAM is NOT the gate here — Book's in-code check is the whole gate,
#     exactly as for the Linter roster.
#
#     Converges on re-run (create vs update), per the OFC-72 lesson that a
#     create-only guard silently ignores edited config: an edited schedule, time
#     zone, or audience is APPLIED, not skipped. Tune them HERE, not in the console.
if ! gcloud scheduler jobs describe "${BACKUP_JOB_NAME}" \
      --location="${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating Cloud Scheduler job ${BACKUP_JOB_NAME} (${BACKUP_SCHEDULE} ${BACKUP_TIME_ZONE})"
  SCHEDULER_VERB=create
else
  echo "==> Converging Cloud Scheduler job ${BACKUP_JOB_NAME} (${BACKUP_SCHEDULE} ${BACKUP_TIME_ZONE})"
  SCHEDULER_VERB=update
fi
# --attempt-deadline 600s: the export is seconds at Book's size, but a cold start
# plus a slow Firestore read should not be recorded as a failure.
# Retried for the same propagation reason: this references BACKUP_SA_EMAIL as the
# OIDC token minter, and on a cold run that account is minutes old at most.
retry_gcp gcloud scheduler jobs "${SCHEDULER_VERB}" http "${BACKUP_JOB_NAME}" \
  --location="${REGION}" --project "${PROJECT_ID}" \
  --schedule="${BACKUP_SCHEDULE}" \
  --time-zone="${BACKUP_TIME_ZONE}" \
  --uri="${SERVICE_URL}/api/internal/backup" \
  --http-method=POST \
  --oidc-service-account-email="${BACKUP_SA_EMAIL}" \
  --oidc-token-audience="${BACKUP_AUDIENCE}" \
  --attempt-deadline=600s \
  --description="Book nightly whole-database backup (D63/D102, OFC-327)"

# 8. Firebase Hosting — serves the SPA and rewrites /api,/img to Cloud Run, so
#    the whole app is one origin with no load balancer or CDN (D126).
#
#    ONE-TIME PREREQUISITES (manual — can't be scripted):
#      - Enable Firebase on the project once via https://console.firebase.google.com
#        ("Add Firebase to an existing Google Cloud project" → ${PROJECT_ID}),
#        which also accepts the account-level Firebase Terms of Service.
#      - Firebase CLI auth: run `gcloud auth application-default login` INCLUDING
#        the firebase scope, then export GOOGLE_APPLICATION_CREDENTIALS (see
#        infra/README.md). The default GCS-only ADC scope is not enough.
# firestore:rules ships the deny-all backstop (firestore.rules) alongside Hosting.
# build:libs first — vite resolves @pbe/shared to its built dist/ during build:web.
echo "==> Building SPA and deploying Firebase Hosting + Firestore rules"
npm run build:libs
npm run build:web
npx firebase deploy --only hosting,firestore:rules --project "${PROJECT_ID}"

echo
echo "==> Done. Staging URLs:"
echo "    SPA:  https://${PROJECT_ID}.web.app"
echo "    Backups: gs://${BACKUP_BUCKET}/backups/  (${BACKUP_RETENTION_DAYS}d retention)"
echo "      schedule ${BACKUP_JOB_NAME}: ${BACKUP_SCHEDULE} ${BACKUP_TIME_ZONE}"
echo "      run it now:  gcloud scheduler jobs run ${BACKUP_JOB_NAME} --location=${REGION} --project=${PROJECT_ID}"
echo "      alerting for it is provisioned by infra/provision-observability.sh"
echo "    Seed fake data (staging only):"
echo "      GOOGLE_CLOUD_PROJECT=${PROJECT_ID} npm run seed:staging --workspace tools/fake-data"
echo "    CI deploys (keyless, on merge to main) are set up separately — see infra/setup-wif.sh"
