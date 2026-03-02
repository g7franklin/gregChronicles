#!/usr/bin/env bash
set -e
# Build and deploy public-web to Cloud Run
PROJECT_ID=${PROJECT_ID:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}
SERVICE_NAME=${SERVICE_NAME:-life-newsletter-public}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_URL=${API_URL:-$(gcloud run services describe life-newsletter-api --region "$REGION" --format 'value(status.url)' --project "$PROJECT_ID" 2>/dev/null || echo "https://your-api.run.app")}

cd "$ROOT/apps/public-web"
pnpm install
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:$(date +%s)"
gcloud builds submit --config=cloudbuild.yaml --project "$PROJECT_ID" \
  --substitutions="_IMAGE=$IMAGE,_NEXT_PUBLIC_API_URL=$API_URL" .
gcloud run deploy "$SERVICE_NAME" --image "$IMAGE" --region "$REGION" --platform managed --allow-unauthenticated --project "$PROJECT_ID"
