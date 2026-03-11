# Life Newsletter

A complete monorepo for a **Life Newsletter** system: private admin site (capture memos, manage subscribers, review/approve drafts, edit prompts), public site (subscribe, archive, unsubscribe), and a GCP backend (Firestore, Cloud Storage, Cloud Run, Claude/Grok LLM, SendGrid, Twilio).

## Features

- **Private (admin) website**
  - **Capture**: Live speech-to-text, record audio, upload audio/video attachments (stored in GCS, referenced in Firestore). Submit memos with transcript and optional attachment summary.
  - **Memos**: List/detail with filters, embedded audio/video players via signed URLs.
  - **Subscribers**: CRUD, export CSV, status active/unsubscribed.
  - **Newsletter Review**: View and edit the upcoming Sunday draft; approve to allow Sunday send.
  - **Prompt Editor**: Edit system and user prompt templates (versioned in Firestore); Saturday job loads the latest active prompt. Reset to default and preview variables.
- **Public website**
  - Home: brief intro + subscribe form (name, email, phone, SMS consent).
  - Archive: list of sent newsletters; each has a page with rendered HTML and media links.
  - Unsubscribe: form and one-click link (`/unsubscribe?token=...`).
- **Backend (Cloud Run API)**
  - Admin endpoints (auth + admin role): memos (multipart upload), subscribers, drafts, prompts.
  - Public endpoints: newsletters list/detail, subscribe, unsubscribe.
  - Secured tasks: `POST /tasks/generateWeeklyDraft` (Saturday), `POST /tasks/sendWeeklyNewsletter` (Sunday). Secured with `x-task-secret` header.
- **Weekly automation**
  - **Saturday night**: Generate draft from last 7 days of memos + last 5 newsletters; use **Claude or Grok** (selectable in admin) and the latest saved prompt from Prompt Editor; store draft as `pending_approval`.
  - **Sunday morning**: If an approved draft exists and is not sent, send email (SendGrid) and SMS (Twilio), create newsletter record for archive, mark draft sent.

## Repository structure

```
apps/
  admin-web/     # Next.js 14, Tailwind, Firebase Auth
  public-web/     # Next.js 14, Tailwind
services/
  api/            # Express TypeScript, Firestore, GCS, Claude/Grok, SendGrid, Twilio
infra/            # gcloud deploy scripts + README
```

## Tech stack

- **Apps**: Next.js 14, TypeScript, Tailwind CSS.
- **API**: Node/TypeScript, Express, Firestore, Cloud Storage, Firebase Admin (auth), Claude (Anthropic) + Grok (xAI) for newsletter generation, SendGrid, Twilio.
- **Infra**: Cloud Run, Secret Manager, Cloud Scheduler (or Pub/Sub) for Saturday/Sunday jobs.

## Local development

### Prerequisites

- Node 18+
- pnpm (`npm install -g pnpm`)
- A GCP project with Firestore (Native), a Storage bucket, and Firebase Auth (for admin)

### 1. Install and env

```bash
pnpm install
```

- **API**: Copy `services/api/.env.example` to `services/api/.env` and set at least:
  - `GOOGLE_CLOUD_PROJECT` / `GCP_PROJECT`
  - `GCS_BUCKET`
  - `TASK_SECRET`
  - `ANTHROPIC_API_KEY`
  - `GROK_API_KEY`
- **Admin web**: Copy `apps/admin-web/.env.example` to `apps/admin-web/.env.local` and set Firebase config (`NEXT_PUBLIC_FIREBASE_*`) and `NEXT_PUBLIC_API_URL=http://localhost:8080`.
- **Public web**: Copy `apps/public-web/.env.example` to `apps/public-web/.env.local` and set `NEXT_PUBLIC_API_URL=http://localhost:8080`.

### 2. Run everything

From repo root:

```bash
pnpm dev
```

This runs in parallel:

- API: `http://localhost:8080`
- Admin: `http://localhost:3001`
- Public: `http://localhost:3000`

Or run individually:

```bash
pnpm dev:api
pnpm dev:admin
pnpm dev:public
```

### 3. Admin access

- Add your Firebase Auth UID to Firestore collection `adminUsers` with field `role: "admin"` (and `email`).
- Sign in at the admin app with Google.

## Deploy (GCP)

