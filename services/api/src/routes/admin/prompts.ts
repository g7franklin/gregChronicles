import { Router, Response } from 'express';
import { z } from 'zod';
import { getFirestore } from '../../db/firestore.js';
import { COLLECTIONS } from '../../db/firestore.js';
import { AuthRequest } from '../../middleware/auth.js';
import { logger } from '../../lib/logger.js';
import { getPlaceholders } from '../../lib/promptTemplate.js';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT_TEMPLATE } from '../../lib/defaultPrompt.js';

const router = Router();

const createSchema = z.object({
  systemPrompt: z.string(),
  userPromptTemplate: z.string(),
  notes: z.string().optional(),
});

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
      userPromptTemplate: parsed.data.userPromptTemplate,
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

export default router;
