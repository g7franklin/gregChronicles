import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { getFirestore, COLLECTIONS } from '../../db/firestore.js';
import { AuthRequest } from '../../middleware/auth.js';
import { logger } from '../../lib/logger.js';
import { hashToken } from '../../lib/crypto.js';

const router: ReturnType<typeof Router> = Router();

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  smsConsent: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  smsConsent: z.boolean().optional(),
  status: z.enum(['active', 'unsubscribed']).optional(),
});

router.get('/export.csv', async (_req: AuthRequest, res: Response) => {
  try {
    const snap = await getFirestore()
      .collection(COLLECTIONS.SUBSCRIBERS)
      .orderBy('createdAt', 'desc')
      .get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return [
        d.id,
        data.name ?? '',
        data.email ?? '',
        data.phone ?? '',
        data.smsConsent ?? false,
        data.status ?? '',
        data.createdAt?.toDate?.()?.toISOString?.() ?? '',
        data.unsubscribedAt?.toDate?.()?.toISOString?.() ?? '',
      ];
    });
    const header = 'id,name,email,phone,smsConsent,status,createdAt,unsubscribedAt\n';
    const csv = header + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
    res.send(csv);
  } catch (err) {
    logger.error('GET /admin/subscribers/export.csv', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const snap = await getFirestore()
      .collection(COLLECTIONS.SUBSCRIBERS)
      .orderBy('createdAt', 'desc')
      .get();
    const subscribers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ subscribers });
  } catch (err) {
    logger.error('GET /admin/subscribers', err);
    res.status(500).json({ error: 'Failed to list subscribers' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }
    const token = crypto.randomBytes(32).toString('hex');
    const doc = {
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone ?? '',
      smsConsent: parsed.data.smsConsent ?? false,
      status: 'active',
      createdAt: new Date(),
      unsubscribedAt: null,
      unsubscribeTokenHash: hashToken(token),
    };
    const ref = await getFirestore().collection(COLLECTIONS.SUBSCRIBERS).add(doc);
    res.status(201).json({ id: ref.id, ...doc, unsubscribeToken: token });
  } catch (err) {
    logger.error('POST /admin/subscribers', err);
    res.status(500).json({ error: 'Failed to create subscriber' });
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }
    const ref = getFirestore().collection(COLLECTIONS.SUBSCRIBERS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Subscriber not found' });
      return;
    }
    const updates: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.status === 'unsubscribed') {
      updates.unsubscribedAt = new Date();
    }
    await ref.update(updates);
    const updated = await ref.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    logger.error('PATCH /admin/subscribers/:id', err);
    res.status(500).json({ error: 'Failed to update subscriber' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ref = getFirestore().collection(COLLECTIONS.SUBSCRIBERS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Subscriber not found' });
      return;
    }
    await ref.delete();
    res.status(204).send();
  } catch (err) {
    logger.error('DELETE /admin/subscribers/:id', err);
    res.status(500).json({ error: 'Failed to delete subscriber' });
  }
});

export default router;
