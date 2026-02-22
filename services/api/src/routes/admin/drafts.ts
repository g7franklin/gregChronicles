import { Router, Response } from 'express';
import { z } from 'zod';
import { getFirestore } from '../../db/firestore.js';
import { COLLECTIONS } from '../../db/firestore.js';
import { AuthRequest } from '../../middleware/auth.js';
import { logger } from '../../lib/logger.js';

const router = Router();

const updateSchema = z.object({
  subject: z.string().optional(),
  bodyMarkdown: z.string().optional(),
  bodyHtml: z.string().optional(),
});

router.get('/current', async (_req: AuthRequest, res: Response) => {
  try {
    const snap = await getFirestore()
      .collection(COLLECTIONS.DRAFTS)
      .where('status', 'in', ['pending_approval', 'approved'])
      .orderBy('generatedAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) {
      res.status(404).json({ error: 'No current draft' });
      return;
    }
    const doc = snap.docs[0];
    const data = doc.data()!;
    const out: Record<string, unknown> = { id: doc.id, ...data };
    ['generatedAt', 'approvedAt', 'sentAt'].forEach((k) => {
      const v = data[k];
      if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
        out[k] = (v as { toDate: () => Date }).toDate().toISOString();
      }
    });
    res.json(out);
  } catch (err) {
    logger.error('GET /admin/drafts/current', err);
    res.status(500).json({ error: 'Failed to get draft' });
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }
    const ref = getFirestore().collection(COLLECTIONS.DRAFTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    const data = snap.data()!;
    if (data.status === 'sent') {
      res.status(400).json({ error: 'Draft already sent' });
      return;
    }
    const updates: Record<string, unknown> = { ...parsed.data };
    if (Object.keys(updates).length > 0) {
      await ref.update(updates);
    }
    const updated = await ref.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    logger.error('PATCH /admin/drafts/:id', err);
    res.status(500).json({ error: 'Failed to update draft' });
  }
});

router.post('/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const ref = getFirestore().collection(COLLECTIONS.DRAFTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    const data = snap.data()!;
    if (data.status === 'sent') {
      res.status(400).json({ error: 'Draft already sent' });
      return;
    }
    await ref.update({ status: 'approved', approvedAt: new Date() });
    const updated = await ref.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    logger.error('POST /admin/drafts/:id/approve', err);
    res.status(500).json({ error: 'Failed to approve draft' });
  }
});

export default router;
