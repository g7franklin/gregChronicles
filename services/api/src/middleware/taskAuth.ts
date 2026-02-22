import { Request, Response, NextFunction } from 'express';
import { getTaskSecret } from '../config.js';

const HEADER = 'x-task-secret';

export function requireTaskSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers[HEADER];
  const expected = getTaskSecret();
  if (secret !== expected) {
    res.status(403).json({ error: 'Invalid task secret' });
    return;
  }
  next();
}
