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
