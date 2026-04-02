import { getFirestore } from '../db/firestore.js';
import { COLLECTIONS } from '../db/firestore.js';
import type { Firestore } from '@google-cloud/firestore';
import { logger, toErrorMessage } from '../lib/logger.js';
import { getApiBaseUrl } from '../config.js';
import { createUnsubscribeToken } from '../lib/unsubscribeToken.js';
import { replaceGcsUrlsWithMediaProxy } from '../lib/mediaUrls.js';
import { getWeekKey } from '../lib/weekKey.js';
import { htmlToPlainText, wrapHtmlEmail, markdownBoldToHtml } from '../lib/emailFormat.js';

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

function styleNewsletterMedia(html: string): string {
  const mediaTagRe = /(<img\b[^>]*>|<video\b[^>]*>[\s\S]*?<\/video>)/gi;
  const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isFilenameLikeCaption = (value: string): boolean => {
    const v = value.trim();
    if (!v) return true;
    if (/\.(jpe?g|png|gif|webp|heic|heif|mov|mp4|m4v|webm)$/i.test(v)) return true;
    if (/^(img|dsc|pxl|video|vid)[-_ ]?\d+/i.test(v)) return true;
    const withoutPunct = v.replace(/[\s._-]/g, '');
    return withoutPunct.length > 0 && /^[a-z]+\d+$/i.test(withoutPunct);
  };
  const toDescriptiveCaption = (raw: string, mediaType: 'photo' | 'video'): string => {
    const cleaned = raw
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned || isFilenameLikeCaption(raw) || isFilenameLikeCaption(cleaned)) {
      return mediaType === 'video' ? 'Video from this week' : 'Photo from this week';
    }
    return cleaned;
  };
  const altFromImg = (tag: string): string => {
    const m = tag.match(/\salt=["']([^"']*)["']/i);
    return (m?.[1] ?? '').trim();
  };
  let mediaCount = 0;
  const nextFigureStyle = (): string => {
    const align = mediaCount % 2 === 0 ? 'right' : 'left';
    mediaCount++;
    return align === 'right'
      ? 'float:right;clear:right;margin:4px 0 10px 12px;width:170px;max-width:40%;'
      : 'float:left;clear:left;margin:4px 12px 10px 0;width:170px;max-width:40%;';
  };
  const figcaptionStyle = 'margin-top:4px;font-size:11px;line-height:1.3;color:#64748b;font-style:italic;';
  const mediaStyle = 'display:block;width:100%;height:auto;border-radius:4px;';
  const normalizeMediaTag = (tag: string): string => {
    if (tag.toLowerCase().startsWith('<video')) {
      let cleaned = tag
        .replace(/\s*(autoplay|loop)\b/gi, '')
        .replace(/\s*preload=["'][^"']*["']/gi, '')
        .replace(/\sstyle=["'][^"']*["']/gi, '');
      if (!/controls/i.test(cleaned)) cleaned = cleaned.replace('<video', '<video controls');
      if (!/playsinline/i.test(cleaned)) cleaned = cleaned.replace('<video', '<video playsinline');
      return cleaned.replace('<video', `<video preload="auto" style="${mediaStyle}"`);
    }
    return tag.replace(/\sstyle=["'][^"']*["']/gi, '').replace('<img', `<img style="${mediaStyle}"`);
  };
  const renderFigure = (tag: string): string => {
    const figureStyle = nextFigureStyle();
    const caption = escapeHtml(
      toDescriptiveCaption(altFromImg(tag), tag.toLowerCase().startsWith('<video') ? 'video' : 'photo')
    );
    const media = normalizeMediaTag(tag);
    return `<figure style="${figureStyle}">${media}<figcaption style="${figcaptionStyle}">${caption}</figcaption></figure>`;
  };

  const mergeAdjacentCaptionParagraphs = (input: string): string => {
    let out = input;
    const captionMergeRe =
      /<figure\b([^>]*)>([\s\S]*?)<figcaption\b([^>]*)>([\s\S]*?)<\/figcaption>([\s\S]*?)<\/figure>(?:\s*<p\b[^>]*>\s*(?:&nbsp;)?\s*<\/p>)*\s*<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    for (let i = 0; i < 4; i++) {
      out = out.replace(
        captionMergeRe,
        (_m, figAttrs: string, beforeCap: string, capAttrs: string, oldCap: string, afterCap: string, pAttrs: string, pText: string) => {
          const plain = pText.replace(/<[^>]+>/g, '').trim();
          const looksLikeCaption = /font-style\s*:\s*italic/i.test(pAttrs) || plain.length <= 180;
          if (!looksLikeCaption || !plain) {
            return `<figure${figAttrs}>${beforeCap}<figcaption${capAttrs}>${oldCap}</figcaption>${afterCap}</figure><p${pAttrs}>${pText}</p>`;
          }
          const nextCaption = escapeHtml(plain);
          return `<figure${figAttrs}>${beforeCap}<figcaption${capAttrs}>${nextCaption}</figcaption>${afterCap}</figure>`;
        }
      );
    }
    return out;
  };
  const forceCaptionUnderFigure = (input: string): string => {
    const trailingCaptionRe =
      /(<figure\b[^>]*>[\s\S]*?<figcaption\b[^>]*>)([\s\S]*?)(<\/figcaption>[\s\S]*?<\/figure>)(?:\s*<p\b[^>]*>\s*(?:&nbsp;)?\s*<\/p>)*\s*<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    return input.replace(trailingCaptionRe, (_m, openCap: string, oldCap: string, closeFig: string, pAttrs: string, pHtml: string) => {
      const plain = pHtml.replace(/<[^>]+>/g, '').trim();
      const isCaptionStyle = /font-style\s*:\s*italic/i.test(pAttrs) || /font-size\s*:\s*12px/i.test(pAttrs);
      const captionishText = plain.length > 0 && plain.length <= 220;
      if (!isCaptionStyle && !captionishText) {
        return `${openCap}${oldCap}${closeFig}<p${pAttrs}>${pHtml}</p>`;
      }
      return `${openCap}${escapeHtml(plain)}</figcaption>${closeFig}`;
    });
  };

  const transformed = html.replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, (_full, attrs: string, inner: string) => {
    const parts = inner.split(mediaTagRe);
    if (parts.length === 1) return `<p${attrs}>${inner}</p>`;
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? '';
      if (i % 2 === 0) {
        const txt = part.trim();
        if (txt) out += `<p${attrs}>${part}</p>`;
      } else {
        out += renderFigure(part);
      }
    }
    return out;
  });

  const merged = mergeAdjacentCaptionParagraphs(transformed);
  const figureBlocks: string[] = [];
  const withPlaceholders = merged.replace(/<figure\b[\s\S]*?<\/figure>/gi, (block: string) => {
    const idx = figureBlocks.push(block) - 1;
    return `__FIG_BLOCK_${idx}__`;
  });

  const wrappedStandalone = withPlaceholders.replace(mediaTagRe, (tag: string) => renderFigure(tag));

  const restored = wrappedStandalone.replace(/__FIG_BLOCK_(\d+)__/g, (_m, idxStr: string) => {
    const block = figureBlocks[Number(idxStr)] ?? '';
    const mediaMatch = block.match(mediaTagRe);
    if (!mediaMatch) return block;
    const mediaTag = mediaMatch[0];
    const rawCaption = block.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? altFromImg(mediaTag);
    const caption = escapeHtml(
      toDescriptiveCaption(rawCaption.replace(/<[^>]+>/g, '').trim(), mediaTag.toLowerCase().startsWith('<video') ? 'video' : 'photo')
    );
    return `<figure style="${nextFigureStyle()}">${normalizeMediaTag(mediaTag)}<figcaption style="${figcaptionStyle}">${caption}</figcaption></figure>`;
  });
  return forceCaptionUnderFigure(restored);
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

  bodyHtml = markdownBoldToHtml(bodyHtml);
  bodyHtml = replaceGcsUrlsWithMediaProxy(bodyHtml);
  bodyHtml = styleNewsletterMedia(bodyHtml);

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
      const footerHtml = `<p style="font-size:12px;color:#999;margin-top:32px;text-align:center;"><a href="${archiveUrl}">View in browser</a> &middot; <a href="${unsubUrl}">Unsubscribe</a></p>`;
      const fullHtml = wrapHtmlEmail(bodyHtml + footerHtml, draft.subject ?? 'Weekly Newsletter');
      const plainText = htmlToPlainText(bodyHtml)
        + `\n\nView in browser: ${archiveUrl}\nUnsubscribe: ${unsubUrl}\n`;
      try {
        await sg.send({
          to: email,
          from: { email: from, name: fromName },
          subject: draft.subject ?? 'Weekly Newsletter',
          html: fullHtml,
          text: plainText,
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        logger.info('SendGrid email sent successfully', { email });
      } catch (err: unknown) {
        const sgErr = err as { response?: { body?: unknown; statusCode?: number } };
        logger.error('SendGrid send failed', err, {
          email,
          statusCode: sgErr.response?.statusCode,
          responseBody: sgErr.response?.body,
        });
      }
    }
  }

  if (twilioAccountSid && twilioAuthToken && twilioFrom) {
    try {
      const twilio = (await import('twilio')).default;
      const client = twilio(twilioAccountSid, twilioAuthToken);
      const smsEligible = subsSnap.docs.filter((d) => d.data().smsConsent && d.data().phone);
      logger.info('Sending SMS notifications', { eligible: smsEligible.length, total: subsSnap.size });
      for (const subDoc of smsEligible) {
        const sub = subDoc.data();
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
    } catch (err) {
      // Don't fail newsletter delivery if Twilio is misconfigured.
      logger.warn('SMS skipped — Twilio initialization failed', { error: toErrorMessage(err) });
    }
  } else if (!twilioFrom) {
    logger.warn('SMS skipped — TWILIO_FROM env var is not set');
  } else if (!twilioAccountSid || !twilioAuthToken) {
    logger.warn('SMS skipped — Twilio credentials not configured');
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
