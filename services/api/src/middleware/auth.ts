import { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { getFirestore } from '../db/firestore.js';
import { COLLECTIONS } from '../db/firestore.js';
import { logger } from '../lib/logger.js';

export interface AuthRequest extends Request {
  uid?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    logger.warn('Auth failed', { error: String(err) });
    res.status(401).json({ error: 'Invalid token' });
  }
}

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.uid) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const db = getFirestore();
  const adminDoc = await db.collection(COLLECTIONS.ADMIN_USERS).doc(req.uid).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
