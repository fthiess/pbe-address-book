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

PROJECT_ID="${PROJECT_ID:-pbe-book-staging}"
REGION="${REGION:-us-central1}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"
IMAGE_BUCKET="${IMAGE_BUCKET:-${PROJECT_ID}-images}"
SERVICE="${SERVICE:-pbe-book-api}"
SA_NAME="${SA_NAME:-book-api}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

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

# 5. Private image bucket (uniform access; public access prevented).
if ! gcloud storage buckets describe "gs://${IMAGE_BUCKET}" >/dev/null 2>&1; then
  echo "==> Creating private image bucket gs://${IMAGE_BUCKET}"
  gcloud storage buckets create "gs://${IMAGE_BUCKET}" \
    --location="${REGION}" --uniform-bucket-level-access --public-access-prevention \
    --project "${PROJECT_ID}"
fi

# 6. Runtime service account + least-privilege roles (idempotent bindings).
if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating service account ${SA_EMAIL}"
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="Book API (Cloud Run)" --project "${PROJECT_ID}"
fi
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/datastore.user" --condition=None >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${IMAGE_BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/storage.objectViewer" >/dev/null

# 7. Deploy the API to Cloud Run (built remotely by Cloud Build from ./Dockerfile).
echo "==> Deploying ${SERVICE} to Cloud Run"
gcloud run deploy "${SERVICE}" \
  --source . --region "${REGION}" --project "${PROJECT_ID}" \
  --service-account "${SA_EMAIL}" \
  --max-instances 1 --min-instances 0 \
  --set-env-vars "IMAGE_BUCKET=${IMAGE_BUCKET}" \
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
echo "==> Building SPA and deploying Firebase Hosting"
npm run build:web
npx firebase deploy --only hosting --project "${PROJECT_ID}"

echo
echo "==> Done. Staging URLs:"
echo "    SPA:  https://${PROJECT_ID}.web.app"
echo "    Seed fake data (staging only):"
echo "      GOOGLE_CLOUD_PROJECT=${PROJECT_ID} npm run seed:staging --workspace tools/fake-data"
echo "    CI deploys (keyless, on merge to main) are set up separately — see infra/setup-wif.sh"
