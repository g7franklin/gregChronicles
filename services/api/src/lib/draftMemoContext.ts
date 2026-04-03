import { getFirestore, COLLECTIONS } from '../db/firestore.js';

/** Budget for memo text in draft-chat prompts (draft body + instructions share the rest of the context). */
const MAX_MEMO_CONTEXT_CHARS = 180_000;

type MemoRow = {
  id: string;
  createdAt: string;
  title: string;
  transcript: string;
  attachmentSummary: string;
  attachmentNames: string;
};

function buildRow(id: string, d: Record<string, unknown>): MemoRow {
  const attachments = (d.attachments ?? []) as Array<{ originalName?: string; type?: string }>;
  const attachmentNames = attachments
    .map((a) => `${a.originalName ?? 'file'} (${a.type ?? 'file'})`)
    .join(', ');
  return {
    id,
    createdAt:
      (d.createdAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toISOString?.() ?? '',
    title: typeof d.title === 'string' ? d.title : '',
    transcript: typeof d.transcript === 'string' ? d.transcript : '',
    attachmentSummary: typeof d.attachmentSummary === 'string' ? d.attachmentSummary : '',
    attachmentNames,
  };
}

function headerLines(row: MemoRow): string[] {
  const lines = [`### Memo ${row.id}`, `Recorded: ${row.createdAt || '(unknown)'}`];
  if (row.title) lines.push(`Title: ${row.title}`);
  if (row.attachmentSummary) lines.push(`Attachment summary: ${row.attachmentSummary}`);
  if (row.attachmentNames) lines.push(`Attachments: ${row.attachmentNames}`);
  return lines;
}

function formatOneMemo(row: MemoRow): string {
  return [...headerLines(row), `Transcript:\n${row.transcript || '(empty transcript)'}`].join('\n');
}

/**
 * Build a bounded markdown block of memo source material for the draft editor agent.
 */
function formatMemoRowsToContext(rows: MemoRow[], maxChars: number): string {
  if (rows.length === 0) return '';

  const parts: string[] = [];
  let used = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const full = formatOneMemo(row);
    const remaining = maxChars - used - 120;

    if (full.length <= remaining) {
      parts.push(full);
      used += full.length + 2;
      continue;
    }

    const head = headerLines(row).join('\n');
    const tbudget = Math.max(0, remaining - head.length - 40);
    if (tbudget >= 80) {
      const tr = row.transcript || '(empty transcript)';
      const slice =
        tr.length > tbudget ? `${tr.slice(0, tbudget)}\n[…transcript truncated]` : tr;
      parts.push(`${head}\nTranscript:\n${slice}`);
    }
    const rest = rows.length - i - 1;
    if (rest > 0) {
      parts.push(
        `\n[${rest} further memo(s) not included: context size limit — earlier memos above may be partial.]`,
      );
    }
    break;
  }

  return parts.join('\n\n');
}

/**
 * Load memos for this draft: prefer `memoIds` (same set used when the draft was generated), else
 * memos in `memoRangeStart`–`memoRangeEnd` when those timestamps exist.
 */
export async function loadFormattedMemoContextForDraft(draftData: Record<string, unknown>): Promise<string> {
  const db = getFirestore();
  const rows: MemoRow[] = [];

  const memoIds = ((draftData.memoIds ?? []) as unknown[]).filter((x): x is string => typeof x === 'string');

  if (memoIds.length > 0) {
    const snaps = await Promise.all(memoIds.map((id) => db.collection(COLLECTIONS.MEMOS).doc(id).get()));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      rows.push(buildRow(snap.id, (snap.data() ?? {}) as Record<string, unknown>));
    }
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } else {
    const rs = draftData.memoRangeStart as { toDate?: () => Date } | undefined;
    const re = draftData.memoRangeEnd as { toDate?: () => Date } | undefined;
    const start = rs?.toDate?.();
    const end = re?.toDate?.();
    if (start && end) {
      const memosSnap = await db
        .collection(COLLECTIONS.MEMOS)
        .where('createdAt', '>=', start)
        .where('createdAt', '<=', end)
        .orderBy('createdAt', 'asc')
        .get();
      for (const doc of memosSnap.docs) {
        rows.push(buildRow(doc.id, (doc.data() ?? {}) as Record<string, unknown>));
      }
    }
  }

  return formatMemoRowsToContext(rows, MAX_MEMO_CONTEXT_CHARS);
}
