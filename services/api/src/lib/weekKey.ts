/**
 * Returns ISO week key string (e.g. "2026-W08") for a given date.
 */
export function getWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const year = d.getFullYear();
  const weekStr = String(weekNo).padStart(2, '0');
  return `${year}-W${weekStr}`;
}

/**
 * Returns the Saturday of the week for the given date (week ends Saturday).
 */
export function getWeekSaturday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const satOffset = day === 6 ? 0 : (6 - day);
  d.setDate(d.getDate() + satOffset);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Returns start of the 7-day window ending at the given date (for "last 7 days" memos).
 */
export function getSevenDaysAgo(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the most recent Sunday at 00:00:00 (start of the current week).
 * If today IS Sunday, returns today at midnight.
 */
export function getMostRecentSunday(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the Sunday of the given ISO week (e.g. "2026-W08").
 * Used for "planned send date" — newsletter sends Sunday at 6 AM for that week.
 */
export function getSundayOfWeekKey(weekKey: string): Date | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay();
  const mondayWeek1Offset = (dayOfWeek + 6) % 7;
  const mondayWeek1 = new Date(year, 0, 4 - mondayWeek1Offset);
  const sunday = new Date(mondayWeek1);
  sunday.setDate(sunday.getDate() + (week - 1) * 7 + 6);
  sunday.setHours(6, 0, 0, 0);
  return sunday;
}
