import crypto from 'crypto';

/** SHA-256 hash of a token (e.g. for storing unsubscribe token hashes). */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
