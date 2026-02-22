import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initFirebaseAdmin } from './db/firebaseAdmin.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import memosRouter from './routes/admin/memos.js';
import subscribersRouter from './routes/admin/subscribers.js';
import draftsRouter from './routes/admin/drafts.js';
import promptsRouter from './routes/admin/prompts.js';
import publicRouter from './routes/public.js';
import tasksRouter from './routes/tasks.js';
import { logger } from './lib/logger.js';

initFirebaseAdmin();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/admin/memos', requireAuth, requireAdmin, memosRouter);
app.use('/admin/subscribers', requireAuth, requireAdmin, subscribersRouter);
app.use('/admin/drafts', requireAuth, requireAdmin, draftsRouter);
app.use('/admin/prompts', requireAuth, requireAdmin, promptsRouter);
app.use('/public', publicRouter);
app.use('/tasks', tasksRouter);

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  logger.info('API listening', { port });
});
