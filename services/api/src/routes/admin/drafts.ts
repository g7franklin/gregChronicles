import { Timestamp } from '@google-cloud/firestore';
import { Router, type IRouter, type Response } from 'express';
import { z } from 'zod';
import { getFirestore, COLLECTIONS } from '../../db/firestore.js';
import { AuthRequest } from '../../middleware/auth.js';
import { logger, toErrorMessage } from '../../lib/logger.js';
import { runGenerateWeeklyDraft } from '../../jobs/generateWeeklyDraft.js';
import { sendDraftById } from '../../jobs/sendWeeklyNewsletter.js';
import { generateDraftEdit, isValidProvider, type LlmProvider, DEFAULT_PROVIDER } from '../../llm/index.js';
import { replaceGcsUrlsWithMediaProxy } from '../../lib/mediaUrls.js';
import { getSundayOfWeekKey, getWeekKey } from '../../lib/weekKey.js';
import { getApiBaseUrl } from '../../config.js';
import { loadFormattedMemoContextForDraft } from '../../lib/draftMemoContext.js';

const router: IRouter = Router();

const updateSchema = z.object({
  subject: z.string().optional(),
  bodyMarkdown: z.string().optional(),
  bodyHtml: z.string().optional(),
  /** Optional display label in the admin draft list (empty string clears to date fallback). */
  name: z.string().max(200).optional(),
});

const chatSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  provider: z.enum(['claude', 'grok']).optional(),
});

const sendNowSchema = z.object({
  confirmationPhrase: z.string(),
});

/** Exact phrase required to manually send (case-sensitive). */
const MANUAL_SEND_CONFIRMATION_PHRASE = 'I solemnly swear I am up to no good';

function toRenderableMediaUrl(apiBase: string, gcsPath: string): string {
  const base = `${apiBase}/media/${gcsPath}`;
  const lower = gcsPath.toLowerCase();
  return lower.endsWith('.heic') || lower.endsWith('.heif') ? `${base}.jpg` : base;
}

