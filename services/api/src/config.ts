export function getProjectId(): string {
  return process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT ?? '';
}

/** If set, use this Firestore database ID (e.g. gregchronicles). Otherwise the client uses "(default)". */
export function getFirestoreDatabaseId(): string | undefined {
  const id = process.env.FIRESTORE_DATABASE_ID;
  return id && id.trim() ? id.trim() : undefined;
}

export function getTaskSecret(): string {
  const s = process.env.TASK_SECRET;
  if (!s) throw new Error('TASK_SECRET is not set');
  return s;
}

export function getBucketName(): string {
  return process.env.GCS_BUCKET ?? 'life-newsletter-media';
}

export function getApiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:8080';
}
