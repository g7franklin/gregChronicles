'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { getAuth } from '@/lib/firebase';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

const MANUAL_SEND_PHRASE = 'I solemnly swear I am up to no good';

type Draft = {
  id: string;
  weekKey: string;
  status: string;
  subject: string;
  bodyMarkdown: string;
  bodyHtml?: string;
  generatedAt: string;
  plannedSendAt?: string;
  plannedSendLabel?: string;
};

type MediaCandidate = {
  memoId: string;
  attachmentId: string;
  type: 'audio' | 'video' | 'image';
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string | null;
  url: string;
};

export default function NewsletterPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subject, setSubject] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [previewBodyMarkdown, setPreviewBodyMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [sendNowStep, setSendNowStep] = useState<0 | 1 | 2>(0);
  const [sendNowPhrase, setSendNowPhrase] = useState('');
  const [sendNowLoading, setSendNowLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [llmProvider, setLlmProvider] = useState<'claude' | 'grok'>('claude');
  const [generateStartDate, setGenerateStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [generateEndDate, setGenerateEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [editMode, setEditMode] = useState<'visual' | 'source'>('visual');
  const [editorVersion, setEditorVersion] = useState(0);
  const [mediaCandidates, setMediaCandidates] = useState<MediaCandidate[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [selectedEditorMediaUrl, setSelectedEditorMediaUrl] = useState<string>('');
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRangeRef = useRef<Range | null>(null);

  const getBodyMarkdown = useCallback(() => {
    if (editMode === 'visual' && editorRef.current) {
      return editorRef.current.innerHTML;
    }
    return bodyMarkdown;
  }, [editMode, bodyMarkdown]);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<Draft>('/admin/drafts/current')
      .then((d) => {
        setDraft(d);
        setSubject(d.subject ?? '');
        setBodyMarkdown(d.bodyMarkdown ?? '');
        setPreviewBodyMarkdown(null);
      })
      .catch((err) => {
        setDraft(null);
        setPreviewBodyMarkdown(null);
        if (err?.message?.includes('Authorization') || err?.message?.includes('401')) {
          setMessage('Sign-in problem. Try signing out and back in.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const loadPreviewBody = (draftId: string) => {
    apiGet<{ bodyMarkdown: string }>(`/admin/drafts/${draftId}/preview-body`)
      .then((r) => setPreviewBodyMarkdown(r.bodyMarkdown))
      .catch(() => setPreviewBodyMarkdown(null));
  };

  const loadMediaCandidates = (draftId: string) => {
    setMediaLoading(true);
    apiGet<{ candidates: MediaCandidate[] }>(`/admin/drafts/${draftId}/media-candidates`)
      .then((r) => setMediaCandidates(r.candidates ?? []))
      .catch(() => setMediaCandidates([]))
      .finally(() => setMediaLoading(false));
  };

  // Only call API after we have a user, so the Authorization header is always sent (fixes 401 on refresh).
  useEffect(() => {
    const auth = getAuth();
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) {
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    load();
  }, [authReady, load]);

  useEffect(() => {
    if (draft) {
      setSubject(draft.subject ?? '');
      setBodyMarkdown(draft.bodyMarkdown ?? '');
      loadPreviewBody(draft.id);
      loadMediaCandidates(draft.id);
      setEditorVersion(v => v + 1);
    }
  }, [draft?.id]);

  /**
   * Make newsletter media more subtle in the editor/preview:
   * - Images/videos are constrained to a smaller, inline-friendly size.
   * - Videos preload enough data to show the opening frame before play.
   */
  /** Convert **text** to <strong> so LLM output renders bold in preview. */
  function markdownBoldToHtml(html: string): string {
    return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function sanitizeMediaHtml(html: string): string {
    const mediaTagRe = /(<img\b[^>]*>|<video\b[^>]*>[\s\S]*?<\/video>)/gi;
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
      const caption = escapeHtmlText(
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
            const nextCaption = escapeHtmlText(plain);
            return `<figure${figAttrs}>${beforeCap}<figcaption${capAttrs}>${nextCaption}</figcaption>${afterCap}</figure>`;
          }
        );
      }
      return out;
    };

    const forceCaptionUnderFigure = (input: string): string => {
      const trailingCaptionRe =
        /(<figure\b[^>]*>[\s\S]*?<figcaption\b[^>]*>)([\s\S]*?)(<\/figcaption>[\s\S]*?<\/figure>)(?:\s*<p\b[^>]*>\s*(?:&nbsp;)?\s*<\/p>)*\s*<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
      return input.replace(trailingCaptionRe, (_m, openCap: string, _oldCap: string, closeFig: string, pAttrs: string, pHtml: string) => {
        const plain = pHtml.replace(/<[^>]+>/g, '').trim();
        const isCaptionStyle = /font-style\s*:\s*italic/i.test(pAttrs) || /font-size\s*:\s*12px/i.test(pAttrs);
        const captionishText = plain.length > 0 && plain.length <= 220;
        if (!isCaptionStyle && !captionishText) {
          return `${openCap}${_oldCap}${closeFig}<p${pAttrs}>${pHtml}</p>`;
        }
        return `${openCap}${escapeHtmlText(plain)}</figcaption>${closeFig}`;
      });
    };

    // Enforce max one media per paragraph by splitting paragraph text around media tags.
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

    // Keep figures stable; merge any adjacent italic caption paragraph into the figure.
    const merged = mergeAdjacentCaptionParagraphs(transformed);

    // Normalize existing figure blocks to the same compact inline-media format.
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
      const caption = escapeHtmlText(
        toDescriptiveCaption(rawCaption.replace(/<[^>]+>/g, '').trim(), mediaTag.toLowerCase().startsWith('<video') ? 'video' : 'photo')
      );
      return `<figure style="${nextFigureStyle()}">${normalizeMediaTag(mediaTag)}<figcaption style="${figcaptionStyle}">${caption}</figcaption></figure>`;
    });

    return forceCaptionUnderFigure(restored);
  }

  function applyBodyUpdate(nextBody: string): void {
    setBodyMarkdown(nextBody);
    setPreviewBodyMarkdown(null);
    setEditorVersion((v) => v + 1);
  }

  function escapeHtmlText(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isFilenameLikeCaption(value: string): boolean {
    const v = value.trim();
    if (!v) return true;
    if (/\.(jpe?g|png|gif|webp|heic|heif|mov|mp4|m4v|webm)$/i.test(v)) return true;
    if (/^(img|dsc|pxl|video|vid)[-_ ]?\d+/i.test(v)) return true;
    const withoutPunct = v.replace(/[\s._-]/g, '');
    return withoutPunct.length > 0 && /^[a-z]+\d+$/i.test(withoutPunct);
  }

  function toDescriptiveCaption(raw: string, mediaType: 'photo' | 'video', fallback?: string): string {
    const cleaned = raw
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned || isFilenameLikeCaption(raw) || isFilenameLikeCaption(cleaned)) {
      return fallback?.trim() || (mediaType === 'video' ? 'Video from this week' : 'Photo from this week');
    }
    return cleaned;
  }

  function buildMediaBlock(item: MediaCandidate): string {
    const defaultCaption = item.createdAt
      ? `${item.type === 'video' ? 'Video' : 'Photo'} from ${new Date(item.createdAt).toLocaleDateString()}`
      : `${item.type === 'video' ? 'Video' : 'Photo'} from this week`;
    const caption = escapeHtmlText(
      toDescriptiveCaption(item.originalName, item.type === 'video' ? 'video' : 'photo', defaultCaption)
    );
    const figureStyle = 'float:right;clear:right;margin:4px 0 10px 12px;width:170px;max-width:40%;';
    const mediaStyle = 'display:block;width:100%;height:auto;border-radius:4px;';
    return item.type === 'video'
      ? `<figure style="${figureStyle}"><video src="${item.url}" controls playsinline preload="auto" style="${mediaStyle}"></video><figcaption style="margin-top:4px;font-size:11px;line-height:1.3;color:#64748b;font-style:italic;">${caption}</figcaption></figure>`
      : item.type === 'audio'
        ? `<audio src="${item.url}" controls style="width:100%;margin:12px 0"></audio>\n<p style="font-size:12px;color:#666;font-style:italic;margin:0 0 16px 0">${caption}</p>`
        : `<figure style="${figureStyle}"><img src="${item.url}" alt="${caption}" style="${mediaStyle}"><figcaption style="margin-top:4px;font-size:11px;line-height:1.3;color:#64748b;font-style:italic;">${caption}</figcaption></figure>`;
  }

  function rememberCursorSelection(): void {
    if (editMode !== 'visual' || !editorRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!editorRef.current.contains(range.commonAncestorContainer)) return;
    selectionRangeRef.current = range.cloneRange();
  }

  function insertMediaAtCursor(item: MediaCandidate): void {
    const block = buildMediaBlock(item);
    if (editMode !== 'visual' || !editorRef.current) {
      applyBodyUpdate(`${getBodyMarkdown()}\n\n${block}`);
      setMessage(`Added ${item.type}: ${item.originalName}`);
      return;
    }
    const editor = editorRef.current;
    editor.focus();
    const sel = window.getSelection();
    const range = selectionRangeRef.current;
    if (!sel || !range || !editor.contains(range.commonAncestorContainer)) {
      applyBodyUpdate(`${editor.innerHTML}\n<p><br></p>\n${block}`);
      setMessage(`Added ${item.type}: ${item.originalName}`);
      return;
    }
    sel.removeAllRanges();
    sel.addRange(range);
    range.deleteContents();
    const temp = document.createElement('div');
    temp.innerHTML = block;
    const frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    range.insertNode(frag);
    applyBodyUpdate(editor.innerHTML);
    setMessage(`Added ${item.type} at cursor: ${item.originalName}`);
  }

  function captionForMediaCandidate(item: MediaCandidate): string {
    const defaultCaption = item.createdAt
      ? `${item.type === 'video' ? 'Video' : 'Photo'} from ${new Date(item.createdAt).toLocaleDateString()}`
      : `${item.type === 'video' ? 'Video' : 'Photo'} from this week`;
    return toDescriptiveCaption(item.originalName, item.type === 'video' ? 'video' : 'photo', defaultCaption);
  }

  function replaceMediaElementInEditor(
    node: HTMLImageElement | HTMLVideoElement | HTMLAudioElement,
    replacement: MediaCandidate
  ): void {
    const mediaStyle = 'display:block;width:100%;height:auto;border-radius:4px;';
    const captionText = captionForMediaCandidate(replacement);
    const fig = node.closest('figure');

    let newEl: HTMLElement;
    if (replacement.type === 'video') {
      const v = document.createElement('video');
      v.setAttribute('src', replacement.url);
      v.setAttribute('controls', '');
      v.setAttribute('playsinline', '');
      v.setAttribute('preload', 'auto');
      v.setAttribute('style', mediaStyle);
      newEl = v;
    } else if (replacement.type === 'audio') {
      const a = document.createElement('audio');
      a.setAttribute('src', replacement.url);
      a.setAttribute('controls', '');
      a.setAttribute('style', 'width:100%;');
      newEl = a;
    } else {
      const img = document.createElement('img');
      img.setAttribute('src', replacement.url);
      img.setAttribute('alt', captionText);
      img.setAttribute('style', mediaStyle);
      newEl = img;
    }

    node.parentNode?.replaceChild(newEl, node);
    if (fig) {
      const cap = fig.querySelector('figcaption');
      if (cap) cap.textContent = captionText;
    }
  }

  function replaceSelectedMedia(replacement: MediaCandidate): void {
    if (!selectedEditorMediaUrl) {
      setMessage('Click a photo/video in the preview first, then choose a replacement.');
      return;
    }
    if (editMode === 'visual' && editorRef.current) {
      const node = Array.from(editorRef.current.querySelectorAll('img,video,audio')).find(
        (el) => el.getAttribute('src') === selectedEditorMediaUrl
      ) as HTMLImageElement | HTMLVideoElement | HTMLAudioElement | undefined;
      if (node) {
        const wasTag = node.tagName.toLowerCase();
        const needSwap =
          (replacement.type === 'video' && wasTag !== 'video') ||
          (replacement.type === 'image' && wasTag !== 'img') ||
          (replacement.type === 'audio' && wasTag !== 'audio');

        if (needSwap) {
          replaceMediaElementInEditor(node, replacement);
        } else {
          node.setAttribute('src', replacement.url);
          if (node.tagName.toLowerCase() === 'img') {
            (node as HTMLImageElement).setAttribute('alt', captionForMediaCandidate(replacement));
          }
          const fig = node.closest('figure');
          const cap = fig?.querySelector('figcaption');
          if (cap) cap.textContent = captionForMediaCandidate(replacement);
        }
        applyBodyUpdate(editorRef.current.innerHTML);
        setSelectedEditorMediaUrl(replacement.url);
        setMessage(`Replaced selected media with ${replacement.originalName}`);
        return;
      }
    }
    const currentBody = getBodyMarkdown();
    const escaped = selectedEditorMediaUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(escaped).test(currentBody)) {
      setMessage('Selected media URL is not present in current draft body.');
      return;
    }

    const caption = escapeHtmlText(captionForMediaCandidate(replacement));
    const mediaStyle = 'display:block;width:100%;height:auto;border-radius:4px;';

    const figureWithUrl = new RegExp(
      `<figure\\b[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/figure>`,
      'i'
    );
    const newInner =
      replacement.type === 'video'
        ? `<video src="${replacement.url}" controls playsinline preload="auto" style="${mediaStyle}"></video><figcaption style="margin-top:4px;font-size:11px;line-height:1.3;color:#64748b;font-style:italic;">${caption}</figcaption>`
        : replacement.type === 'audio'
          ? `<audio src="${replacement.url}" controls style="width:100%;"></audio><figcaption style="margin-top:4px;font-size:11px;line-height:1.3;color:#64748b;font-style:italic;">${caption}</figcaption>`
          : `<img src="${replacement.url}" alt="${caption}" style="${mediaStyle}"><figcaption style="margin-top:4px;font-size:11px;line-height:1.3;color:#64748b;font-style:italic;">${caption}</figcaption>`;
    const figureReplaced = currentBody.replace(figureWithUrl, (full) => {
      const m = full.match(/^<figure\b([^>]*)>/i);
      const attrs = m?.[1] ?? '';
      return `<figure${attrs}>${newInner}</figure>`;
    });
    if (figureReplaced !== currentBody) {
      applyBodyUpdate(figureReplaced);
      setSelectedEditorMediaUrl(replacement.url);
      setMessage(`Replaced selected media with ${replacement.originalName}`);
      return;
    }

    const imgTagRe = new RegExp(`<img\\b([^>]*?)src=["']${escaped}["']([^>]*)>`, 'i');
    const videoTagRe = new RegExp(`<video\\b([^>]*?)src=["']${escaped}["']([^>]*)>[\\s\\S]*?<\\/video>`, 'i');

    let nextBody = currentBody;
    if (replacement.type === 'video') {
      const swapped = currentBody.replace(
        imgTagRe,
        `<video src="${replacement.url}" controls playsinline preload="auto" style="${mediaStyle}"></video>`
      );
      nextBody = swapped !== currentBody ? swapped : currentBody.replace(new RegExp(escaped, 'g'), replacement.url);
    } else if (replacement.type === 'image') {
      const swapped = currentBody.replace(
        videoTagRe,
        `<img src="${replacement.url}" alt="${caption}" style="${mediaStyle}">`
      );
      nextBody = swapped !== currentBody ? swapped : currentBody.replace(new RegExp(escaped, 'g'), replacement.url);
    } else {
      nextBody = currentBody.replace(new RegExp(escaped, 'g'), replacement.url);
    }

    applyBodyUpdate(nextBody);
    setSelectedEditorMediaUrl(replacement.url);
    setMessage(`Replaced selected media with ${replacement.originalName}`);
  }

  function deleteSelectedMedia(): void {
    if (!selectedEditorMediaUrl) {
      setMessage('Click a photo/video in the preview first, then click Delete selected.');
      return;
    }

    if (editMode === 'visual' && editorRef.current) {
      const editor = editorRef.current;
      const node = Array.from(editor.querySelectorAll('img,video,audio')).find(
        (el) => el.getAttribute('src') === selectedEditorMediaUrl
      ) as HTMLImageElement | HTMLVideoElement | HTMLAudioElement | undefined;

      if (node) {
        const figure = node.closest('figure');
        if (figure) {
          figure.remove();
        } else {
          const container = node.parentElement;
          node.remove();
          // Remove immediate caption paragraph if media is not inside a figure.
          const next = container?.nextElementSibling as HTMLElement | null;
          if (next && next.tagName.toLowerCase() === 'p') {
            const style = next.getAttribute('style') ?? '';
            const txt = (next.textContent ?? '').trim();
            const looksCaptionLike = /font-style\s*:\s*italic/i.test(style) || txt.length <= 220;
            if (looksCaptionLike) next.remove();
          }
        }
        applyBodyUpdate(editor.innerHTML);
        setSelectedEditorMediaUrl('');
        setMessage('Deleted selected media and its caption.');
        return;
      }
    }

    const currentBody = getBodyMarkdown();
    const escaped = selectedEditorMediaUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Prefer removing complete figure blocks that contain the selected URL.
    const figureRe = new RegExp(`<figure\\b[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/figure>`, 'i');
    let nextBody = currentBody.replace(figureRe, '');

    if (nextBody === currentBody) {
      // Fallback for non-figure media + optional adjacent italic caption paragraph.
      const mediaAndCaptionRe = new RegExp(
        `<(?:img|video|audio)\\b[^>]*src=["']${escaped}["'][\\s\\S]*?(?:<\\/video>)?\\s*(?:<p\\b[^>]*>[\\s\\S]*?<\\/p>)?`,
        'i'
      );
      nextBody = currentBody.replace(mediaAndCaptionRe, '');
    }

    if (nextBody === currentBody) {
      setMessage('Selected media URL is not present in current draft body.');
      return;
    }

    applyBodyUpdate(nextBody);
    setSelectedEditorMediaUrl('');
    setMessage('Deleted selected media and its caption.');
  }

  const visualCandidates = mediaCandidates.filter((m) => m.type === 'image' || m.type === 'video');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLVideoElement).preload = 'metadata';
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '200px' },
    );

    const container = document.querySelector('.max-w-4xl');
    if (container) {
      container.querySelectorAll('video[preload="none"]').forEach((v) => observer.observe(v));
    }

    return () => observer.disconnect();
  }, [bodyMarkdown, previewBodyMarkdown, editorVersion, editMode]);

  useEffect(() => {
    if (!editorRef.current || editMode !== 'visual') return;
    const nodes = Array.from(editorRef.current.querySelectorAll('img,video,audio')) as Array<HTMLElement>;
    nodes.forEach((n) => {
      if (n.getAttribute('src') === selectedEditorMediaUrl) {
        n.style.outline = '3px solid #0ea5e9';
        n.style.outlineOffset = '2px';
      } else {
        n.style.outline = '';
        n.style.outlineOffset = '';
      }
    });
  }, [selectedEditorMediaUrl, editorVersion, editMode]);

  const generateDraft = async () => {
    setGenerating(true);
    setMessage(null);
    try {
      const result = (await apiPost('/admin/drafts/generate', {
        provider: llmProvider,
        startDate: generateStartDate ? new Date(generateStartDate).toISOString() : undefined,
        endDate: generateEndDate ? new Date(generateEndDate + 'T23:59:59').toISOString() : undefined,
      })) as { draftId?: string };
      const draftId = result?.draftId;
      if (draftId) {
        const d = await apiGet<Draft>(`/admin/drafts/${draftId}`);
        setDraft(d);
        setSubject(d.subject ?? '');
        setBodyMarkdown(d.bodyMarkdown ?? '');
        setMessage('Draft generated from your memos. Review and edit below.');
      } else {
        load();
        setMessage('Draft generated. Review and edit below.');
      }
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const currentBody = getBodyMarkdown();
      await apiPatch(`/admin/drafts/${draft.id}`, { subject, bodyMarkdown: currentBody });
      setMessage('Saved.');
      const updated = await apiGet<Draft>(`/admin/drafts/${draft.id}`);
      setDraft(updated);
      setSubject(updated.subject ?? '');
      setBodyMarkdown(updated.bodyMarkdown ?? '');
      setPreviewBodyMarkdown(null);
      loadPreviewBody(updated.id);
      setEditorVersion(v => v + 1);
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const currentBody = getBodyMarkdown();
      await apiPatch(`/admin/drafts/${draft.id}`, { subject, bodyMarkdown: currentBody });
      await apiPost(`/admin/drafts/${draft.id}/approve`);
      setMessage('Marked as ready to send.');
      const updated = await apiGet<Draft>(`/admin/drafts/${draft.id}`);
      setDraft(updated);
      setSubject(updated.subject ?? '');
      setBodyMarkdown(updated.bodyMarkdown ?? '');
      setEditorVersion(v => v + 1);
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const unapprove = async () => {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiPost(`/admin/drafts/${draft.id}/unapprove`);
      setMessage('Draft set back to pending.');
      const updated = await apiGet<Draft>(`/admin/drafts/${draft.id}`);
      setDraft(updated);
      setSubject(updated.subject ?? '');
      setBodyMarkdown(updated.bodyMarkdown ?? '');
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const sendChat = async () => {
    if (!draft || !chatMessage.trim()) return;
    setChatLoading(true);
    setMessage(null);
    try {
      const currentBody = getBodyMarkdown();
      await apiPatch(`/admin/drafts/${draft.id}`, { subject, bodyMarkdown: currentBody });
      const result = await apiPost(`/admin/drafts/${draft.id}/chat`, {
        message: chatMessage.trim(),
        provider: llmProvider,
      }) as { subject: string; bodyMarkdown: string };
      setSubject(result.subject);
      setBodyMarkdown(result.bodyMarkdown);
      setEditorVersion(v => v + 1);
      setChatMessage('');
      setMessage('Draft updated. You can edit further or ask again.');
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setChatLoading(false);
    }
  };

  const openSendNow = () => setSendNowStep(1);
  const cancelSendNow = () => {
    setSendNowStep(0);
    setSendNowPhrase('');
  };
  const confirmSendNow = async () => {
    if (!draft) return;
    if (sendNowStep === 1) {
      setSendNowStep(2);
      return;
    }
    setSendNowLoading(true);
    try {
      await apiPost(`/admin/drafts/${draft.id}/send-now`, {
        confirmationPhrase: sendNowPhrase,
      });
      setMessage('Newsletter sent.');
      cancelSendNow();
      const updated = await apiGet<Draft>(`/admin/drafts/${draft.id}`);
      setDraft(updated);
      setSubject(updated.subject ?? '');
      setBodyMarkdown(updated.bodyMarkdown ?? '');
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSendNowLoading(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <p>Loading…</p>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="w-full max-w-none">
        <h1 className="text-2xl font-semibold mb-2">Newsletter Draft</h1>
        <p className="text-slate-600 mb-4">
          Generate a draft from your memos, edit it (by hand or with the agent), then send when ready.
        </p>

        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm font-medium text-slate-700">AI model:</span>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setLlmProvider('claude')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                llmProvider === 'claude'
                  ? 'bg-white shadow-sm text-slate-800 font-medium'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Claude
            </button>
            <button
              type="button"
              onClick={() => setLlmProvider('grok')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                llmProvider === 'grok'
                  ? 'bg-white shadow-sm text-slate-800 font-medium'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Grok
            </button>
          </div>
        </div>

        {!draft ? (
          <div className="border border-slate-200 rounded-lg p-6 bg-slate-50">
            <p className="text-slate-700 mb-4">
              No draft yet. Generate one from your memos. Adjust the date range to include any memos you want.
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700 whitespace-nowrap">From</label>
                <input
                  type="date"
                  value={generateStartDate}
                  onChange={(e) => setGenerateStartDate(e.target.value)}
                  className="border rounded-lg px-2 py-1 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700 whitespace-nowrap">To</label>
                <input
                  type="date"
                  value={generateEndDate}
                  onChange={(e) => setGenerateEndDate(e.target.value)}
                  className="border rounded-lg px-2 py-1 text-sm"
                />
              </div>
            </div>
            <button
              onClick={generateDraft}
              disabled={generating}
              className="px-4 py-2 bg-slate-700 text-white rounded-lg disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate newsletter from memos'}
            </button>
            {message && <p className="text-sm text-slate-600 mt-2">{message}</p>}
          </div>
        ) : (
          <>
            {draft.status === 'approved' ? (
              <div className="mb-4 rounded-lg border-2 border-green-600 bg-green-50 px-4 py-3">
                <p className="text-base font-semibold text-green-800">
                  ✓ Ready to send
                </p>
                <p className="mt-0.5 text-sm text-green-700">
                  Generated: {draft.generatedAt ? new Date(draft.generatedAt).toLocaleString() : '—'}
                </p>
              </div>
            ) : draft.status === 'sent' ? (
              <div className="mb-4 rounded-lg border-2 border-slate-400 bg-slate-100 px-4 py-3">
                <p className="text-base font-semibold text-slate-800">Already sent</p>
                <p className="mt-1 text-sm text-slate-600">
                  Week: {draft.weekKey} · Generated: {draft.generatedAt ? new Date(draft.generatedAt).toLocaleString() : '—'}
                </p>
              </div>
            ) : (
              <div className="mb-4 rounded-lg border-2 border-amber-500 bg-amber-50 px-4 py-3">
                <p className="text-base font-semibold text-amber-900">
                  Draft pending — review and send when ready.
                </p>
                <p className="mt-0.5 text-sm text-amber-800">
                  Generated: {draft.generatedAt ? new Date(draft.generatedAt).toLocaleString() : '—'}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 mb-3">
              <span className="text-sm font-medium text-slate-700">Memo date range:</span>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 whitespace-nowrap">From</label>
                <input
                  type="date"
                  value={generateStartDate}
                  onChange={(e) => setGenerateStartDate(e.target.value)}
                  className="border rounded-lg px-2 py-1 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600 whitespace-nowrap">To</label>
                <input
                  type="date"
                  value={generateEndDate}
                  onChange={(e) => setGenerateEndDate(e.target.value)}
                  className="border rounded-lg px-2 py-1 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setShowGenerateConfirm(true)}
                disabled={generating}
                className="px-4 py-2 bg-slate-600 text-white rounded-lg disabled:opacity-50"
              >
                {generating ? 'Generating…' : 'Generate new draft'}
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 bg-slate-600 text-white rounded-lg disabled:opacity-50"
              >
                Save edits
              </button>
              {draft.status !== 'sent' && (
                <button
                  onClick={openSendNow}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                >
                  Send now
                </button>
              )}
            </div>
            {message && <p className="text-sm text-slate-600 mb-4">{message}</p>}

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
              <div className="space-y-4">
                <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full border rounded-lg p-2"
                />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-700">Body</label>
                    <div className="flex bg-slate-100 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (editMode === 'source') {
                          setEditorVersion(v => v + 1);
                          setEditMode('visual');
                        }
                      }}
                      className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                        editMode === 'visual'
                          ? 'bg-white shadow-sm text-slate-800 font-medium'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Visual Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (editMode === 'visual' && editorRef.current) {
                          setBodyMarkdown(editorRef.current.innerHTML);
                        }
                        setEditMode('source');
                      }}
                      className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                        editMode === 'source'
                          ? 'bg-white shadow-sm text-slate-800 font-medium'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Source HTML
                    </button>
                  </div>
                </div>

                  {editMode === 'visual' ? (
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                    <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                      <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                      </svg>
                      <span className="text-sm text-slate-500">Click anywhere on the newsletter to edit text directly</span>
                    </div>
                    <div
                      className="p-8 bg-[#fafaf8] max-h-[70vh] overflow-auto"
                      style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                    >
                      {bodyMarkdown ? (
                        (() => {
                          const isHtml = /^\s*</.test(bodyMarkdown) || bodyMarkdown.includes('<div') || bodyMarkdown.includes('<p') || bodyMarkdown.includes('<table');
                          const content = isHtml
                            ? sanitizeMediaHtml(markdownBoldToHtml(bodyMarkdown))
                            : `<div style="white-space:pre-wrap;font-family:sans-serif;color:#44403c;font-size:0.875rem">${bodyMarkdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
                          return (
                            <div
                              key={editorVersion}
                              ref={editorRef}
                              contentEditable
                              suppressContentEditableWarning
                              className="newspaper-content max-w-[600px] mx-auto [&_a]:text-stone-700 [&_a]:underline [&_a:hover]:text-stone-900 focus:outline-none cursor-text [&_*]:cursor-text"
                              dangerouslySetInnerHTML={{ __html: content }}
                              onMouseUp={rememberCursorSelection}
                              onKeyUp={rememberCursorSelection}
                              onClick={(e) => {
                                const target = e.target as HTMLElement;
                                const mediaEl = target.closest('img,video,audio') as HTMLElement | null;
                                if (mediaEl) {
                                  const src = mediaEl.getAttribute('src');
                                  if (src) {
                                    setSelectedEditorMediaUrl(src);
                                    setMessage('Media selected. Choose replacement on the right, or click text to set insert cursor.');
                                  }
                                  return;
                                }
                                if (target.tagName === 'A' || target.closest('a')) {
                                  e.preventDefault();
                                }
                              }}
                            />
                          );
                        })()
                      ) : (
                        <div
                          key={editorVersion}
                          ref={editorRef}
                          contentEditable
                          suppressContentEditableWarning
                          className="newspaper-content max-w-[600px] mx-auto focus:outline-none cursor-text min-h-[200px] text-stone-400"
                        >
                          <p>Start typing your newsletter content...</p>
                        </div>
                      )}
                    </div>
                    </div>
                  ) : (
                    <>
                    <textarea
                      value={bodyMarkdown}
                      onChange={(e) => setBodyMarkdown(e.target.value)}
                      rows={16}
                      className="w-full border rounded-lg p-2 font-mono text-sm"
                    />
                    <div className="border border-slate-200 rounded-lg p-4 bg-white mt-4">
                      <h2 className="text-lg font-medium text-slate-800 mb-2">Preview</h2>
                      <p className="text-sm text-slate-500 mb-3">Subject: {subject || '(none)'}</p>
                      <div
                        className="p-8 bg-[#fafaf8] border border-stone-300 max-h-[70vh] overflow-auto"
                        style={{
                          fontFamily: 'Georgia, "Times New Roman", serif',
                          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                        }}
                      >
                        {(previewBodyMarkdown ?? bodyMarkdown) ? (
                          (() => {
                            const raw = previewBodyMarkdown ?? bodyMarkdown;
                            const isHtml = /^\s*</.test(raw) || raw.includes('<div') || raw.includes('<p') || raw.includes('<table');
                            if (!isHtml) {
                              return (
                                <pre className="whitespace-pre-wrap font-sans text-stone-700 text-sm">
                                  {raw}
                                </pre>
                              );
                            }
                            const html = sanitizeMediaHtml(markdownBoldToHtml(raw));
                            return (
                              <div
                                className="newspaper-content max-w-[600px] mx-auto [&_a]:text-stone-700 [&_a]:underline [&_a:hover]:text-stone-900"
                                dangerouslySetInnerHTML={{ __html: html }}
                              />
                            );
                          })()
                        ) : (
                          <p className="text-stone-500">No content yet.</p>
                        )}
                      </div>
                    </div>
                    </>
                  )}
                </div>

                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Ask the agent to edit the draft
                  </label>
                  <p className="text-slate-600 text-sm mb-2">
                    Describe the changes you want (e.g. “Make the tone more casual” or “Add a section
                    about the trip”).
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChat()}
                      placeholder="e.g. Shorten the first paragraph"
                      className="flex-1 border rounded-lg p-2"
                    />
                    <button
                      onClick={sendChat}
                      disabled={chatLoading || !chatMessage.trim()}
                      className="px-4 py-2 bg-slate-600 text-white rounded-lg disabled:opacity-50"
                    >
                      {chatLoading ? 'Applying…' : 'Apply'}
                    </button>
                  </div>
                </div>
              </div>

              <aside className="border border-slate-200 rounded-lg p-4 bg-slate-50 xl:sticky xl:top-4">
                <h3 className="text-sm font-medium text-slate-700 mb-2">Media chooser (selected range only)</h3>
                <p className="text-xs text-slate-500 mb-3">
                  Click media in preview to replace it, or click text then Add at cursor.
                </p>
                <div className="max-h-[70vh] overflow-auto border rounded bg-white p-2">
                  {mediaLoading ? (
                    <p className="text-sm text-slate-500 p-2">Loading media...</p>
                  ) : visualCandidates.length === 0 ? (
                    <p className="text-sm text-slate-500 p-2">No image/video candidates for this draft.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {visualCandidates.map((c) => (
                        <div key={`${c.memoId}:${c.attachmentId}`} className="border rounded p-2">
                          <div className="w-full h-28 bg-slate-100 rounded overflow-hidden mb-2">
                            {c.type === 'image' ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={c.url} alt={c.originalName} className="w-full h-full object-cover" />
                            ) : (
                              <video src={c.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                            )}
                          </div>
                          <p className="text-xs text-slate-600 truncate mb-2">{c.originalName}</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => insertMediaAtCursor(c)}
                              className="flex-1 px-2 py-1 text-xs bg-slate-200 rounded hover:bg-slate-300"
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={() => replaceSelectedMedia(c)}
                              className="flex-1 px-2 py-1 text-xs bg-sky-600 text-white rounded hover:bg-sky-700"
                            >
                              Replace
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {selectedEditorMediaUrl && (
                  <>
                    <p className="text-xs text-sky-700 mt-2 truncate">Selected media URL: {selectedEditorMediaUrl}</p>
                    <button
                      type="button"
                      onClick={deleteSelectedMedia}
                      className="mt-2 w-full px-3 py-2 text-sm bg-rose-600 text-white rounded hover:bg-rose-700"
                    >
                      Delete selected media
                    </button>
                  </>
                )}
              </aside>
            </div>
          </>
        )}

        {sendNowStep >= 1 && draft && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={(e) => e.target === e.currentTarget && cancelSendNow()}
          >
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold text-slate-800 mb-2">Send newsletter now?</h2>
              {sendNowStep === 1 && (
                <>
                  <p className="text-slate-600 mb-4">
                    This will send the newsletter immediately to all active subscribers. This cannot
                    be undone.
                  </p>
                  <p className="text-slate-600 mb-4">Are you sure you want to continue?</p>
                  <div className="flex gap-2 justify-end">
                    <button onClick={cancelSendNow} className="px-4 py-2 border rounded-lg">
                      Cancel
                    </button>
                    <button
                      onClick={() => setSendNowStep(2)}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg"
                    >
                      Yes, I want to send now
                    </button>
                  </div>
                </>
              )}
              {sendNowStep === 2 && (
                <>
                  <p className="text-slate-600 mb-2">
                    To confirm, type exactly:
                  </p>
                  <p className="font-mono text-sm bg-slate-100 p-2 rounded mb-4">
                    {MANUAL_SEND_PHRASE}
                  </p>
                  <input
                    type="text"
                    value={sendNowPhrase}
                    onChange={(e) => setSendNowPhrase(e.target.value)}
                    placeholder="Type the phrase above"
                    className="w-full border rounded-lg p-2 mb-4"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={cancelSendNow} className="px-4 py-2 border rounded-lg">
                      Cancel
                    </button>
                    <button
                      onClick={confirmSendNow}
                      disabled={sendNowLoading || sendNowPhrase !== MANUAL_SEND_PHRASE}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg disabled:opacity-50"
                    >
                      {sendNowLoading ? 'Sending…' : 'Send newsletter now'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {showGenerateConfirm && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={(e) => e.target === e.currentTarget && setShowGenerateConfirm(false)}
          >
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold text-slate-800 mb-2">Generate new draft?</h2>
              <p className="text-slate-600 mb-4">
                This will create a new draft from your memos using the selected date range. Your current draft will still
                exist but will no longer be shown as the current week&apos;s draft.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowGenerateConfirm(false)}
                  className="px-4 py-2 border rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowGenerateConfirm(false);
                    generateDraft();
                  }}
                  className="px-4 py-2 bg-slate-700 text-white rounded-lg"
                >
                  Yes, generate new draft
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
