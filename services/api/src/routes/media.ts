import { createRequire } from 'module';
import { Router, type Request, type Response } from 'express';
import { getFileMetadata, createFileStream, getFileBuffer, uploadBuffer } from '../storage/gcs.js';
import { logger, toErrorMessage } from '../lib/logger.js';

const router: ReturnType<typeof Router> = Router();
const require = createRequire(import.meta.url);
const heicConvert = require('heic-convert') as (opts: {
  buffer: Buffer;
  format: 'JPEG' | 'PNG';
  quality?: number;
}) => Promise<Buffer>;

function isHeic(path: string, contentType: string): boolean {
  const p = path.toLowerCase();
  const ct = (contentType || '').toLowerCase();
  return p.endsWith('.heic') || p.endsWith('.heif') || ct === 'image/heic' || ct === 'image/heif';
}

/**
 * Media proxy: streams files from GCS with HTTP Range support.
 * Path format: /media/memos/{memoId}/{attId}.{ext}
 */
router.get('*', async (req: Request, res: Response) => {
  const requestedPath = (req.path ?? '').replace(/^\/+/, '');
  if (!requestedPath || requestedPath.includes('..')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  try {
    let path = requestedPath;
    let forceJpegAlias = false;
    const lower = requestedPath.toLowerCase();
    if (lower.endsWith('.heic.jpg') || lower.endsWith('.heif.jpg')) {
      path = requestedPath.slice(0, -4); // drop the trailing ".jpg" alias
      forceJpegAlias = true;
    }

    const meta = await getFileMetadata(path);
    if (!meta) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }

    const { contentType, size } = meta;

    // HEIC/HEIF is not reliably viewable in many browsers/email clients.
    // Convert on the fly to JPEG so newsletter/public rendering is consistent.
    if (forceJpegAlias || isHeic(path, contentType)) {
      const convertedPath = `${path}.jpg`;
      const convertedMeta = await getFileMetadata(convertedPath);
      if (convertedMeta && convertedMeta.contentType.toLowerCase().startsWith('image/jpeg')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', convertedMeta.size);
        createFileStream(convertedPath).pipe(res);
        return;
      }

      const sourceBuffer = await getFileBuffer(path);
      const jpgBuffer = await heicConvert({ buffer: sourceBuffer, format: 'JPEG', quality: 0.92 });
      // Cache converted JPEG in GCS so subsequent requests are fast/reliable.
      await uploadBuffer(convertedPath, jpgBuffer, 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', jpgBuffer.length);
      res.send(jpgBuffer);
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', contentType);

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
        return;
      }
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : size - 1;
      if (start >= size || end >= size) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      createFileStream(path, start, end).pipe(res);
    } else {
      res.setHeader('Content-Length', size);
      createFileStream(path).pipe(res);
    }
  } catch (err) {
    const detail = toErrorMessage(err);
    logger.warn('Media proxy failed', { path: requestedPath, error: detail });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to serve media' });
    }
  }
});

export default router;
