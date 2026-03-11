# Life Newsletter – GCP Infra

This folder contains scripts and instructions to deploy the Life Newsletter system to Google Cloud Platform.

## Prerequisites

- Google Cloud SDK (`gcloud`) installed and authenticated
- pnpm (for building)
- A GCP project with billing enabled

## One-time setup

### 1. Set project and region

```bash
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1
gcloud config set project $PROJECT_ID
```

### 2. Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  pubsub.googleapis.com
```

### 3. Firestore

Create a Native mode Firestore database (if not exists):

- In Cloud Console: Firestore → Create database → Native mode, choose location.

### 4. Storage bucket

```bash
export BUCKET_NAME=life-newsletter-media-${PROJECT_ID}
gsutil mb -p $PROJECT_ID -l $REGION gs://$BUCKET_NAME
```

### 5. Secrets

Create secrets and add your values (first version):

```bash
# Task auth (shared secret for Cloud Scheduler → Cloud Run)
echo -n "your-random-task-secret" | gcloud secrets create TASK_SECRET --data-file=-

# Anthropic (Claude) API key
echo -n "your-anthropic-api-key" | gcloud secrets create ANTHROPIC_API_KEY --data-file=-

# Grok (xAI) API key
echo -n "your-grok-api-key" | gcloud secrets create GROK_API_KEY --data-file=-

# SendGrid
echo -n "SG.xxx" | gcloud secrets create SENDGRID_API_KEY --data-file=-

# Twilio
echo -n "ACxxx" | gcloud secrets create TWILIO_ACCOUNT_SID --data-file=-
echo -n "your-auth-token" | gcloud secrets create TWILIO_AUTH_TOKEN --data-file=-

# Unsubscribe link signing (optional; can use TASK_SECRET)
echo -n "your-unsubscribe-secret" | gcloud secrets create UNSUBSCRIBE_SECRET --data-file=-
```

### 6. Admin users

In Firestore, create a document:

- Collection: `adminUsers`
- Document ID: the **Firebase Auth UID** of your Google account (get it after first sign-in from the Firebase Auth console or from the admin app after logging in once with a temp rule).
- Fields: `email` (string), `role` (string): `"admin"`

To get your UID: sign in to the admin app once with Firebase Auth (you may need to allow unauthenticated read for the app initially), then check Firebase Auth in the console for the user UID.

### 7. Firebase project (for admin auth)

- Create a Firebase project linked to the same GCP project (or use the same project).
- Enable Authentication → Google sign-in.
- Add a Web app and copy the config (apiKey, authDomain, projectId, etc.) into `apps/admin-web/.env.local` as `NEXT_PUBLIC_FIREBASE_*`.

## Deploy

### API (Cloud Run)

```bash
./deploy-api.sh
```

See `deploy-api.sh` for required env vars (PROJECT_ID, REGION, BUCKET_NAME, etc.).

### Admin web (Cloud Run)

Build and deploy:

```bash
./deploy-admin.sh
```

### Public web (Cloud Run)

```bash
./deploy-public.sh
```

## Scheduler (Saturday draft + Sunday send)

Create Pub/Sub topics and push subscriptions to your Cloud Run tasks:

```bash
# Create topics
gcloud pubsub topics create weekly-draft
gcloud pubsub topics create weekly-send

# Create push subscriptions (replace API_URL with your Cloud Run API URL and TASK_SECRET)
export API_URL=https://your-api-xxxx.run.app
export TASK_SECRET=your-task-secret

gcloud pubsub subscriptions create weekly-draft-sub \
  --topic=weekly-draft \
  --push-endpoint=$API_URL/tasks/generateWeeklyDraft \
  --push-auth-header=Bearer \
  --ack-deadline=600
```

For Cloud Scheduler you need to invoke the task with the secret. Use HTTP targets with a header:

```bash
# Saturday 11 PM - generate draft
gcloud scheduler jobs create http weekly-draft-job \
  --schedule="0 23 * * 6" \
  --uri="$API_URL/tasks/generateWeeklyDraft" \
  --http-method=POST \
  --headers="x-task-secret=$TASK_SECRET" \
  --oidc-service-account-email=default@$PROJECT_ID.iam.gserviceaccount.com

# Sunday 8 AM - send newsletter
gcloud scheduler jobs create http weekly-send-job \
  --schedule="0 8 * * 0" \
  --uri="$API_URL/tasks/sendWeeklyNewsletter" \
  --http-method=POST \
  --headers="x-task-secret=$TASK_SECRET" \
  --oidc-service-account-email=default@$PROJECT_ID.iam.gserviceaccount.com
```

Alternatively use Pub/Sub + Cloud Run subscriptions and trigger the jobs by publishing to the topics on a schedule (e.g. via a small Cloud Function or second scheduler that publishes).

## Environment variables (API on Cloud Run)

Set via Cloud Run or in `deploy-api.sh`:

- `GOOGLE_CLOUD_PROJECT` / `GCP_PROJECT`
- `GCS_BUCKET`
- `TASK_SECRET` (or mount from Secret Manager)
- `ANTHROPIC_API_KEY` (from Secret Manager)
- `ANTHROPIC_MODEL` (optional, default claude-sonnet-4-20250514)
- `GROK_API_KEY` (from Secret Manager)
- `GROK_MODEL` (optional, default grok-2-latest)
- `SENDGRID_API_KEY`, `SENDGRID_FROM`, `SENDGRID_FROM_NAME`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`
- `UNSUBSCRIBE_SECRET` (optional)
- `API_BASE_URL` (your API URL for links in emails)
- `PUBLIC_WEB_URL` (public site URL for unsubscribe links)
