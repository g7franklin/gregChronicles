import { getFirestore } from '../db/firestore.js';
import { COLLECTIONS } from '../db/firestore.js';
import { getWeekKey, getMostRecentSunday } from '../lib/weekKey.js';
import { renderUserPrompt, type PromptContext } from '../lib/promptTemplate.js';
import { markdownBoldToHtml } from '../lib/emailFormat.js';
import { getApiBaseUrl } from '../config.js';
import { generateNewsletterDraft, type LlmProvider, DEFAULT_PROVIDER } from '../llm/index.js';
import { logger } from '../lib/logger.js';

interface MemoForContext {
  id: string;
  createdAt: string;
  transcript: string;
  title?: string;
  attachmentSummary?: string;
  attachments: Array<{
    id: string;
    type: string;
    originalName: string;
    contentType: string;
    sizeBytes: number;
    signedUrl?: string;
  }>;
}

export async function runGenerateWeeklyDraft(
  provider: LlmProvider = DEFAULT_PROVIDER,
  options?: { startDate?: Date; endDate?: Date },
): Promise<{ draftId: string }> {
  const db = getFirestore();
  const now = new Date();
  const weekKey = getWeekKey(now);
  const startDate = options?.startDate ?? getMostRecentSunday(now);
  const endDate = options?.endDate ?? now;

  const activePromptSnap = await db
    .collection(COLLECTIONS.PROMPT_VERSIONS)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  const systemPrompt = activePromptSnap.empty
    ? (await import('../lib/defaultPrompt.js')).DEFAULT_SYSTEM_PROMPT
    : activePromptSnap.docs[0].data().systemPrompt;
  const userPromptTemplate = activePromptSnap.empty
    ? (await import('../lib/defaultPrompt.js')).DEFAULT_USER_PROMPT_TEMPLATE
    : activePromptSnap.docs[0].data().userPromptTemplate;
  const usedPromptVersionId = activePromptSnap.empty ? null : activePromptSnap.docs[0].id;

  const memosSnap = await db
    .collection(COLLECTIONS.MEMOS)
    .where('createdAt', '>=', startDate)
    .where('createdAt', '<=', endDate)
    .orderBy('createdAt', 'asc')
    .get();

  const apiBase = getApiBaseUrl().replace(/\/$/, '');
  const memosWithUrls: MemoForContext[] = [];
  for (const doc of memosSnap.docs) {
    const data = doc.data();
    const attachments = (data.attachments ?? []) as Array<{
      id: string;
      type: string;
      originalName: string;
      gcsPath: string;
      contentType: string;
      sizeBytes: number;
    }>;
    memosWithUrls.push({
      id: doc.id,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? '',
      transcript: data.transcript ?? '',
      title: data.title,
      attachmentSummary: data.attachmentSummary,
      attachments: attachments.map((a) => ({
        id: a.id,
        type: a.type,
        originalName: a.originalName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        signedUrl: `${apiBase}/media/${a.gcsPath}`,
      })),
    });
  }

  const newslettersSnap = await db
    .collection(COLLECTIONS.NEWSLETTERS)
    .orderBy('sentAt', 'desc')
    .limit(5)
    .get();

  const contextNewsletters = newslettersSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      weekKey: data.weekKey,
      sentAt: data.sentAt?.toDate?.()?.toISOString?.() ?? '',
      subject: data.subject,
      bodyMarkdown: data.bodyMarkdown,
    };
  });

  const weekRange = `${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`;
  const sendDate = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const context: PromptContext = {
    weekRange,
    sendDate,
    memosJson: JSON.stringify(memosWithUrls, null, 2),
    contextNewslettersJson: JSON.stringify(contextNewsletters, null, 2),
  };
  const userPrompt = renderUserPrompt(userPromptTemplate, context);

  const raw = await generateNewsletterDraft({ systemPrompt, userPrompt }, provider);
  let bodyMarkdown = raw;
  try {
    const parsed = JSON.parse(raw) as { subject?: string; bodyMarkdown?: string };
    if (parsed.bodyMarkdown) bodyMarkdown = parsed.bodyMarkdown;
  } catch {
    logger.warn('LLM response was not JSON, using raw as body');
  }
  // Normalize **bold** to <strong> so it renders in email and admin
  bodyMarkdown = markdownBoldToHtml(bodyMarkdown);
  const subject = `The Greg Chronicle — ${sendDate}`;

  const approvedSnap = await db
    .collection(COLLECTIONS.DRAFTS)
    .where('weekKey', '==', weekKey)
    .where('status', '==', 'approved')
    .get()
    .catch(async () => {
      const all = await db.collection(COLLECTIONS.DRAFTS).where('weekKey', '==', weekKey).get();
      return { docs: all.docs.filter((d) => d.data().status === 'approved') };
    });
  if (approvedSnap.docs.length > 0) {
    const batch = db.batch();
    for (const doc of approvedSnap.docs) {
      batch.update(doc.ref, { status: 'pending_approval', approvedAt: null });
    }
    await batch.commit();
    logger.info('Reverted approved drafts to pending_approval', {
      weekKey,
      count: approvedSnap.docs.length,
    });
  }

  const draftRef = await db.collection(COLLECTIONS.DRAFTS).add({
    weekKey,
    status: 'pending_approval',
    generatedAt: now,
    approvedAt: null,
    sentAt: null,
    subject,
    bodyMarkdown,
    bodyHtml: null,
    memoIds: memosSnap.docs.map((d) => d.id),
    contextNewsletterIds: contextNewsletters.map((c) => c.id),
    usedPromptVersionId,
  });

  logger.info('Weekly draft generated', { draftId: draftRef.id, weekKey });
  return { draftId: draftRef.id };
}
