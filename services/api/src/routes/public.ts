import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { getFirestore, COLLECTIONS } from '../db/firestore.js';
import { logger } from '../lib/logger.js';
import { verifyUnsubscribeToken } from '../lib/unsubscribeToken.js';
import { hashToken } from '../lib/crypto.js';

const router: ReturnType<typeof Router> = Router();

const subscribeSchema = z.object({
  name: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  smsConsent: z.boolean().optional(),
});

router.get('/newsletters', async (_req, res: Response) => {
  try {
    const snap = await getFirestore()
      .collection(COLLECTIONS.NEWSLETTERS)
      .orderBy('sentAt', 'desc')
      .limit(100)
      .get();
    const newsletters = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        weekKey: data.weekKey,
        sentAt: data.sentAt?.toDate?.()?.toISOString?.(),
        subject: data.subject,
        publicSlug: data.publicSlug,
      };
    });
    res.json({ newsletters });
  } catch (err) {
    logger.error('GET /public/newsletters', err);
    res.status(500).json({ error: 'Failed to list newsletters' });
  }
});

router.get('/newsletters/:slug', async (req, res: Response) => {
  try {
    const snap = await getFirestore()
      .collection(COLLECTIONS.NEWSLETTERS)
      .where('publicSlug', '==', req.params.slug)
      .limit(1)
      .get();
    if (snap.empty) {
      res.status(404).json({ error: 'Newsletter not found' });
      return;
    }
    const doc = snap.docs[0];
    const data = doc.data();
    res.json({
      id: doc.id,
      weekKey: data.weekKey,
      sentAt: data.sentAt?.toDate?.()?.toISOString?.(),
      subject: data.subject,
      bodyMarkdown: data.bodyMarkdown,
      bodyHtml: data.bodyHtml,
      publicSlug: data.publicSlug,
    });
  } catch (err) {
    logger.error('GET /public/newsletters/:slug', err);
    res.status(500).json({ error: 'Failed to get newsletter' });
  }
});

router.post('/subscribe', async (req, res: Response) => {
  try {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }
    const normalizedEmail = parsed.data.email.toLowerCase().trim();
    const existing = await getFirestore()
      .collection(COLLECTIONS.SUBSCRIBERS)
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();
    if (!existing.empty) {
      const sub = existing.docs[0].data();
      if (sub.status === 'active') {
        res.status(200).json({ message: 'Already subscribed', id: existing.docs[0].id });
        return;
      }
      const ref = existing.docs[0].ref;
      const token = crypto.randomBytes(32).toString('hex');
      await ref.update({
        name: parsed.data.name ?? '',
        phone: parsed.data.phone ?? '',
        smsConsent: parsed.data.smsConsent ?? false,
        status: 'active',
        unsubscribedAt: null,
        unsubscribeTokenHash: hashToken(token),
      });
      res.status(200).json({ message: 'Resubscribed', id: existing.docs[0].id });
      return;
    }
    const token = crypto.randomBytes(32).toString('hex');
    const doc = {
      name: parsed.data.name ?? '',
      email: normalizedEmail,
      phone: parsed.data.phone ?? '',
      smsConsent: parsed.data.smsConsent ?? false,
      status: 'active',
      createdAt: new Date(),
      unsubscribedAt: null,
      unsubscribeTokenHash: hashToken(token),
    };
    const ref = await getFirestore().collection(COLLECTIONS.SUBSCRIBERS).add(doc);
    res.status(201).json({ id: ref.id, message: 'Subscribed' });
  } catch (err) {
    logger.error('POST /public/subscribe', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

async function unsubscribeByToken(token: string, res: Response): Promise<void> {
  const subId = verifyUnsubscribeToken(token);
  if (subId) {
    const ref = getFirestore().collection(COLLECTIONS.SUBSCRIBERS).doc(subId);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.update({ status: 'unsubscribed', unsubscribedAt: new Date() });
      res.json({ message: 'Unsubscribed' });
      return;
    }
  }
  const hash = hashToken(token);
  const snap = await getFirestore()
    .collection(COLLECTIONS.SUBSCRIBERS)
    .where('unsubscribeTokenHash', '==', hash)
    .limit(1)
    .get();
  if (snap.empty) {
    res.status(404).json({ error: 'Invalid or expired link' });
    return;
  }
  await snap.docs[0].ref.update({
    status: 'unsubscribed',
    unsubscribedAt: new Date(),
  });
  res.json({ message: 'Unsubscribed' });
}

router.post('/unsubscribe', async (req, res: Response) => {
  try {
    const token = (req.body?.token ?? req.query?.token) as string | undefined;
    if (!token) {
      res.status(400).json({ error: 'Missing token' });
      return;
    }
    await unsubscribeByToken(token, res);
  } catch (err) {
    logger.error('POST /public/unsubscribe', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

router.get('/unsubscribe', async (req, res: Response) => {
  try {
    const token = req.query.token as string | undefined;
    if (!token) {
      res.status(400).json({ error: 'Missing token' });
      return;
    }
    await unsubscribeByToken(token, res);
  } catch (err) {
    logger.error('GET /public/unsubscribe', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

export default router;
