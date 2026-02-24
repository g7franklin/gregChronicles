import { getFirestore } from '../db/firestore.js';
import { COLLECTIONS } from '../db/firestore.js';
import { getWeekKey, getSevenDaysAgo, getSundayOfWeekKey } from '../lib/weekKey.js';
import { renderUserPrompt, type PromptContext } from '../lib/promptTemplate.js';
import { getSignedUrl } from '../storage/gcs.js';
import { generateNewsletterDraft } from '../llm/grokClient.js';
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

export async function runGenerateWeeklyDraft(): Promise<{ draftId: string }> {
  const db = getFirestore();
  const now = new Date();
  const weekKey = getWeekKey(now);
  const startDate = getSevenDaysAgo(now);

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
    .where('createdAt', '<=', now)
    .orderBy('createdAt', 'asc')
    .get();

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
    // 7 days so images stay loadable in draft preview and in sent newsletters
    const signedUrls = await Promise.all(
      attachments.map((a) => getSignedUrl(a.gcsPath, 60 * 24 * 7).catch(() => undefined))
    );
    memosWithUrls.push({
      id: doc.id,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? '',
      transcript: data.transcript ?? '',
      title: data.title,
      attachmentSummary: data.attachmentSummary,
      attachments: attachments.map((a, i) => ({
        id: a.id,
        type: a.type,
        originalName: a.originalName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        signedUrl: signedUrls[i],
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

  const weekRange = `${startDate.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)}`;
  const sendSunday = getSundayOfWeekKey(weekKey);
  const sendDate = sendSunday
    ? sendSunday.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : weekKey;
  const context: PromptContext = {
    weekRange,
    sendDate,
    memosJson: JSON.stringify(memosWithUrls, null, 2),
    contextNewslettersJson: JSON.stringify(contextNewsletters, null, 2),
  };
  const userPrompt = renderUserPrompt(userPromptTemplate, context);

  const raw = await generateNewsletterDraft({ systemPrompt, userPrompt });
  let bodyMarkdown = raw;
  try {
    const parsed = JSON.parse(raw) as { subject?: string; bodyMarkdown?: string };
    if (parsed.bodyMarkdown) bodyMarkdown = parsed.bodyMarkdown;
  } catch {
    logger.warn('Grok response was not JSON, using raw as body');
  }
  // Always use send date for subject (no "Week of" range)
  const subject = sendDate ? `The Greg Chronicle — ${sendDate}` : 'The Greg Chronicle — Weekly Update';

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
