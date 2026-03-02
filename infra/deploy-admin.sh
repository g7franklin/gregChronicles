#!/usr/bin/env bash
set -e
# Build and deploy admin-web to Cloud Run
PROJECT_ID=${PROJECT_ID:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}
SERVICE_NAME=${SERVICE_NAME:-life-newsletter-admin}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_URL=${API_URL:-$(gcloud run services describe life-newsletter-api --region "$REGION" --format 'value(status.url)' --project "$PROJECT_ID" 2>/dev/null || echo "https://your-api.run.app")}

FIREBASE_API_KEY=${FIREBASE_API_KEY:-AIzaSyD0p19OgQdhlSqsA5lvRupHgxrAbvLvsw0}
FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN:-gregchronicles.firebaseapp.com}
FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-gregchronicles}
FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET:-gregchronicles.firebasestorage.app}
FIREBASE_MESSAGING_SENDER_ID=${FIREBASE_MESSAGING_SENDER_ID:-762792577853}
FIREBASE_APP_ID=${FIREBASE_APP_ID:-1:762792577853:web:f9545e8d6a02bf2ade5354}

cd "$ROOT/apps/admin-web"
pnpm install
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:$(date +%s)"
gcloud builds submit --config=cloudbuild.yaml --project "$PROJECT_ID" \
  --substitutions="_IMAGE=$IMAGE,_NEXT_PUBLIC_API_URL=$API_URL,_NEXT_PUBLIC_FIREBASE_API_KEY=$FIREBASE_API_KEY,_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$FIREBASE_AUTH_DOMAIN,_NEXT_PUBLIC_FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID,_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$FIREBASE_STORAGE_BUCKET,_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$FIREBASE_MESSAGING_SENDER_ID,_NEXT_PUBLIC_FIREBASE_APP_ID=$FIREBASE_APP_ID" .
gcloud run deploy "$SERVICE_NAME" --image "$IMAGE" --region "$REGION" --platform managed --allow-unauthenticated --project "$PROJECT_ID"
