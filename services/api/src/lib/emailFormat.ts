/**
 * Convert Markdown-style bold (**text**) to HTML <strong> so it renders correctly
 * when the LLM outputs asterisks instead of tags.
 */
export function markdownBoldToHtml(html: string): string {
  return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Wrap newsletter body HTML in a proper email document with DOCTYPE,
 * charset, viewport meta, and a centered container. Improves rendering
 * across email clients and avoids spam-filter penalties for bare HTML.
 */
export function wrapHtmlEmail(bodyHtml: string, subject: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>${escapeHtml(subject)}</title>
<!--[if mso]><style>table,td{font-family:Georgia,serif;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f5f5f0;font-family:Georgia,'Times New Roman',serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f0;">
<tr><td align="center" style="padding:24px 16px;">
<div style="max-width:640px;margin:0 auto;background-color:#ffffff;padding:24px 32px;border:1px solid #e0e0e0;">
${bodyHtml}
</div>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Strip HTML to produce a readable plain-text version of the newsletter.
 * Keeps link URLs inline so recipients on text-only clients can still navigate.
 */
export function htmlToPlainText(html: string): string {
  let text = html;

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (_, url, label) => {
    const cleanLabel = label.replace(/<[^>]+>/g, '').trim();
    return cleanLabel === url ? url : `${cleanLabel} (${url})`;
  });

  text = text.replace(/<img\s+[^>]*alt=["']([^"']+)["'][^>]*>/gi, '[Image: $1]');
  text = text.replace(/<img[^>]*>/gi, '');

  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<[^>]+>/g, '');

  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&middot;/gi, '·');

  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
