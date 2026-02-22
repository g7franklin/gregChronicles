import { describe, it, expect } from 'vitest';
import { getWeekKey, getSevenDaysAgo } from '../weekKey.js';

describe('getWeekKey', () => {
  it('returns ISO week format YYYY-Wnn', () => {
    const key = getWeekKey(new Date(2026, 1, 22)); // Feb 22, 2026 local
    expect(key).toMatch(/^\d{4}-W\d{2}$/);
    expect(key).toBe('2026-W08');
  });

  it('is consistent for same week', () => {
    const key1 = getWeekKey(new Date(2026, 1, 16)); // Mon Feb 16
    const key2 = getWeekKey(new Date(2026, 1, 22)); // Sun Feb 22
    expect(key1).toBe(key2);
  });
});

describe('getSevenDaysAgo', () => {
  it('returns date 7 days before', () => {
    const d = new Date('2026-02-22T12:00:00Z');
    const past = getSevenDaysAgo(d);
    expect(past.toISOString().slice(0, 10)).toBe('2026-02-15');
  });
});