/** Generate a new draft from memos. Optionally accepts startDate and endDate (ISO strings) to control the memo date range. */
router.post('/generate', (req: AuthRequest, res: Response) => {
  const provider: LlmProvider = isValidProvider(req.body?.provider) ? req.body.provider : DEFAULT_PROVIDER;
  const startDate = req.body?.startDate ? new Date(req.body.startDate as string) : undefined;
  const endDate = req.body?.endDate ? new Date(req.body.endDate as string) : undefined;
  runGenerateWeeklyDraft(provider, { startDate, endDate })
    .then(({ draftId }) => {
      res.json({ ok: true, draftId });
    })
    .catch((err: unknown) => {
      const message = toErrorMessage(err);
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
  ['generatedAt', 'approvedAt', 'sentAt', 'memoRangeStart', 'memoRangeEnd'].forEach((k) => {
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

/** List payload: no body fields (avoid large responses). */
function draftSummaryToJson(id: string, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id,
    weekKey: data.weekKey,
    status: data.status,
    subject: data.subject ?? '',
    name: typeof data.name === 'string' ? data.name : '',
  };
  ['generatedAt', 'approvedAt', 'sentAt', 'memoRangeStart', 'memoRangeEnd'].forEach((k) => {
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

const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;

function parseWeekKeyQuery(raw: unknown): string {
  if (typeof raw === 'string' && WEEK_KEY_RE.test(raw)) return raw;
  return getWeekKey(new Date());
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

/**
 * All drafts for an ISO week (default: current week), newest first.
 * Use this to switch between generated versions without losing older drafts.
 */
router.get('/for-week', async (req: AuthRequest, res: Response) => {
  const db = getFirestore();
  const coll = db.collection(COLLECTIONS.DRAFTS);
  const weekKey = parseWeekKeyQuery(req.query.weekKey);

  try {
    const summaries: Record<string, unknown>[] = [];
    try {
      const snap = await coll.where('weekKey', '==', weekKey).orderBy('generatedAt', 'desc').limit(50).get();
      for (const d of snap.docs) {
        summaries.push(draftSummaryToJson(d.id, d.data() ?? {}));
      }
    } catch (_queryErr) {
      logger.warn(
        'GET /admin/drafts/for-week indexed query failed (add composite index on weekKey, generatedAt), using fallback',
      );
      const snap = await coll.orderBy('generatedAt', 'desc').limit(100).get();
      for (const d of snap.docs) {
        if ((d.data()?.weekKey as string) === weekKey) {
          summaries.push(draftSummaryToJson(d.id, d.data() ?? {}));
        }
      }
    }
    res.json({ weekKey, drafts: summaries });
  } catch (err) {
    logger.error('GET /admin/drafts/for-week', err);
    res.status(500).json({ error: 'Failed to list drafts' });
  }
});

const DRAFT_LIST_LOOKBACK_MS = 28 * 24 * 60 * 60 * 1000;

/** Recent drafts only (generated in the last 4 weeks), newest first. */
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const coll = getFirestore().collection(COLLECTIONS.DRAFTS);
    const cutoff = new Date(Date.now() - DRAFT_LIST_LOOKBACK_MS);
    let summaries: Record<string, unknown>[] = [];
    try {
      const snap = await coll
        .where('generatedAt', '>=', Timestamp.fromDate(cutoff))
        .orderBy('generatedAt', 'desc')
        .limit(100)
        .get();
      summaries = snap.docs.map((d) => draftSummaryToJson(d.id, d.data() ?? {}));
    } catch (_err) {
      logger.warn('GET /admin/drafts filtered query failed, using fallback (orderBy + in-memory filter)');
      const snap = await coll.orderBy('generatedAt', 'desc').limit(200).get();
      for (const d of snap.docs) {
        const ga = d.data()?.generatedAt as { toDate?: () => Date } | undefined;
        const t = ga?.toDate?.();
        if (t && t.getTime() >= cutoff.getTime()) {
          summaries.push(draftSummaryToJson(d.id, d.data() ?? {}));
        }
      }
    }
    res.json({ drafts: summaries });
  } catch (err) {
    logger.error('GET /admin/drafts', err);
    res.status(500).json({ error: 'Failed to list drafts' });
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

/** List media candidates (photos/videos/audio) available for this draft so UI can add/swap media. */
router.get('/:id/media-candidates', async (req: AuthRequest, res: Response) => {
  try {
    const db = getFirestore();
    const draftDoc = await db.collection(COLLECTIONS.DRAFTS).doc(req.params.id).get();
    if (!draftDoc.exists) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    const draft = draftDoc.data() ?? {};
    const apiBase = getApiBaseUrl().replace(/\/$/, '');
    const memoIds = ((draft.memoIds ?? []) as unknown[]).filter((x): x is string => typeof x === 'string');
    const candidates: Array<{
      memoId: string;
      attachmentId: string;
      type: 'audio' | 'video' | 'image';
      originalName: string;
      contentType: string;
      sizeBytes: number;
      createdAt: string | null;
      url: string;
    }> = [];

    const collectFromMemoDoc = (memoId: string, data: Record<string, unknown>) => {
      const attachments = (data.attachments ?? []) as Array<{
        id?: string;
        type?: 'audio' | 'video' | 'image';
        originalName?: string;
        gcsPath?: string;
        contentType?: string;
        sizeBytes?: number;
        createdAt?: { toDate?: () => Date };
      }>;
      for (const a of attachments) {
        if (!a.gcsPath || !a.id || !a.type) continue;
        candidates.push({
          memoId,
          attachmentId: a.id,
          type: a.type,
          originalName: a.originalName ?? 'attachment',
          contentType: a.contentType ?? 'application/octet-stream',
          sizeBytes: Number(a.sizeBytes ?? 0),
          createdAt: a.createdAt?.toDate?.()?.toISOString?.() ?? null,
          url: toRenderableMediaUrl(apiBase, a.gcsPath),
        });
      }
    };

    if (memoIds.length > 0) {
      const snaps = await Promise.all(memoIds.map((memoId) => db.collection(COLLECTIONS.MEMOS).doc(memoId).get()));
      snaps.forEach((snap) => {
        if (snap.exists) collectFromMemoDoc(snap.id, snap.data() as Record<string, unknown>);
      });
    }

    res.json({ candidates });
  } catch (err) {
    logger.error('GET /admin/drafts/:id/media-candidates failed', err);
    res.status(500).json({ error: 'Failed to load media candidates', details: toErrorMessage(err) });
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
    const { subject, bodyMarkdown, bodyHtml, name } = parsed.data;
    const updates: Record<string, unknown> = {};
    if (subject !== undefined) updates.subject = subject;
    if (bodyMarkdown !== undefined) updates.bodyMarkdown = bodyMarkdown;
    if (bodyHtml !== undefined) updates.bodyHtml = bodyHtml;
    if (name !== undefined) updates.name = name;
    const keys = Object.keys(updates);
    if (data.status === 'sent') {
      const disallowed = keys.filter((k) => k !== 'name');
      if (disallowed.length > 0) {
        res.status(400).json({ error: 'Sent drafts can only be renamed' });
        return;
      }
    }
    if (keys.length > 0) {
      await ref.update(updates);
    }
    const updated = await ref.get();
    res.json(draftToJson(updated.id, updated.data() ?? {}));
  } catch (err) {
    logger.error('PATCH /admin/drafts/:id', err);
    res.status(500).json({ error: 'Failed to update draft' });
  }
});

router.post('/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.DRAFTS).doc(req.params.id);
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

    const weekKey = data.weekKey as string;
    if (weekKey) {
      const otherApproved = await db
        .collection(COLLECTIONS.DRAFTS)
        .where('weekKey', '==', weekKey)
        .where('status', '==', 'approved')
        .get()
        .catch(async () => {
          const all = await db.collection(COLLECTIONS.DRAFTS).where('weekKey', '==', weekKey).get();
          return { docs: all.docs.filter((d) => d.data().status === 'approved') };
        });
      const batch = db.batch();
      for (const doc of otherApproved.docs) {
        if (doc.id !== req.params.id) {
          batch.update(doc.ref, { status: 'pending_approval', approvedAt: null });
        }
      }
      await batch.commit();
    }

    await ref.update({ status: 'approved', approvedAt: new Date() });
    const updated = await ref.get();
    res.json(draftToJson(updated.id, updated.data() ?? {}));
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
    res.json(draftToJson(updated.id, updated.data() ?? {}));
  } catch (err) {
    logger.error('POST /admin/drafts/:id/unapprove', err);
    res.status(500).json({ error: 'Failed to unapprove draft' });
  }
});

/** Create a new draft with the same content as this one (new id, generatedAt now, pending approval). */
router.post('/:id/duplicate', async (req: AuthRequest, res: Response) => {
  try {
    const db = getFirestore();
    const srcRef = db.collection(COLLECTIONS.DRAFTS).doc(req.params.id);
    const snap = await srcRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    const src = snap.data()!;
    const now = new Date();
    const weekKey = getWeekKey(now);
    const srcName = typeof src.name === 'string' ? src.name.trim() : '';
    const dupName = srcName
      ? `${srcName} (copy)`
      : now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const newRef = await db.collection(COLLECTIONS.DRAFTS).add({
      weekKey,
      status: 'pending_approval',
      generatedAt: now,
      approvedAt: null,
      sentAt: null,
      name: dupName,
      subject: src.subject ?? '',
      bodyMarkdown: src.bodyMarkdown ?? '',
      bodyHtml: src.bodyHtml ?? null,
      memoIds: src.memoIds ?? [],
      contextNewsletterIds: src.contextNewsletterIds ?? [],
      usedPromptVersionId: src.usedPromptVersionId ?? null,
      memoRangeStart: src.memoRangeStart ?? null,
      memoRangeEnd: src.memoRangeEnd ?? null,
    });
    const created = await newRef.get();
    res.json({ ok: true, draftId: newRef.id, draft: draftToJson(newRef.id, created.data() ?? {}) });
  } catch (err) {
    logger.error('POST /admin/drafts/:id/duplicate', err);
    res.status(500).json({ error: 'Failed to duplicate draft' });
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
    const chatProvider: LlmProvider = parsed.data.provider ?? DEFAULT_PROVIDER;
    const sourceMemosFormatted = await loadFormattedMemoContextForDraft(data as Record<string, unknown>);
    const result = await generateDraftEdit(
      {
        currentSubject,
        currentBodyMarkdown: currentBody,
        userMessage: parsed.data.message,
        sourceMemosFormatted,
      },
      chatProvider,
    );
    await ref.update({ subject: result.subject, bodyMarkdown: result.bodyMarkdown });
    res.json({ subject: result.subject, bodyMarkdown: result.bodyMarkdown });
  } catch (err) {
    logger.error('POST /admin/drafts/:id/chat failed', err);
    res.status(500).json({ error: toErrorMessage(err) });
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
    res.status(500).json({
      error: 'Send failed',
      details: toErrorMessage(err),
    });
  }
});

/** Permanently remove a draft. Sent newsletters cannot be deleted. */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ref = getFirestore().collection(COLLECTIONS.DRAFTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    if (snap.data()?.status === 'sent') {
      res.status(400).json({ error: 'Cannot delete a draft that has already been sent' });
      return;
    }
    await ref.delete();
    res.status(204).send();
  } catch (err) {
    logger.error('DELETE /admin/drafts/:id', err);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});

export default router;
