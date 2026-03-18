#!/usr/bin/env bash
set -e
# Deploy API to Cloud Run
# Required: PROJECT_ID, REGION, BUCKET_NAME. Optional: SERVICE_NAME, TASK_SECRET in env or Secret Manager.

PROJECT_ID=${PROJECT_ID:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}
BUCKET_NAME=${GCS_BUCKET:-life-newsletter-media-${PROJECT_ID}}
SERVICE_NAME=${SERVICE_NAME:-life-newsletter-api}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/services/api"
pnpm install
pnpm build

IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:$(date +%s)"
gcloud builds submit --tag "$IMAGE" --project "$PROJECT_ID" .

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format 'value(status.url)' --project "$PROJECT_ID" 2>/dev/null || echo "")
API_BASE=${API_BASE_URL:-$SERVICE_URL}
PUBLIC_WEB=${PUBLIC_WEB_URL:-$API_BASE}

gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GCS_BUCKET=${BUCKET_NAME},FIRESTORE_DATABASE_ID=gregchronicles,ANTHROPIC_MODEL=claude-sonnet-4-20250514,GROK_MODEL=grok-3,API_BASE_URL=${API_BASE},PUBLIC_WEB_URL=${PUBLIC_WEB},SENDGRID_FROM=newsletter@gregchronicles.com,SENDGRID_FROM_NAME=The Greg Chronicle,TWILIO_FROM=+18882441852" \
  --set-secrets "TASK_SECRET=TASK_SECRET:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,GROK_API_KEY=GROK_API_KEY:latest,SENDGRID_API_KEY=SENDGRID_API_KEY:latest,TWILIO_ACCOUNT_SID=TWILIO_ACCOUNT_SID:latest,TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest,UNSUBSCRIBE_SECRET=UNSUBSCRIBE_SECRET:latest" \
  --project "$PROJECT_ID"

echo "Deployed. URL: $(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)' --project $PROJECT_ID)"
