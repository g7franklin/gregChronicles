import type { QueryDocumentSnapshot } from '@google-cloud/firestore';

/**
 * Prefer Firestore orderBy(createdAt desc); if empty or query fails, pick best of up to `scanLimit` docs
 * (covers legacy documents missing createdAt).
 */
export async function getLatestPromptVersionDoc(
  getOrdered: () => Promise<QueryDocumentSnapshot[]>,
  scanCollection: () => Promise<QueryDocumentSnapshot[]>,
): Promise<QueryDocumentSnapshot | null> {
  try {
    const ordered = await getOrdered();
    if (ordered.length > 0) return ordered[0];
  } catch {
    // missing index or other query error — fall through to scan
  }
  const all = await scanCollection();
  if (all.length === 0) return null;
  const ranked = all.map((d) => {
    const created = d.data().createdAt as { toDate?: () => Date } | undefined;
    const t = created?.toDate?.()?.getTime() ?? 0;
    return { d, t };
  });
  ranked.sort((a, b) => b.t - a.t || b.d.id.localeCompare(a.d.id));
  return ranked[0].d;
}
