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
SERVICE="${SERVICE:-pbe-book-api}"
SA_NAME="${SA_NAME:-book-api}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

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
  --set-env-vars "IMAGE_BUCKET=${IMAGE_BUCKET},GHOST_JWKS_URL=${GHOST_JWKS_URL},GHOST_JWT_ISSUER=${GHOST_JWT_ISSUER},GHOST_JWT_AUDIENCE=${GHOST_JWT_AUDIENCE},GHOST_BRIDGE_URL=${GHOST_BRIDGE_URL},GHOST_BRIDGE_TARGET=${GHOST_BRIDGE_TARGET},GHOST_ADMIN_API_URL=${GHOST_ADMIN_API_URL},GHOST_NEWSLETTER_ID=${GHOST_NEWSLETTER_ID}" \
  "${SECRET_FLAG[@]}" \
  --allow-unauthenticated --quiet

echo "==> Cloud Run URL:"
gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" \
  --format="value(status.url)"

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
echo "    Seed fake data (staging only):"
echo "      GOOGLE_CLOUD_PROJECT=${PROJECT_ID} npm run seed:staging --workspace tools/fake-data"
echo "    CI deploys (keyless, on merge to main) are set up separately — see infra/setup-wif.sh"
