import { Router, Response } from 'express';
import { requireTaskSecret } from '../middleware/taskAuth.js';
import { runGenerateWeeklyDraft } from '../jobs/generateWeeklyDraft.js';
import { runSendWeeklyNewsletter } from '../jobs/sendWeeklyNewsletter.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.use(requireTaskSecret);

router.post('/generateWeeklyDraft', async (_req, res: Response) => {
  try {
    const { draftId } = await runGenerateWeeklyDraft();
    res.json({ ok: true, draftId });
  } catch (err) {
    logger.error('Task generateWeeklyDraft failed', err);
    res.status(500).json({ error: 'Draft generation failed' });
  }
});

router.post('/sendWeeklyNewsletter', async (_req, res: Response) => {
  try {
    const result = await runSendWeeklyNewsletter();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('Task sendWeeklyNewsletter failed', err);
    res.status(500).json({ error: 'Send failed' });
  }
});

export default router;
