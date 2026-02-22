import { Storage } from '@google-cloud/storage';
import { getProjectId, getBucketName } from '../config.js';

let storage: Storage | null = null;

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

export async function getSignedUrl(path: string, expiresInMinutes = 60): Promise<string> {
  const bucket = getBucket();
  const file = bucket.file(path);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });
  return url;
}
