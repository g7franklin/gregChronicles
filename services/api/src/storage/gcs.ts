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
