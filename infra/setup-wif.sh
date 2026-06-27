#!/usr/bin/env bash
#
# Set up keyless CI deploys: Workload Identity Federation so GitHub Actions can
# deploy the Book API (Cloud Run) and Firebase Hosting WITHOUT a service-account
# key in the repo. A key would be a long-lived secret in a PUBLIC repo's secret
# store; WIF instead lets GitHub mint a short-lived OIDC token that Google trusts
# ONLY for this one repository.
#
# Companion to provision-staging.sh: that script builds the environment; this one
# wires up who is allowed to deploy into it from CI. Run it once per environment
# (re-running converges — it is idempotent where that is cheap).
#
# What it creates:
#   - A Workload Identity Pool + OIDC provider that trusts GitHub's token issuer,
#     locked by an attribute condition to the single repo fthiess/pbe-address-book.
#     This lock is THE security control: without it any GitHub repo on earth could
#     impersonate the deployer SA. The repo is public, so this matters doubly.
#   - A dedicated deployer service account (github-deployer) with least-privilege
#     roles to deploy Cloud Run + Firebase Hosting and run the source build.
#   - A workloadIdentityUser binding letting the repo's GitHub identities (and only
#     them) impersonate that SA.
#
# Prerequisites:
#   - gcloud authenticated as an owner of the project (`gcloud auth login`).
#   - The environment already provisioned (infra/provision-staging.sh) — this
#     grants actAs on the runtime SA (book-api), which must already exist.
#
# Usage:
#   PROJECT_ID=pbe-book-staging GITHUB_REPO=fthiess/pbe-address-book \
#   bash infra/setup-wif.sh
#
# After it prints the provider resource name + deployer SA, those two values go
# into .github/workflows/deploy-staging.yml (workload_identity_provider /
# service_account). They are NOT secrets — there is nothing to rotate.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-pbe-book-staging}"
GITHUB_REPO="${GITHUB_REPO:-fthiess/pbe-address-book}"

POOL_ID="${POOL_ID:-github-pool}"
PROVIDER_ID="${PROVIDER_ID:-github-provider}"
DEPLOYER_NAME="${DEPLOYER_NAME:-github-deployer}"
DEPLOYER_SA="${DEPLOYER_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${RUNTIME_SA:-book-api@${PROJECT_ID}.iam.gserviceaccount.com}"

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
# On projects this new, `gcloud run deploy --source` runs its Cloud Build build as
# the Compute Engine default SA (not the legacy @cloudbuild one), so the deployer
# must be allowed to act as it to submit that build.
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "==> Project ${PROJECT_ID} (#${PROJECT_NUMBER}) | repo ${GITHUB_REPO}"

# 0. APIs needed for the OIDC token exchange (idempotent).
echo "==> Enabling STS + IAM Credentials APIs"
gcloud services enable sts.googleapis.com iamcredentials.googleapis.com \
  --project "${PROJECT_ID}"

# 1. Workload Identity Pool (the trust boundary container).
if ! gcloud iam workload-identity-pools describe "${POOL_ID}" \
      --location=global --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating workload identity pool ${POOL_ID}"
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --location=global --project "${PROJECT_ID}" \
    --display-name="GitHub Actions"
fi

# 2. OIDC provider trusting GitHub, LOCKED to this one repository.
#    The attribute-condition is the security control — drop it and any repo could
#    assume the deployer SA. attribute.ref is mapped so a future workflow/binding
#    could tighten to a branch; today the repo scope + push-to-main flow suffice.
if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
      --location=global --workload-identity-pool="${POOL_ID}" \
      --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating OIDC provider ${PROVIDER_ID} (repo-locked)"
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --location=global --workload-identity-pool="${POOL_ID}" \
    --project "${PROJECT_ID}" \
    --display-name="GitHub" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'"
fi

# 3. Dedicated deployer service account.
if ! gcloud iam service-accounts describe "${DEPLOYER_SA}" \
      --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating deployer service account ${DEPLOYER_SA}"
  gcloud iam service-accounts create "${DEPLOYER_NAME}" \
    --display-name="GitHub Actions deployer" --project "${PROJECT_ID}"
fi

# 4. Project-level roles (least privilege for a deploy-only identity).
#    - run.admin              create/update the Cloud Run service + revisions
#    - cloudbuild.builds.editor   submit the `--source` Cloud Build build
#    - artifactregistry.writer    push the built image to cloud-run-source-deploy
#    - storage.admin              read/write the build source-staging bucket
#                                 (tighten to objectAdmin on run-sources-* for prod)
#    - firebasehosting.admin      deploy the SPA to Firebase Hosting
#    - firebaserules.admin        publish Firestore security rules (the deny-all
#                                 backstop) — firebasehosting.admin does NOT cover this
#    - serviceusage.serviceUsageConsumer   lets the Firebase CLI's firestore deploy
#                                 preflight READ whether firestore.googleapis.com is
#                                 enabled (services.get); does NOT allow enabling APIs
#    - datastore.user            the deploy's seed-staging step writes the fake
#                                 dataset + tester link to Firestore (storage.admin
#                                 already covers the image bucket). STAGING ONLY —
#                                 a prod deploy must never re-seed, so omit this for
#                                 prod or guard the seed step off (STAGING_AUTOSEED).
echo "==> Granting project roles to ${DEPLOYER_SA}"
for role in \
  roles/run.admin \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.writer \
  roles/storage.admin \
  roles/firebasehosting.admin \
  roles/firebaserules.admin \
  roles/serviceusage.serviceUsageConsumer \
  roles/datastore.user; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOYER_SA}" --role="${role}" \
    --condition=None >/dev/null
done

# 5. actAs, scoped to specific service accounts (NOT project-wide):
#    - on the runtime SA, so the deployed service may run AS book-api.
#    - on the build SA, so the deployer may submit the source build that runs as it.
echo "==> Granting scoped iam.serviceAccountUser (runtime + build SAs)"
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role="roles/iam.serviceAccountUser" --project "${PROJECT_ID}" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "${BUILD_SA}" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role="roles/iam.serviceAccountUser" --project "${PROJECT_ID}" >/dev/null

# 6. Let the GitHub repo's identities (and only them) impersonate the deployer SA.
echo "==> Binding workloadIdentityUser for repo ${GITHUB_REPO}"
gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA}" \
  --project "${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
  >/dev/null

echo
echo "==> Done. Paste these into .github/workflows/deploy-staging.yml:"
echo "    workload_identity_provider:"
echo "      projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
echo "    service_account:"
echo "      ${DEPLOYER_SA}"
echo
echo "    (Neither value is a secret — there is no key to store or rotate.)"
