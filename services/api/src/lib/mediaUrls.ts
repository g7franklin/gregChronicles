import { getApiBaseUrl, getBucketName } from '../config.js';

/** Replace literal "signedUrl" placeholders (LLM sometimes outputs these) with actual URLs from attachments. */
export function replaceSignedUrlPlaceholders(
  html: string,
  signedUrls: string[]
): string {
  const validUrls = signedUrls.filter((u): u is string => typeof u === 'string' && u.startsWith('http'));
  if (validUrls.length === 0) return html;
  let idx = 0;
  return html.replace(
    /(src|href)=["']([^"']*signedUrl[^"']*)["']/gi,
    (_, attr) => {
      const url = validUrls[idx % validUrls.length];
      idx++;
      return `${attr}="${url}"`;
    }
  );
}

/** Replace GCS signed URLs with stable media proxy URLs so images/videos never expire. */
export function replaceGcsUrlsWithMediaProxy(html: string): string {
  const bucketName = getBucketName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const urlRegex = new RegExp(
    'https://storage\\.googleapis\\.com/' + bucketName + '/([^"\\s?]+)(\\?[^"]*)?',
    'g'
  );
  const apiBase = getApiBaseUrl().replace(/\/$/, '');
  return html.replace(urlRegex, (_, path: string) => `${apiBase}/media/${path}`);
}
