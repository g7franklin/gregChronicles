import { describe, it, expect } from 'vitest';

/**
 * Draft approval gating logic:
 * - Sunday job only sends if there is an approved draft that has not been sent.
 * - If status is 'sent', do not send again.
 * - If status is 'pending_approval', do not send (not approved).
 */
describe('draft approval gating', () => {
  it('should send only when status is approved and sentAt is null', () => {
    const shouldSend = (status: string, sentAt: unknown) =>
      status === 'approved' && (sentAt == null || sentAt === undefined);

    expect(shouldSend('approved', null)).toBe(true);
    expect(shouldSend('approved', undefined)).toBe(true);
    expect(shouldSend('pending_approval', null)).toBe(false);
    expect(shouldSend('approved', new Date())).toBe(false);
    expect(shouldSend('sent', null)).toBe(false);
  });
});
