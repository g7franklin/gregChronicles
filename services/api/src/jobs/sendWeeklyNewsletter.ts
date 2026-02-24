import { getFirestore } from '../db/firestore.js';
import { COLLECTIONS } from '../db/firestore.js';
import type { Firestore } from '@google-cloud/firestore';
import { logger } from '../lib/logger.js';
import { getApiBaseUrl } from '../config.js';
import { createUnsubscribeToken } from '../lib/unsubscribeToken.js';
import { replaceGcsUrlsWithMediaProxy } from '../lib/mediaUrls.js';
import { getWeekKey } from '../lib/weekKey.js';

async function getSecret(name: string): Promise<string> {
  if (process.env.NODE_ENV !== 'production') {
    const key = name.replace(/-/g, '_').toUpperCase();
    const val = process.env[key];
    if (val) return val;
  }
  const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
  const client = new SecretManagerServiceClient();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT;
  const [version] = await client.accessSecretVersion({
    name: `projects/${projectId}/secrets/${name}/versions/latest`,
  });
  const payload = version.payload?.data;
  if (!payload) throw new Error(`Secret ${name} empty`);
  return typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Send a specific draft by ID (used by Sunday job and manual send-now). */
export async function sendDraftById(
  draftId: string,
  db?: Firestore
): Promise<{ sent: boolean; reason?: string; publicSlug?: string }> {
  const firestore = db ?? getFirestore();
  const draftRef = firestore.collection(COLLECTIONS.DRAFTS).doc(draftId);
  const draftSnap = await draftRef.get();
  if (!draftSnap.exists) {
    return { sent: false, reason: 'Draft not found' };
  }
  const draft = draftSnap.data()!;
  if (draft.sentAt) {
    return { sent: false, reason: 'Draft already sent' };
  }

  const subsSnap = await firestore
    .collection(COLLECTIONS.SUBSCRIBERS)
    .where('status', '==', 'active')
    .get();

  const sendGridKey = await getSecret('SENDGRID_API_KEY').catch(() => '');
  const twilioAccountSid = await getSecret('TWILIO_ACCOUNT_SID').catch(() => '');
  const twilioAuthToken = await getSecret('TWILIO_AUTH_TOKEN').catch(() => '');
  const twilioFrom = process.env.TWILIO_FROM ?? '';

  const baseUrl = getApiBaseUrl();
  const publicSlug = `${draft.weekKey}-${slugify((draft.subject ?? 'newsletter').slice(0, 30))}`;
  const archiveUrl = `${baseUrl.replace(/\/$/, '')}/n/${publicSlug}`;

  let bodyHtml = draft.bodyHtml;
  if (!bodyHtml && draft.bodyMarkdown) {
    const looksLikeHtml = /^\s*</.test(draft.bodyMarkdown) || draft.bodyMarkdown.includes('<div') || draft.bodyMarkdown.includes('<p ');
    if (looksLikeHtml) {
      bodyHtml = draft.bodyMarkdown;
    } else {
      const { marked } = await import('marked');
      bodyHtml = (await marked.parse(draft.bodyMarkdown)) as string;
    }
  }
  if (!bodyHtml) bodyHtml = '<p>No content.</p>';

  bodyHtml = replaceGcsUrlsWithMediaProxy(bodyHtml);

  if (sendGridKey && subsSnap.docs.length > 0) {
    const sg = (await import('@sendgrid/mail')).default;
    sg.setApiKey(sendGridKey);
    const from = process.env.SENDGRID_FROM ?? 'newsletter@example.com';
    const fromName = process.env.SENDGRID_FROM_NAME ?? "The Greg Chronicle";
    const publicBase = process.env.PUBLIC_WEB_URL ?? baseUrl;
    for (const subDoc of subsSnap.docs) {
      const sub = subDoc.data();
      const email = sub.email;
      if (!email) continue;
      const unsubToken = createUnsubscribeToken(subDoc.id);
      const unsubUrl = `${publicBase.replace(/\/$/, '')}/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
      try {
        await sg.send({
          to: email,
          from: { email: from, name: fromName },
          subject: draft.subject ?? 'Weekly Newsletter',
          html: bodyHtml + `<p><a href="${archiveUrl}">View in browser</a></p><p><a href="${unsubUrl}">Unsubscribe</a></p>`,
        });
      } catch (err) {
        logger.error('SendGrid send failed', err, { email });
      }
    }
  }

  if (twilioAccountSid && twilioAuthToken && twilioFrom) {
    const twilio = (await import('twilio')).default;
    const client = twilio(twilioAccountSid, twilioAuthToken);
    for (const subDoc of subsSnap.docs) {
      const sub = subDoc.data();
      if (!sub.smsConsent || !sub.phone) continue;
      try {
        await client.messages.create({
          body: `${draft.subject ?? 'Weekly Newsletter'}\n${archiveUrl}`,
          from: twilioFrom,
          to: sub.phone,
        });
      } catch (err) {
        logger.error('Twilio send failed', err, { phone: sub.phone });
      }
    }
  }

  const now = new Date();
  await draftRef.update({ status: 'sent', sentAt: now });

  await firestore.collection(COLLECTIONS.NEWSLETTERS).add({
    weekKey: draft.weekKey,
    sentAt: now,
    subject: draft.subject,
    bodyMarkdown: draft.bodyMarkdown,
    bodyHtml,
    publicSlug,
    sourceDraftId: draftRef.id,
  });

  logger.info('Newsletter sent', { draftId: draftRef.id, publicSlug, subscriberCount: subsSnap.size });
  return { sent: true, publicSlug };
}

const OWNER_PHONE = '+13125906400';

async function sendOwnerSmsNotification(message: string): Promise<void> {
  try {
    const twilioAccountSid = await getSecret('TWILIO_ACCOUNT_SID').catch(() => '');
    const twilioAuthToken = await getSecret('TWILIO_AUTH_TOKEN').catch(() => '');
    const twilioFrom = process.env.TWILIO_FROM ?? '';
    if (!twilioAccountSid || !twilioAuthToken || !twilioFrom) {
      logger.warn('Cannot send owner SMS — Twilio not configured');
      return;
    }
    const twilio = (await import('twilio')).default;
    const client = twilio(twilioAccountSid, twilioAuthToken);
    await client.messages.create({
      body: message,
      from: twilioFrom,
      to: OWNER_PHONE,
    });
    logger.info('Owner SMS notification sent', { to: OWNER_PHONE });
  } catch (err) {
    logger.error('Failed to send owner SMS notification', err);
  }
}

/**
 * Sunday job: send the approved draft for THIS week only.
 *
 * STRICT RULE: Only a draft whose weekKey matches the current week AND whose
 * status is 'approved' will be sent. If no such draft exists, the newsletter
 * is NOT sent, and an SMS is sent to the owner instead.
 */
export async function runSendWeeklyNewsletter(): Promise<{ sent: boolean; reason?: string }> {
  const db = getFirestore();
  const currentWeekKey = getWeekKey(new Date());

  let draftSnap;
  try {
    draftSnap = await db
      .collection(COLLECTIONS.DRAFTS)
      .where('weekKey', '==', currentWeekKey)
      .where('status', '==', 'approved')
      .orderBy('generatedAt', 'desc')
      .limit(1)
      .get();
  } catch (indexErr) {
    logger.warn('Composite index query failed, falling back to manual filter', { error: String(indexErr) });
    const fallbackSnap = await db
      .collection(COLLECTIONS.DRAFTS)
      .where('weekKey', '==', currentWeekKey)
      .orderBy('generatedAt', 'desc')
      .limit(50)
      .get();
    const approvedDoc = fallbackSnap.docs.find((d) => d.data().status === 'approved');
    if (approvedDoc) {
      return sendDraftById(approvedDoc.id, db);
    }
    draftSnap = { empty: true, docs: [] } as unknown as typeof fallbackSnap;
  }

  if (draftSnap.empty) {
    const reason = `No approved draft for week ${currentWeekKey}. Newsletter was NOT sent.`;
    logger.info(reason);
    await sendOwnerSmsNotification(
      `Greg Chronicle: The newsletter was not sent this week (${currentWeekKey}) because there was no approved draft. Log in to approve one if you still want to send.`
    );
    return { sent: false, reason };
  }

  return sendDraftById(draftSnap.docs[0].id, db);
}
