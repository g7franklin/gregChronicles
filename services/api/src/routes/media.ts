import { Router, type Request, type Response } from 'express';
import { getFileMetadata, createFileStream } from '../storage/gcs.js';
import { logger, toErrorMessage } from '../lib/logger.js';

const router: ReturnType<typeof Router> = Router();

/**
 * Media proxy: streams files from GCS with HTTP Range support.
 * Path format: /media/memos/{memoId}/{attId}.{ext}
 */
router.get('*', async (req: Request, res: Response) => {
  const path = (req.path ?? '').replace(/^\/+/, '');
  if (!path || path.includes('..')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  try {
    const meta = await getFileMetadata(path);
    if (!meta) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }

    const { contentType, size } = meta;
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
    logger.warn('Media proxy failed', { path, error: detail });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to serve media' });
    }
  }
});

export default router;
