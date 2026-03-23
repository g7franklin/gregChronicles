import { Storage } from '@google-cloud/storage';
import { getProjectId, getBucketName } from '../config.js';

let storage: Storage | null = null;

// Cache the resolved service account email so we only hit the metadata server once.
let cachedServiceAccountEmail: string | null | undefined; // undefined = not yet fetched, null = unavailable

/**
 * Returns the service account email for signing, or undefined if unavailable.
 * On Cloud Run: fetched from the GCE metadata server.
 * Locally: read from GCS_SERVICE_ACCOUNT_EMAIL env var.
 * If GOOGLE_APPLICATION_CREDENTIALS points to a key file, this isn't needed (signing is local).
 */
async function resolveServiceAccountEmail(): Promise<string | undefined> {
  if (cachedServiceAccountEmail !== undefined) return cachedServiceAccountEmail ?? undefined;
  if (process.env.GCS_SERVICE_ACCOUNT_EMAIL) {
    cachedServiceAccountEmail = process.env.GCS_SERVICE_ACCOUNT_EMAIL;
    return cachedServiceAccountEmail;
  }
  // Try ADC credentials first (works on Cloud Run/Cloud Build when client_email is available).
  try {
    const credentials = await getStorage().authClient.getCredentials();
    if (credentials.client_email) {
      cachedServiceAccountEmail = credentials.client_email || undefined;
      return cachedServiceAccountEmail;
    }
  } catch {
    // fall through to metadata server probe
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: ctrl.signal },
    );
    clearTimeout(t);
    if (res.ok) {
      cachedServiceAccountEmail = (await res.text()).trim();
      return cachedServiceAccountEmail;
    }
  } catch {
    // Not on GCE/Cloud Run
  }
  cachedServiceAccountEmail = null;
  return undefined;
}

export function getStorage(): Storage {
  if (!storage) {
    storage = new Storage({ projectId: getProjectId() });
  }
  return storage;
}

export function getBucket() {
  return getStorage().bucket(getBucketName());
}

export async function uploadBuffer(
  path: string,
  buffer: Buffer,
  contentType: string,
  metadata?: Record<string, string>
): Promise<string> {
  const bucket = getBucket();
  const file = bucket.file(path);
  await file.save(buffer, {
    contentType,
    metadata: metadata ?? {},
  });
  return path;
}

/** Generate a signed URL that lets a browser PUT a file directly to GCS (bypasses the API server). */
export async function getSignedUploadUrl(
  path: string,
  contentType: string,
  expiresInMinutes = 15,
): Promise<string> {
  const file = getBucket().file(path);
  const issuer = await resolveServiceAccountEmail();
  const [url] = await file.getSignedUrl({
    action: 'write',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
    contentType,
    version: 'v4',
    ...(issuer ? { issuer } : {}),
  });
  return url;
}

export async function getSignedUrl(path: string, expiresInMinutes = 60): Promise<string> {
  const bucket = getBucket();
  const file = bucket.file(path);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });
  return url;
}

/** Get file metadata from GCS, or null if not found. */
export async function getFileMetadata(path: string): Promise<{
  contentType: string;
  size: number;
} | null> {
  const file = getBucket().file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [metadata] = await file.getMetadata();
  return {
    contentType: (metadata.contentType as string) ?? 'application/octet-stream',
    size: Number(metadata.size ?? 0),
  };
}

/** Create a readable stream from GCS, optionally with a byte range. */
export function createFileStream(path: string, start?: number, end?: number): NodeJS.ReadableStream {
  const file = getBucket().file(path);
  const opts: { start?: number; end?: number } = {};
  if (start !== undefined) opts.start = start;
  if (end !== undefined) opts.end = end;
  return file.createReadStream(opts);
}

/** Download full file bytes from GCS. */
export async function getFileBuffer(path: string): Promise<Buffer> {
  const file = getBucket().file(path);
  const [buf] = await file.download();
  return buf;
}
