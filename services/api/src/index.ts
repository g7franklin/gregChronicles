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
import mediaRouter from './routes/media.js';
import { logger, toErrorMessage } from './lib/logger.js';
import { getProjectId } from './config.js';
import { getFirestore } from './db/firestore.js';
import { COLLECTIONS } from './db/firestore.js';
import { getBucket } from './storage/gcs.js';

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', err);
});

initFirebaseAdmin();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Diagnostic: which project we use and whether Firestore/GCS are reachable
app.get('/health/db', async (_req, res) => {
  const projectId = getProjectId();
  const result: { projectId: string; firestore: string; gcs: string } = {
    projectId: projectId || '(not set)',
    firestore: 'unknown',
    gcs: 'unknown',
  };
  try {
    const db = getFirestore();
    await db.collection(COLLECTIONS.ADMIN_USERS).limit(1).get();
    result.firestore = 'ok';
  } catch (e) {
    result.firestore = e instanceof Error ? e.message : String(e);
  }
  try {
    const bucket = getBucket();
    await bucket.exists();
    result.gcs = 'ok';
  } catch (e) {
    result.gcs = e instanceof Error ? e.message : String(e);
  }
  res.json(result);
});

app.use('/admin/memos', requireAuth, requireAdmin, memosRouter);
app.use('/admin/subscribers', requireAuth, requireAdmin, subscribersRouter);
app.use('/admin/drafts', requireAuth, requireAdmin, draftsRouter);
app.use('/admin/prompts', requireAuth, requireAdmin, promptsRouter);
app.use('/public', publicRouter);
app.use('/tasks', tasksRouter);
app.use('/media', mediaRouter);

// Global error handler so uncaught errors (e.g. multer) return JSON with details
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  if (res.headersSent) return;
  const message = toErrorMessage(err);
  try {
    res.status(500).json({
      error: 'Internal Server Error',
      details: message,
    });
  } catch (e) {
    logger.error('Error handler failed', e);
  }
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  logger.info('API listening', { port });
});
