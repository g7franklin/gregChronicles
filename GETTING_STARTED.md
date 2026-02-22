# Life Newsletter — Step-by-step setup

Follow these steps in order to get the system running locally (and optionally deployed).

---

## Part 1: Prerequisites

### 1.1 Install Node and pnpm

- **Node.js 18+**: [nodejs.org](https://nodejs.org) or `nvm install 18`
- **pnpm**:  
  `npm install -g pnpm`  
  Or use it via npx: `npx pnpm` (no global install).

### 1.2 Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com).
2. Create a project (or pick one) and note the **Project ID** (e.g. `my-life-newsletter`).
3. Ensure **billing** is enabled for that project.

### 1.3 Firebase (same project as GCP)

Firebase will provide **Authentication** for the admin app. Use the **same** GCP project:

1. Go to [Firebase Console](https://console.firebase.google.com).
2. **Add project** → choose **“Use an existing Google Cloud project”** and select your GCP project.
3. In the project:
   - Go to **Build → Authentication**.
   - Click **Get started**.
   - Enable **Google** as a sign-in provider (no extra config needed).
4. Go to **Project settings** (gear icon).
   - Under **Your apps**, click **Add app** → **Web** (</>).
   - Register an app (e.g. “Life Newsletter Admin”).
   - You’ll get a config object like:
     ```js
     const firebaseConfig = {
       apiKey: "...",
       authDomain: "your-project.firebaseapp.com",
       projectId: "your-project-id",
       storageBucket: "your-project.appspot.com",
       messagingSenderId: "...",
       appId: "..."
     };
     ```
   - **Copy these values**; you’ll paste them into the admin app env in Part 3.

---

## Part 2: GCP one-time setup (Firestore, Storage, APIs)

Do this once per GCP project. Replace `YOUR_PROJECT_ID` and `YOUR_REGION` with your values (e.g. `us-central1`).

### 2.1 Install and log in to gcloud (if needed)

```bash
# Install: https://cloud.google.com/sdk/docs/install
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### 2.2 Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com
```

### 2.3 Create Firestore database

1. In [Cloud Console](https://console.cloud.google.com) → **Firestore**.
2. **Create database** (if you don’t have one).
3. Choose **Native mode** and a **location** (e.g. same as your region).
4. Create. Leave security rules as-is for now (you’ll restrict access via the API and admin check).

### 2.4 Create Storage bucket (for memo audio/video)

```bash
export PROJECT_ID=YOUR_PROJECT_ID
export REGION=us-central1
export BUCKET_NAME=life-newsletter-media-${PROJECT_ID}

gsutil mb -p $PROJECT_ID -l $REGION gs://$BUCKET_NAME
```

Use this **exact** bucket name later in the API `.env` as `GCS_BUCKET`.

### 2.5 Create secrets (for production; optional for local)

For **local dev** you can put keys in `.env`. For **deployed** API you’ll use Secret Manager. You can create secrets now so they’re ready:

```bash
# Required for /tasks/* (Saturday/Sunday jobs)
echo -n "pick-a-long-random-string-here" | gcloud secrets create TASK_SECRET --data-file=-

# Required for newsletter draft generation
echo -n "YOUR_GROK_API_KEY" | gcloud secrets create GROK_API_KEY --data-file=-
```

Get a Grok API key from [x.ai](https://x.ai) (API / console).

Optional (for sending email/SMS later):

```bash
# echo -n "SG.xxx" | gcloud secrets create SENDGRID_API_KEY --data-file=-
# echo -n "ACxxx" | gcloud secrets create TWILIO_ACCOUNT_SID --data-file=-
# echo -n "xxx" | gcloud secrets create TWILIO_AUTH_TOKEN --data-file=-
# echo -n "secret" | gcloud secrets create UNSUBSCRIBE_SECRET --data-file=-
```

---

## Part 3: Local environment files

From the **repo root** (`demo/`).

### 3.1 API (`services/api`)

```bash
cd services/api
cp .env.example .env
```

Edit `services/api/.env` and set at least:

| Variable | What to set |
|----------|-------------|
| `GOOGLE_CLOUD_PROJECT` or `GCP_PROJECT` | Your GCP Project ID |
| `GCS_BUCKET` | Your bucket name, e.g. `life-newsletter-media-YOUR_PROJECT_ID` |
| `TASK_SECRET` | Any long random string (e.g. `openssl rand -hex 32`) |
| `GROK_API_KEY` | Your xAI Grok API key |

Leave `API_BASE_URL=http://localhost:8080` and `PUBLIC_WEB_URL=http://localhost:3000` for local. SendGrid/Twilio can be empty for local.

### 3.2 Admin web (`apps/admin-web`)

```bash
cd apps/admin-web
cp .env.example .env.local
```

Edit `apps/admin-web/.env.local` and set:

| Variable | What to set |
|----------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | From Firebase web app config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Same as GCP project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `your-project.appspot.com` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | From Firebase config |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | From Firebase config |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` |

### 3.3 Public web (`apps/public-web`)

```bash
cd apps/public-web
cp .env.example .env.local
```

Edit `apps/public-web/.env.local` and set:

| Variable | What to set |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` |

(If the file is empty or only has comments, add that one line.)

---

## Part 4: Install dependencies and run locally

From the **repo root**:

```bash
cd /path/to/demo
pnpm install
```

Then start all three apps (API, admin, public):

```bash
pnpm dev
```

This runs:

- **API**: http://localhost:8080  
- **Admin**: http://localhost:3001  
- **Public**: http://localhost:3000  

If you prefer to run them in separate terminals:

```bash
pnpm dev:api      # terminal 1
pnpm dev:admin    # terminal 2
pnpm dev:public   # terminal 3
```

---

## Part 5: Make yourself an admin

The admin app requires you to be in Firestore as an admin. You need your **Firebase Auth UID** first.

### 5.1 Get your UID

1. Open **http://localhost:3001** and click **Sign in with Google**.
2. Sign in. You may see an error like “Admin access required” or a blank page — that’s expected.
3. Open [Firebase Console](https://console.firebase.google.com) → your project → **Authentication** → **Users**.
4. Find your Google user and copy the **User UID** (long string like `xYz123...`).

### 5.2 Add admin user in Firestore

1. In [Cloud Console](https://console.cloud.google.com) go to **Firestore**.
2. **Start collection** (or use existing):
   - Collection ID: `adminUsers`
3. **Add document**:
   - **Document ID**: paste your **User UID** (the one from Firebase Auth).
   - Add two fields:
     - `email` (string): your email (e.g. `you@gmail.com`).
     - `role` (string): `admin`
4. Save.

### 5.3 Sign in again

Go back to **http://localhost:3001**, sign out if needed, then **Sign in with Google** again. You should land on **Capture** and see the nav (Capture, Memos, Subscribers, Newsletter Review, Prompt Editor).

---

## Part 6: Verify it’s working

1. **Capture**  
   - Type or use “Start Recording” (and “Stop”) to get a transcript.  
   - Optionally add a title, attach a file, then **Submit**.  
   - You should see “Memo saved.”

2. **Memos**  
   - Open **Memos**. Your new memo should appear.  
   - Open it to see transcript and any attachment (signed URL loads in player).

3. **Subscribers**  
   - Add a test subscriber (name, email).  
   - Use **Export CSV** to download.

4. **Prompt Editor**  
   - Open **Prompt Editor**. You should see the default system and user prompt.  
   - Click **Preview variables** to see sample injection.  
   - You can edit and **Save & set active** (no need to change anything to test).

5. **Public site**  
   - Open **http://localhost:3000**.  
   - Submit the subscribe form with a test email.  
   - Open **Archive** (will be empty until a newsletter is sent).

6. **Weekly draft (manual test)**  
   - With at least one memo and the API running, call the Saturday task (use the same secret as in `.env`):
     ```bash
     curl -X POST http://localhost:8080/tasks/generateWeeklyDraft \
       -H "x-task-secret: YOUR_TASK_SECRET_FROM_ENV"
     ```
   - Then in the admin app open **Newsletter Review**. You should see a draft (subject + body).  
   - Edit if you like and click **Approve (send Sunday)**.  
   - Sending won’t actually run until you trigger the Sunday task (or call it manually with the same header).

---

## Part 7: Optional — Deploy to GCP

Only after local is working.

### 7.1 Deploy API to Cloud Run

```bash
cd infra
export PROJECT_ID=YOUR_PROJECT_ID
export REGION=us-central1
export GCS_BUCKET=life-newsletter-media-YOUR_PROJECT_ID
./deploy-api.sh
```

Note the **API URL** printed at the end (e.g. `https://life-newsletter-api-xxxx.run.app`).

### 7.2 Deploy admin and public web

Set the API URL from the previous step, then:

```bash
export API_URL=https://life-newsletter-api-xxxx.run.app   # your actual URL
./deploy-admin.sh
./deploy-public.sh
```

### 7.3 Cloud Scheduler (Saturday draft + Sunday send)

Use the same `API_URL` and the **same** `TASK_SECRET** you put in Secret Manager (or in the API’s env on Cloud Run):

```bash
export API_URL=https://your-api-url.run.app
export TASK_SECRET=your-task-secret

# Saturday 11 PM — generate draft
gcloud scheduler jobs create http weekly-draft-job \
  --schedule="0 23 * * 6" \
  --uri="$API_URL/tasks/generateWeeklyDraft" \
  --http-method=POST \
  --headers="x-task-secret=$TASK_SECRET" \
  --location=$REGION

# Sunday 8 AM — send newsletter
gcloud scheduler jobs create http weekly-send-job \
  --schedule="0 8 * * 0" \
  --uri="$API_URL/tasks/sendWeeklyNewsletter" \
  --http-method=POST \
  --headers="x-task-secret=$TASK_SECRET" \
  --location=$REGION
```

(If a job already exists, use `update` or delete and recreate.)

---

## Troubleshooting

| Problem | What to check |
|--------|----------------|
| “Missing or invalid Authorization” on admin | You’re not signed in or Firebase config in `.env.local` is wrong. |
| “Admin access required” | Your Firebase UID is not in `adminUsers` with `role: "admin"`. |
| API “GOOGLE_CLOUD_PROJECT … must be set” | Set `GOOGLE_CLOUD_PROJECT` or `GCP_PROJECT` in `services/api/.env`. |
| Memo submit fails (e.g. 500) | GCS bucket name in `.env` must match the bucket you created; service account (or your gcloud user) needs Storage write. |
| Draft generation fails | `GROK_API_KEY` must be set and valid; check API logs. |
| 403 on `/tasks/*` | Request must include header `x-task-secret` with the same value as `TASK_SECRET` in the API `.env`. |

For GCP permissions when running locally, use **Application Default Credentials**:

```bash
gcloud auth application-default login
```

That uses your user account for Firestore, Storage, and (if you use it) Secret Manager when the API runs on your machine.

---

You’re done. For a quick recap: **Part 1–2** = prerequisites and GCP/Firebase one-time setup. **Part 3–4** = env files and `pnpm dev`. **Part 5** = add yourself as admin in Firestore. **Part 6** = smoke test. **Part 7** = optional deploy and schedulers.
