import crypto from 'crypto';

const SECRET = process.env.UNSUBSCRIBE_SECRET ?? process.env.TASK_SECRET ?? 'change-me';

export function createUnsubscribeToken(subscriberId: string): string {
  const sig = crypto.createHmac('sha256', SECRET).update(subscriberId).digest('base64url');
  return `${subscriberId}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const subId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(subId).digest('base64url');
  if (sig.length !== expected.length) return null;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(sig, 'base64url'),
      Buffer.from(expected, 'base64url')
    )
      ? subId
      : null;
  } catch {
    return null;
  }
}
