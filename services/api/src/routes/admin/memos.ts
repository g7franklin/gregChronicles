import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Timestamp } from '@google-cloud/firestore';
import { getFirestore } from '../../db/firestore.js';
import { COLLECTIONS } from '../../db/firestore.js';
import { uploadBuffer, getSignedUrl } from '../../storage/gcs.js';
import { getWeekKey } from '../../lib/weekKey.js';
import { AuthRequest } from '../../middleware/auth.js';
import { logger } from '../../lib/logger.js';

const router = Router();

function toJsonMemo(id: string, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { id, ...data };
  if (data.createdAt && typeof (data.createdAt as { toDate?: () => Date }).toDate === 'function') {
    out.createdAt = (data.createdAt as { toDate: () => Date }).toDate().toISOString();
  }
  const attachments = (data.attachments as Array<{ createdAt?: { toDate?: () => Date } }>) ?? [];
  out.attachments = attachments.map((a) => ({
    ...a,
    createdAt: a.createdAt?.toDate?.()?.toISOString?.() ?? null,
  }));
  return out;
}

const memoCreateSchema = z.object({
  transcript: z.string(),
  title: z.string().optional(),
  attachmentSummary: z.string().optional(),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

router.post(
  '/',
  upload.fields([
    { name: 'recordedAudio', maxCount: 1 },
    { name: 'attachments', maxCount: 20 },
  ]),
  async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.uid!;
      const body = req.body as Record<string, string>;
      const parsed = memoCreateSchema.safeParse({
        transcript: body.transcript ?? '',
        title: body.title,
        attachmentSummary: body.attachmentSummary,
      });
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
        return;
      }

      const files = req.files as Record<string, Express.Multer.File[]>;
      const recorded = files?.recordedAudio?.[0];
      const attachments = files?.attachments ?? [];

      const now = new Date();
      const weekKey = getWeekKey(now);
      const memoId = getFirestore().collection(COLLECTIONS.MEMOS).doc().id;

      const attachmentsList: Array<{
        id: string;
        type: 'audio' | 'video';
        originalName: string;
        gcsPath: string;
        contentType: string;
        sizeBytes: number;
        durationSec?: number;
        createdAt: Timestamp;
      }> = [];

      const allowedAudio = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4'];
      const allowedVideo = ['video/mp4', 'video/quicktime', 'video/webm'];

      const processFile = async (file: Express.Multer.File, suffix: string): Promise<void> => {
        const contentType = file.mimetype;
        const isAudio = allowedAudio.includes(contentType) || contentType.startsWith('audio/');
        const isVideo = allowedVideo.includes(contentType) || contentType.startsWith('video/');
        const type = isVideo ? 'video' : 'audio';
        const ext = type === 'video' ? (contentType.includes('quicktime') ? 'mov' : 'mp4') : 'mp3';
        const attId = getFirestore().collection(COLLECTIONS.MEMOS).doc().id;
        const gcsPath = `memos/${memoId}/${attId}.${ext}`;
        await uploadBuffer(gcsPath, file.buffer, contentType);
        attachmentsList.push({
          id: attId,
          type,
          originalName: file.originalname,
          gcsPath,
          contentType,
          sizeBytes: file.size,
          createdAt: Timestamp.fromDate(now),
        });
      };

      if (recorded) {
        await processFile(recorded, 'recorded');
      }
      for (const f of attachments) {
        await processFile(f, 'att');
      }

      const doc = {
        createdAt: now,
        transcript: parsed.data.transcript,
        title: parsed.data.title ?? null,
        weekKey,
        createdByUid: uid,
        attachments: attachmentsList,
        attachmentSummary: parsed.data.attachmentSummary ?? null,
      };

      await getFirestore().collection(COLLECTIONS.MEMOS).doc(memoId).set(doc);

      res.status(201).json(toJsonMemo(memoId, doc as Record<string, unknown>));
    } catch (err) {
      logger.error('POST /admin/memos', err);
      res.status(500).json({ error: 'Failed to create memo' });
    }
  }
);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const query = (req.query.query as string) ?? '';
    const start = req.query.start as string | undefined;
    const end = req.query.end as string | undefined;

    let q = getFirestore()
      .collection(COLLECTIONS.MEMOS)
      .orderBy('createdAt', 'desc')
      .limit(200);

    if (start) {
      q = q.where('createdAt', '>=', new Date(start));
    }
    if (end) {
      q = q.where('createdAt', '<=', new Date(end));
    }

    const snap = await q.get();
    let items = snap.docs.map((d) => toJsonMemo(d.id, d.data()));

    if (query.trim()) {
      const lower = query.toLowerCase();
      items = items.filter(
        (m: { transcript?: string; title?: string }) =>
          (m.transcript ?? '').toLowerCase().includes(lower) ||
          (m.title ?? '').toLowerCase().includes(lower)
      );
    }

    res.json({ memos: items });
  } catch (err) {
    logger.error('GET /admin/memos', err);
    res.status(500).json({ error: 'Failed to list memos' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const doc = await getFirestore().collection(COLLECTIONS.MEMOS).doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Memo not found' });
      return;
    }
    res.json({ id: doc.id, ...toJsonMemo(doc.id, doc.data()!) });
  } catch (err) {
    logger.error('GET /admin/memos/:id', err);
    res.status(500).json({ error: 'Failed to get memo' });
  }
});

router.get('/:id/attachments/:attachmentId/signedUrl', async (req: AuthRequest, res: Response) => {
  try {
    const { id, attachmentId } = req.params;
    const doc = await getFirestore().collection(COLLECTIONS.MEMOS).doc(id).get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Memo not found' });
      return;
    }
    const data = doc.data()!;
    const attachments = (data.attachments ?? []) as Array<{ id: string; gcsPath: string }>;
    const att = attachments.find((a) => a.id === attachmentId);
    if (!att) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }
    const url = await getSignedUrl(att.gcsPath, 60);
    res.json({ url });
  } catch (err) {
    logger.error('GET signed URL', err);
    res.status(500).json({ error: 'Failed to get signed URL' });
  }
});

export default router;