1. **One-time setup**: Enable APIs, create Firestore (Native), Storage bucket, secrets (TASK_SECRET, ANTHROPIC_API_KEY, GROK_API_KEY, SENDGRID_API_KEY, TWILIO_*, UNSUBSCRIBE_SECRET), and add an admin user in `adminUsers`. See `infra/README.md`.
2. **API**:
   ```bash
   cd infra && ./deploy-api.sh
   ```
   Set `PROJECT_ID`, `REGION`, `GCS_BUCKET` as needed. Script uses Secret Manager for sensitive env.
3. **Admin web** and **Public web**:
   ```bash
   ./deploy-admin.sh   # set API_URL to your Cloud Run API URL
   ./deploy-public.sh
   ```
4. **Scheduler**: Create two HTTP Cloud Scheduler jobs (or Pub/Sub + push to Cloud Run):
   - Saturday 11 PM: `POST $API_URL/tasks/generateWeeklyDraft` with header `x-task-secret: $TASK_SECRET`.
   - Sunday 8 AM: `POST $API_URL/tasks/sendWeeklyNewsletter` with header `x-task-secret: $TASK_SECRET`.

Details and exact gcloud commands: **`infra/README.md`**.

## Tests

```bash
pnpm test
```

Runs tests in workspace packages. API includes:

- `weekKey`: getWeekKey, getSevenDaysAgo
- `promptTemplate`: renderUserPrompt, placeholders
- `draftGating`: approval gating (approved + not sent → send)

## Data model (Firestore)

- **memos**: transcript, title, weekKey, createdByUid, attachments (id, type, gcsPath, contentType, sizeBytes, createdAt), attachmentSummary
- **drafts**: weekKey, status (pending_approval | approved | sent), subject, bodyMarkdown, bodyHtml, memoIds, contextNewsletterIds, usedPromptVersionId, generatedAt, approvedAt, sentAt
- **newsletters**: weekKey, sentAt, subject, bodyMarkdown, bodyHtml, publicSlug, sourceDraftId
- **subscribers**: name, email, phone, smsConsent, status, createdAt, unsubscribedAt, unsubscribeTokenHash
- **promptVersions**: systemPrompt, userPromptTemplate, notes, isActive, createdAt, createdByUid
- **adminUsers**: email, role (admin)

## API endpoints (summary)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /admin/memos | Bearer + admin | Create memo (multipart: transcript, recordedAudio, attachments[]) |
| GET | /admin/memos | Bearer + admin | List memos (query, start, end) |
| GET | /admin/memos/:id | Bearer + admin | Get memo |
| GET | /admin/memos/:id/attachments/:attachmentId/signedUrl | Bearer + admin | Signed URL for playback/download |
| GET | /admin/subscribers | Bearer + admin | List subscribers |
| GET | /admin/subscribers/export.csv | Bearer + admin | Export CSV |
| POST | /admin/subscribers | Bearer + admin | Create subscriber |
| PATCH | /admin/subscribers/:id | Bearer + admin | Update (e.g. status) |
| DELETE | /admin/subscribers/:id | Bearer + admin | Delete |
| GET | /admin/drafts/current | Bearer + admin | Current draft |
| PATCH | /admin/drafts/:id | Bearer + admin | Edit subject/body |
| POST | /admin/drafts/:id/approve | Bearer + admin | Approve draft |
| GET | /admin/prompts/active | Bearer + admin | Active prompt |
| GET | /admin/prompts | Bearer + admin | List versions |
| POST | /admin/prompts | Bearer + admin | Create and set active |
| POST | /admin/prompts/:id/activate | Bearer + admin | Set active |
| POST | /admin/prompts/reset-default | Bearer + admin | Reset to default |
| GET | /admin/prompts/placeholders | Bearer + admin | Placeholder list |
| GET | /public/newsletters | - | List newsletters |
| GET | /public/newsletters/:slug | - | Get newsletter by slug |
| POST | /public/subscribe | - | Subscribe |
| GET/POST | /public/unsubscribe | - | Unsubscribe (token in query or body) |
| POST | /tasks/generateWeeklyDraft | x-task-secret | Saturday job |
| POST | /tasks/sendWeeklyNewsletter | x-task-secret | Sunday job |

## License

Private / unlicensed as desired.
