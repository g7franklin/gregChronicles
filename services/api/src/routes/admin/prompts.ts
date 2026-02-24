import { Router, Response } from 'express';
import { z } from 'zod';
import { getFirestore } from '../../db/firestore.js';
import { COLLECTIONS } from '../../db/firestore.js';
import { AuthRequest } from '../../middleware/auth.js';
import { logger } from '../../lib/logger.js';
import { getPlaceholders } from '../../lib/promptTemplate.js';
import { renderUserPrompt } from '../../lib/promptTemplate.js';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT_TEMPLATE } from '../../lib/defaultPrompt.js';
import { generateNewsletterDraft } from '../../llm/grokClient.js';

const router = Router();

const createSchema = z.object({
  systemPrompt: z.string(),
  notes: z.string().optional(),
});

const testSchema = z.object({
  systemPrompt: z.string(),
});

const FAKE_MEMOS_JSON = JSON.stringify(
  [
    {
      id: 'm1',
      createdAt: '2026-02-18T10:00:00.000Z',
      transcript: 'Had a great morning run around the lake. Saw three deer. Weather was perfect. Took a photo of the sunrise over the water and a short video of the deer.',
      title: 'Morning run',
      attachmentSummary: 'Photo and video from lake run',
      attachments: [
        {
          id: 'att1',
          type: 'image',
          originalName: 'lake-sunrise.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 245000,
          signedUrl: 'https://picsum.photos/id/10/400/300',
        },
        {
          id: 'att1b',
          type: 'video',
          originalName: 'deer-at-lake.mp4',
          contentType: 'video/mp4',
          sizeBytes: 1250000,
          signedUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
        },
      ],
    },
    {
      id: 'm2',
      createdAt: '2026-02-20T14:30:00.000Z',
      transcript: 'Finally finished that book I was reading. The ending was unexpected but satisfying.',
      title: 'Book finished',
      attachmentSummary: null,
      attachments: [],
    },
    {
      id: 'm3',
      createdAt: '2026-02-21T09:15:00.000Z',
      transcript: 'Tried a new recipe for dinner—spicy Thai noodles. Everyone loved it. Here is a pic of the final dish.',
      title: 'Dinner success',
      attachmentSummary: 'Photo of Thai noodles',
      attachments: [
        {
          id: 'att2',
          type: 'image',
          originalName: 'thai-noodles.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 312000,
          signedUrl: 'https://picsum.photos/id/292/400/300',
        },
      ],
    },
    {
      id: 'm4',
      createdAt: '2026-02-22T16:00:00.000Z',
      transcript: 'Went for a hike at the state park. Trail was muddy but the views from the summit were worth it. Recorded a quick video of the panorama.',
      title: 'Weekend hike',
      attachmentSummary: 'Photo and video from trail summit',
      attachments: [
        {
          id: 'att3',
          type: 'image',
          originalName: 'hike-summit.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 189000,
          signedUrl: 'https://picsum.photos/id/11/400/300',
        },
        {
          id: 'att3b',
          type: 'video',
          originalName: 'summit-panorama.mp4',
          contentType: 'video/mp4',
          sizeBytes: 2100000,
          signedUrl: 'https://www.w3schools.com/html/movie.mp4',
        },
      ],
    },
  ],
  null,
  2
);

const FAKE_NEWSLETTERS_JSON = JSON.stringify(
  [
    { id: 'n1', subject: 'Last Week in Review', bodyMarkdown: 'A quiet week with some good reading...' },
    { id: 'n2', subject: 'Catching Up', bodyMarkdown: 'Work was busy but managed to squeeze in a hike...' },
  ],
  null,
  2
);

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
    const batch = getFirestore().batch();
    const activeSnap = await getFirestore()
      .collection(COLLECTIONS.PROMPT_VERSIONS)
      .where('isActive', '==', true)
      .get();
    activeSnap.docs.forEach((d) => {
      batch.update(d.ref, { isActive: false });
    });
    const newRef = getFirestore().collection(COLLECTIONS.PROMPT_VERSIONS).doc();
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
    const ref = getFirestore().collection(COLLECTIONS.PROMPT_VERSIONS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Prompt version not found' });
      return;
    }
    const batch = getFirestore().batch();
    const activeSnap = await getFirestore()
      .collection(COLLECTIONS.PROMPT_VERSIONS)
      .where('isActive', '==', true)
      .get();
    activeSnap.docs.forEach((d) => batch.update(d.ref, { isActive: false }));
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
    const batch = getFirestore().batch();
    const activeSnap = await getFirestore()
      .collection(COLLECTIONS.PROMPT_VERSIONS)
      .where('isActive', '==', true)
      .get();
    activeSnap.docs.forEach((d) => batch.update(d.ref, { isActive: false }));
    const newRef = getFirestore().collection(COLLECTIONS.PROMPT_VERSIONS).doc();
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
      memosJson: FAKE_MEMOS_JSON,
      contextNewslettersJson: FAKE_NEWSLETTERS_JSON,
      styleGuidelines: '',
    });
    const raw = await generateNewsletterDraft({
      systemPrompt: parsed.data.systemPrompt,
      userPrompt,
    });
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
      bodyHtml = bodyMarkdown;
    } else {
      try {
        const { marked } = await import('marked');
        bodyHtml = (await marked.parse(bodyMarkdown)) as string;
      } catch {
        bodyHtml = bodyMarkdown;
      }
    }
    res.json({ raw, subject, bodyMarkdown, bodyHtml });
  } catch (err) {
    logger.error('POST /admin/prompts/test', err);
    res.status(500).json({
      error: 'Test failed',
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
