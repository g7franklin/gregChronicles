import { Router, type IRouter, type Response } from 'express';
import { z } from 'zod';
import { getFirestore } from '../../db/firestore.js';
import { COLLECTIONS } from '../../db/firestore.js';
import { AuthRequest } from '../../middleware/auth.js';
import { logger } from '../../lib/logger.js';
import { runGenerateWeeklyDraft } from '../../jobs/generateWeeklyDraft.js';
import { sendDraftById } from '../../jobs/sendWeeklyNewsletter.js';
import { generateDraftEdit } from '../../llm/grokClient.js';
import { replaceGcsUrlsWithMediaProxy } from '../../lib/mediaUrls.js';
import { getSundayOfWeekKey, getWeekKey } from '../../lib/weekKey.js';

const router: IRouter = Router();

const updateSchema = z.object({
  subject: z.string().optional(),
  bodyMarkdown: z.string().optional(),
  bodyHtml: z.string().optional(),
});

const chatSchema = z.object({
  message: z.string().min(1, 'Message is required'),
});

const sendNowSchema = z.object({
  confirmationPhrase: z.string(),
});

/** Exact phrase required to manually send (case-sensitive). */
const MANUAL_SEND_CONFIRMATION_PHRASE = 'I solemnly swear I am up to no good';

/** Generate a new draft from the last 7 days of memos (same as Saturday job). Uses real memo content. */
router.post('/generate', (req: AuthRequest, res: Response) => {
  runGenerateWeeklyDraft()
    .then(({ draftId }) => {
      res.json({ ok: true, draftId });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('POST /admin/drafts/generate failed', err);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Draft generation failed',
          details: message,
        });
      }
    });
});

function draftToJson(id: string, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { id, ...data };
  ['generatedAt', 'approvedAt', 'sentAt'].forEach((k) => {
    const v = data[k];
    if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
      out[k] = (v as { toDate: () => Date }).toDate().toISOString();
    }
  });
  const weekKey = data.weekKey as string | undefined;
  if (weekKey) {
    const sendDate = getSundayOfWeekKey(weekKey);
    if (sendDate) {
      out.plannedSendAt = sendDate.toISOString();
      out.plannedSendLabel = sendDate.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    }
  }
  return out;
}

/**
 * Current draft = latest draft for the week the newsletter goes out.
 * "This week" = the ISO week containing today; that week's Sunday is the send date (e.g. Wed before that Sunday = same week).
 * Each draft has generatedAt (timestamp) and weekKey (e.g. 2026-W09). We return the most recent draft for this week only.
 * Empty only when there are no drafts for this week.
 */
router.get('/current', async (_req: AuthRequest, res: Response) => {
  const db = getFirestore();
  const coll = db.collection(COLLECTIONS.DRAFTS);
  const weekKey = getWeekKey(new Date());

  try {
    let doc: { id: string; data: () => Record<string, unknown> } | null = null;
    try {
      const snap = await coll
        .where('weekKey', '==', weekKey)
        .orderBy('generatedAt', 'desc')
        .limit(1)
        .get();
      if (!snap.empty) doc = snap.docs[0];
    } catch (queryErr) {
      logger.warn('GET /admin/drafts/current indexed query failed (add composite index on weekKey, generatedAt), using fallback');
      const snap = await coll.orderBy('generatedAt', 'desc').limit(50).get();
      for (const d of snap.docs) {
        if ((d.data()?.weekKey as string) === weekKey) {
          doc = d;
          break;
        }
      }
    }
    if (!doc) {
      res.status(404).json({ error: 'No current draft' });
      return;
    }
    const data = doc.data();
    res.json(draftToJson(doc.id, data ?? {}));
  } catch (err) {
    logger.error('GET /admin/drafts/current', err);
    res.status(500).json({ error: 'Failed to get draft' });
  }
});

/** Returns bodyMarkdown with stable media proxy URLs so preview images/videos always load. */
router.get('/:id/preview-body', async (req: AuthRequest, res: Response) => {
  try {
    const doc = await getFirestore().collection(COLLECTIONS.DRAFTS).doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    const bodyMarkdown = (doc.data()?.bodyMarkdown as string) ?? '';
    const out = replaceGcsUrlsWithMediaProxy(bodyMarkdown);
    res.json({ bodyMarkdown: out });
  } catch (err) {
    logger.error('GET /admin/drafts/:id/preview-body failed', err);
    res.status(500).json({ error: 'Failed to get preview body' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const doc = await getFirestore().collection(COLLECTIONS.DRAFTS).doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    res.json(draftToJson(doc.id, doc.data()!));
  } catch (err) {
    logger.error('GET /admin/drafts/:id', err);
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

/** Revert draft to pending approval (unapprove). */
router.post('/:id/unapprove', async (req: AuthRequest, res: Response) => {
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
    await ref.update({ status: 'pending_approval', approvedAt: null });
    const updated = await ref.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    logger.error('POST /admin/drafts/:id/unapprove', err);
    res.status(500).json({ error: 'Failed to unapprove draft' });
  }
});

/** Chat with agent to edit the draft. Updates draft with revised subject/body and returns them. */
router.post('/:id/chat', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = chatSchema.safeParse(req.body);
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
    const currentSubject = data.subject ?? 'Weekly Update';
    const currentBody = data.bodyMarkdown ?? '';
    const result = await generateDraftEdit({
      currentSubject,
      currentBodyMarkdown: currentBody,
      userMessage: parsed.data.message,
    });
    await ref.update({ subject: result.subject, bodyMarkdown: result.bodyMarkdown });
    res.json({ subject: result.subject, bodyMarkdown: result.bodyMarkdown });
  } catch (err) {
    logger.error('POST /admin/drafts/:id/chat failed', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Chat edit failed' });
  }
});

/** Manually send this draft now. Requires exact confirmation phrase. */
router.post('/:id/send-now', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = sendNowSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'confirmationPhrase is required' });
      return;
    }
    if (parsed.data.confirmationPhrase !== MANUAL_SEND_CONFIRMATION_PHRASE) {
      res.status(400).json({
        error: 'Confirmation phrase does not match. You must type the exact phrase to send.',
      });
      return;
    }
    const result = await sendDraftById(req.params.id);
    if (!result.sent) {
      res.status(400).json({ error: result.reason ?? 'Send failed' });
      return;
    }
    res.json({ ok: true, publicSlug: result.publicSlug });
  } catch (err) {
    logger.error('POST /admin/drafts/:id/send-now failed', err);
    res.status(500).json({ error: 'Send failed' });
  }
});

export default router;
