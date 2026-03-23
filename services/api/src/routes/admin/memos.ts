import { Router, type Response } from 'express';
import { z } from 'zod';
import { Timestamp } from '@google-cloud/firestore';
import { getFirestore, COLLECTIONS } from '../../db/firestore.js';
import { getSignedUploadUrl, getSignedUrl } from '../../storage/gcs.js';
import { getWeekKey } from '../../lib/weekKey.js';
import { AuthRequest } from '../../middleware/auth.js';
import { logger, toErrorMessage } from '../../lib/logger.js';

const router: ReturnType<typeof Router> = Router();

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

const attachmentInputSchema = z.object({
  attachmentId: z.string(),
  gcsPath: z.string(),
  originalName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  type: z.enum(['audio', 'video', 'image']),
});

const memoCreateSchema = z.object({
  memoId: z.string().optional(),
  transcript: z.string(),
  title: z.string().optional(),
  attachmentSummary: z.string().optional(),
  attachments: z.array(attachmentInputSchema).optional(),
});

/** Step 1: generate signed GCS upload URLs for each file. Returns memoId + per-file upload URLs. */
router.post('/upload-urls', async (req: AuthRequest, res: Response) => {
  try {
    const files = req.body?.files as Array<{ filename: string; contentType: string; size: number }>;
    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'files array is required' });
      return;
    }
    if (files.length > 30) {
      res.status(400).json({ error: 'Maximum 30 files per upload' });
      return;
    }
    const db = getFirestore();
    const memoId = db.collection(COLLECTIONS.MEMOS).doc().id;
    const uploads = await Promise.all(
      files.map(async ({ filename, contentType }) => {
        const attachmentId = db.collection(COLLECTIONS.MEMOS).doc().id;
        const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase().slice(0, 5) : 'bin';
        const gcsPath = `memos/${memoId}/${attachmentId}.${ext}`;
        const uploadUrl = await getSignedUploadUrl(gcsPath, contentType || 'application/octet-stream');
        return { attachmentId, gcsPath, uploadUrl };
      }),
    );
    res.json({ memoId, uploads });
  } catch (err) {
    logger.error('POST /admin/memos/upload-urls', err);
    res.status(500).json({ error: 'Failed to generate upload URLs', details: toErrorMessage(err) });
  }
});

/** Step 2: save the memo record. Files must already be in GCS from the upload-urls step. */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.uid!;
    const parsed = memoCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
      return;
    }
    const now = new Date();
    const weekKey = getWeekKey(now);
    const db = getFirestore();
    const memoId = parsed.data.memoId ?? db.collection(COLLECTIONS.MEMOS).doc().id;
    const attachmentsList = (parsed.data.attachments ?? []).map((a) => ({
      id: a.attachmentId,
      type: a.type,
      originalName: a.originalName,
      gcsPath: a.gcsPath,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      createdAt: Timestamp.fromDate(now),
    }));
    const doc = {
      createdAt: now,
      transcript: parsed.data.transcript,
      title: parsed.data.title ?? null,
      weekKey,
      createdByUid: uid,
      attachments: attachmentsList,
      attachmentSummary: parsed.data.attachmentSummary ?? null,
    };
    await db.collection(COLLECTIONS.MEMOS).doc(memoId).set(doc);
    res.status(201).json(toJsonMemo(memoId, doc as Record<string, unknown>));
  } catch (err) {
    logger.error('POST /admin/memos', err);
    res.status(500).json({
      error: 'Failed to create memo',
      ...(process.env.NODE_ENV !== 'production' && { details: toErrorMessage(err) }),
    });
  }
});

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
