import { Router, Response } from 'express';
import { z } from 'zod';
import { getFirestore, COLLECTIONS } from '../../db/firestore.js';
import { AuthRequest } from '../../middleware/auth.js';
import { logger, toErrorMessage } from '../../lib/logger.js';
import { getWeekKey } from '../../lib/weekKey.js';

const router: ReturnType<typeof Router> = Router();

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type DayKey = (typeof DAY_KEYS)[number];

const daysSchema = z.object({
  mon: z.boolean(),
  tue: z.boolean(),
  wed: z.boolean(),
  thu: z.boolean(),
  fri: z.boolean(),
  sat: z.boolean(),
  sun: z.boolean(),
});

const updateSchema = z.object({
  days: daysSchema,
});

type DaysState = Record<DayKey, boolean>;

const DEFAULT_DAYS: DaysState = {
  mon: false,
  tue: false,
  wed: false,
  thu: false,
  fri: false,
  sat: false,
  sun: false,
};

function normalizeDays(input: unknown): DaysState {
  if (!input || typeof input !== 'object') return { ...DEFAULT_DAYS };
  const r = input as Partial<DaysState>;
  return {
    ...DEFAULT_DAYS,
    ...Object.fromEntries(DAY_KEYS.map((k) => [k, typeof r[k] === 'boolean' ? r[k] : DEFAULT_DAYS[k]])),
  };
}

function dayKeyFromDate(date: Date): DayKey {
  // JS: getDay() => 0 (Sun) ... 6 (Sat)
  const d = date.getDay();
  if (d === 0) return 'sun';
  return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d - 1] as DayKey;
}

function getTrackerDocId(uid: string, weekKey: string): string {
  return `${uid}_${weekKey}`;
}

router.get('/current', async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.uid;
    if (!uid) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const weekKey = getWeekKey(new Date());
    const db = getFirestore();

    const ref = db.collection(COLLECTIONS.CAPTURE_TRACKERS).doc(getTrackerDocId(uid, weekKey));
    const snap = await ref.get();
    const storedDays = snap.exists
      ? normalizeDays((snap.data() as { days?: unknown })?.days)
      : { ...DEFAULT_DAYS };

    // Ensure the tracker reflects existing memos for the current week (so old updates are remembered).
    const memoSnap = await db.collection(COLLECTIONS.MEMOS).where('weekKey', '==', weekKey).get();
    const memoDays: DaysState = { ...DEFAULT_DAYS };
    for (const d of memoSnap.docs) {
      const createdAtRaw = d.data()?.createdAt as { toDate?: () => Date } | undefined;
      const createdAt = createdAtRaw?.toDate?.();
      if (!createdAt) continue;
      memoDays[dayKeyFromDate(createdAt)] = true;
    }

    const days: DaysState = { ...storedDays };
    DAY_KEYS.forEach((k) => {
      if (memoDays[k]) days[k] = true;
    });

    res.json({ weekKey, days });
  } catch (err) {
    logger.error('GET /admin/capture-tracker/current', err);
    res.status(500).json({ error: 'Failed to load tracker', details: toErrorMessage(err) });
  }
});

router.patch('/current', async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.uid;
    if (!uid) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const weekKey = getWeekKey(new Date());
    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.CAPTURE_TRACKERS).doc(getTrackerDocId(uid, weekKey));

    await ref.set(
      {
        uid,
        weekKey,
        days: parsed.data.days,
        updatedAt: new Date(),
      },
      { merge: true },
    );

    res.json({ weekKey, days: parsed.data.days });
  } catch (err) {
    logger.error('PATCH /admin/capture-tracker/current', err);
    res.status(500).json({ error: 'Failed to update tracker', details: toErrorMessage(err) });
  }
});

export default router;

