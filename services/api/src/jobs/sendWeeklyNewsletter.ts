import { getFirestore } from '../db/firestore.js';
import { COLLECTIONS } from '../db/firestore.js';
import { logger } from '../lib/logger.js';
import { getApiBaseUrl } from '../config.js';
import { createUnsubscribeToken } from '../lib/unsubscribeToken.js';

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

export async function runSendWeeklyNewsletter(): Promise<{ sent: boolean; reason?: string }> {
  const db = getFirestore();

  const draftSnap = await db
    .collection(COLLECTIONS.DRAFTS)
    .where('status', '==', 'approved')
    .orderBy('generatedAt', 'desc')
    .limit(1)
    .get();

  if (draftSnap.empty) {
    logger.info('No approved draft to send');
    return { sent: false, reason: 'No approved draft' };
  }

  const draftDoc = draftSnap.docs[0];
  const draft = draftDoc.data();
  if (draft.sentAt) {
    return { sent: false, reason: 'Draft already sent' };
  }

  const subsSnap = await db
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
  if (!bodyHtml) bodyHtml = '<p>No content.</p>';

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
  await draftDoc.ref.update({ status: 'sent', sentAt: now });

  await db.collection(COLLECTIONS.NEWSLETTERS).add({
    weekKey: draft.weekKey,
    sentAt: now,
    subject: draft.subject,
    bodyMarkdown: draft.bodyMarkdown,
    bodyHtml,
    publicSlug,
    sourceDraftId: draftDoc.id,
  });

  logger.info('Newsletter sent', { draftId: draftDoc.id, publicSlug, subscriberCount: subsSnap.size });
  return { sent: true };
}
