import type { Firestore, WriteBatch } from '@google-cloud/firestore';
import { Router, Response } from 'express';
import { z } from 'zod';
import { getFirestore, COLLECTIONS } from '../../db/firestore.js';
import { AuthRequest } from '../../middleware/auth.js';
import { logger, toErrorMessage } from '../../lib/logger.js';
import { getPlaceholders, renderUserPrompt } from '../../lib/promptTemplate.js';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT_TEMPLATE } from '../../lib/defaultPrompt.js';
import { markdownBoldToHtml } from '../../lib/emailFormat.js';
import { FAKE_MEMOS_JSON, FAKE_NEWSLETTERS_JSON } from '../../lib/promptTestFixtures.js';
import { generateNewsletterDraft, isValidProvider, type LlmProvider, DEFAULT_PROVIDER } from '../../llm/index.js';

const router: ReturnType<typeof Router> = Router();

const createSchema = z.object({
  systemPrompt: z.string(),
  notes: z.string().optional(),
});

const testSchema = z.object({
  systemPrompt: z.string(),
  provider: z.enum(['claude', 'grok']).optional(),
});

async function deactivateActivePromptsInBatch(db: Firestore, batch: WriteBatch): Promise<void> {
  const activeSnap = await db.collection(COLLECTIONS.PROMPT_VERSIONS).where('isActive', '==', true).get();
  activeSnap.docs.forEach((d) => batch.update(d.ref, { isActive: false }));
}

router.get('/active', async (_req: AuthRequest, res: Response) => {
  try {
    const snap = await getFirestore()
      .collection(COLLECTIONS.PROMPT_VERSIONS)
      .where('isActive', '==', true)
      .limit(1)
      .get();
    if (snap.empty) {
      res.json({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
        id: null,
        isDefault: true,
      });
      return;
    }
    const doc = snap.docs[0];
    const data = doc.data();
    res.json({
      id: doc.id,
      systemPrompt: data.systemPrompt,
      userPromptTemplate: data.userPromptTemplate,
      notes: data.notes,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.(),
      isDefault: false,
    });
  } catch (err) {
    logger.error('GET /admin/prompts/active', err);
    res.status(500).json({ error: 'Failed to get active prompt' });
  }
});

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const snap = await getFirestore()
      .collection(COLLECTIONS.PROMPT_VERSIONS)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    const versions = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        isActive: data.isActive,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.(),
        createdByUid: data.createdByUid,
        notes: data.notes,
      };
    });
    res.json({ versions });
  } catch (err) {
    logger.error('GET /admin/prompts', err);
    res.status(500).json({ error: 'Failed to list prompts' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.uid!;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }
    const db = getFirestore();
    const batch = db.batch();
    await deactivateActivePromptsInBatch(db, batch);
    const newRef = db.collection(COLLECTIONS.PROMPT_VERSIONS).doc();
    batch.set(newRef, {
      systemPrompt: parsed.data.systemPrompt,
      userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
      notes: parsed.data.notes ?? '',
      isActive: true,
      createdAt: new Date(),
      createdByUid: uid,
    });
    await batch.commit();
    const created = await newRef.get();
    res.status(201).json({ id: created.id, ...created.data() });
  } catch (err) {
    logger.error('POST /admin/prompts', err);
    res.status(500).json({ error: 'Failed to create prompt' });
  }
});

router.post('/:id/activate', async (req: AuthRequest, res: Response) => {
  try {
    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.PROMPT_VERSIONS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Prompt version not found' });
      return;
    }
    const batch = db.batch();
    await deactivateActivePromptsInBatch(db, batch);
    batch.update(ref, { isActive: true });
    await batch.commit();
    const updated = await ref.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    logger.error('POST /admin/prompts/:id/activate', err);
    res.status(500).json({ error: 'Failed to activate prompt' });
  }
});

router.post('/reset-default', async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.uid!;
    const db = getFirestore();
    const batch = db.batch();
    await deactivateActivePromptsInBatch(db, batch);
    const newRef = db.collection(COLLECTIONS.PROMPT_VERSIONS).doc();
    batch.set(newRef, {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
      notes: 'Default prompt (reset)',
      isActive: true,
      createdAt: new Date(),
      createdByUid: uid,
    });
    await batch.commit();
    const created = await newRef.get();
    res.status(201).json({ id: created.id, ...created.data() });
  } catch (err) {
    logger.error('POST /admin/prompts/reset-default', err);
    res.status(500).json({ error: 'Failed to reset prompt' });
  }
});

router.get('/placeholders', async (_req: AuthRequest, res: Response) => {
  res.json({ placeholders: getPlaceholders() });
});

router.post('/test', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = testSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }
    const userPrompt = renderUserPrompt(DEFAULT_USER_PROMPT_TEMPLATE, {
      weekRange: '2026-02-15 to 2026-02-22',
      sendDate: 'Sunday, February 23, 2026',
      memosJson: FAKE_MEMOS_JSON,
      contextNewslettersJson: FAKE_NEWSLETTERS_JSON,
      styleGuidelines: '',
    });
    const testProvider: LlmProvider = parsed.data.provider ?? DEFAULT_PROVIDER;
    const raw = await generateNewsletterDraft(
      {
        systemPrompt: parsed.data.systemPrompt,
        userPrompt,
      },
      testProvider,
    );
    let subject: string | null = null;
    let bodyMarkdown = raw;
    try {
      const parsedJson = JSON.parse(raw) as { subject?: string; bodyMarkdown?: string };
      subject = parsedJson.subject ?? null;
      bodyMarkdown = parsedJson.bodyMarkdown ?? raw;
    } catch {
      // raw is not JSON, use as-is
    }
    let bodyHtml: string;
    const looksLikeHtml = /^\s*</.test(bodyMarkdown) || bodyMarkdown.includes('<div') || bodyMarkdown.includes('<p ');
    if (looksLikeHtml) {
      bodyHtml = markdownBoldToHtml(bodyMarkdown);
    } else {
      try {
        const { marked } = await import('marked');
        bodyHtml = markdownBoldToHtml((await marked.parse(bodyMarkdown)) as string);
      } catch {
        bodyHtml = markdownBoldToHtml(bodyMarkdown);
      }
    }
    res.json({ raw, subject, bodyMarkdown, bodyHtml });
  } catch (err) {
    logger.error('POST /admin/prompts/test', err);
    res.status(500).json({
      error: 'Test failed',
      details: toErrorMessage(err),
    });
  }
});

export default router;
