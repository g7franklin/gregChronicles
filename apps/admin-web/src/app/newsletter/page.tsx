'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { getAuth } from '@/lib/firebase';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';

const MANUAL_SEND_PHRASE = 'I solemnly swear I am up to no good';

function formatDraftOptionLabel(d: Pick<DraftSummary, 'generatedAt' | 'name'>): string {
  const label = d.name?.trim();
  if (label) return label;
  return d.generatedAt
    ? new Date(d.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Draft';
}

function formatMemoRangeDate(iso?: string): string {
  if (!iso) return '…';
  const x = new Date(iso);
  return Number.isNaN(x.getTime())
    ? iso.slice(0, 10)
    : x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function DraftMemoRangeBlurb({ draft }: { draft: Draft }) {
  if (draft.memoRangeStart || draft.memoRangeEnd) {
    return (
      <p className="pl-0.5 text-xs text-slate-600">
        Memos in this draft:{' '}
        <span className="font-bold text-slate-900">
          {formatMemoRangeDate(draft.memoRangeStart)} – {formatMemoRangeDate(draft.memoRangeEnd)}
        </span>
      </p>
    );
  }
  return (
    <p className="pl-0.5 text-xs text-slate-600">
      Memos in this draft:{' '}
      <span className="font-bold text-slate-900">range not stored</span>
      <span className="text-slate-500"> (saved before this was tracked)</span>
    </p>
  );
}

function BouncingDots({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-2 w-2 rounded-full bg-violet-500 motion-safe:animate-bounce"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: '0.55s' }}
        />
      ))}
    </span>
  );
}

function DraftWorkingGlyph({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-16 w-16' : size === 'sm' ? 'h-9 w-9' : 'h-12 w-12';
  const icon = size === 'lg' ? 'h-8 w-8' : size === 'sm' ? 'h-4 w-4' : 'h-6 w-6';
  return (
    <div className={`relative shrink-0 ${box}`}>
      <span className="absolute inset-0 rounded-full bg-violet-400/30 motion-safe:animate-ping" />
      <span className="absolute inset-1 rounded-full bg-gradient-to-br from-violet-200 to-amber-100 motion-safe:animate-pulse" />
      <span className="relative flex h-full w-full items-center justify-center rounded-full border-2 border-violet-300/80 bg-white shadow-sm">
        <svg
          className={`${icon} text-violet-600 motion-safe:animate-pulse`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.847a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"
          />
        </svg>
      </span>
    </div>
  );
}

/** Page-level status while a draft is being generated or the bottom agent is editing. */
function NewsletterWorkingBanner({ mode }: { mode: 'generating' | 'agent' }) {
  const isGen = mode === 'generating';
  return (
    <div
      className="mb-4 flex items-center gap-4 rounded-xl border border-violet-200/90 bg-gradient-to-r from-violet-50 via-white to-amber-50 px-4 py-3 shadow-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <DraftWorkingGlyph size="md" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-slate-800">
          {isGen ? 'Generating a new draft' : 'Agent is revising this draft'}
          <BouncingDots className="translate-y-0.5" />
        </p>
        <p className="text-xs text-slate-600 mt-0.5">
          {isGen
            ? 'Pulling memos and writing the newsletter—this can take a minute.'
            : 'Updating subject and body from your request and the memo transcripts.'}
        </p>
      </div>
    </div>
  );
}

type Draft = {
  id: string;
  weekKey: string;
  status: string;
  /** Admin-only label for the draft picker; falls back to generated date if empty. */
  name?: string;
  subject: string;
  bodyMarkdown: string;
  bodyHtml?: string;
  generatedAt: string;
  memoRangeStart?: string;
  memoRangeEnd?: string;
  plannedSendAt?: string;
  plannedSendLabel?: string;
};

type DraftSummary = {
  id: string;
  weekKey: string;
  status: string;
  name?: string;
  subject: string;
  generatedAt: string;
  memoRangeStart?: string;
  memoRangeEnd?: string;
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
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [llmProvider, setLlmProvider] = useState<'claude' | 'grok'>('grok');
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
  const [draftList, setDraftList] = useState<DraftSummary[]>([]);
  const [draftListLoading, setDraftListLoading] = useState(false);
  const [openingDraftId, setOpeningDraftId] = useState<string | null>(null);
  const [deletingDraft, setDeletingDraft] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [draftNameEdit, setDraftNameEdit] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameModalValue, setRenameModalValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRangeRef = useRef<Range | null>(null);

  const getBodyMarkdown = useCallback(() => {
    if (editMode === 'visual' && editorRef.current) {
      return editorRef.current.innerHTML;
    }
    return bodyMarkdown;
  }, [editMode, bodyMarkdown]);

  const loadDraftList = useCallback(async () => {
    setDraftListLoading(true);
    try {
      const r = await apiGet<{ drafts: DraftSummary[] }>('/admin/drafts');
      setDraftList(r.drafts ?? []);
    } catch {
      setDraftList([]);
    } finally {
      setDraftListLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      let list: DraftSummary[] = [];
      try {
        const r = await apiGet<{ drafts: DraftSummary[] }>('/admin/drafts');
        list = r.drafts ?? [];
      } catch {
        list = [];
      }
      setDraftList(list);

      let opened: Draft | null = null;
      try {
        opened = await apiGet<Draft>('/admin/drafts/current');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Authorization') || msg.includes('401')) {
          setMessage('Sign-in problem. Try signing out and back in.');
          return;
        }
      }

      if (!opened && list.length > 0) {
        try {
          opened = await apiGet<Draft>(`/admin/drafts/${list[0].id}`);
        } catch {
          opened = null;
        }
      }

      if (opened) {
        setDraft(opened);
        setSubject(opened.subject ?? '');
        setBodyMarkdown(opened.bodyMarkdown ?? '');
        setPreviewBodyMarkdown(null);
      } else {
        setDraft(null);
        setSubject('');
        setBodyMarkdown('');
        setPreviewBodyMarkdown(null);
      }
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  const openDraftById = useCallback(async (id: string) => {
    if (!id) return;
    setOpeningDraftId(id);
    setMessage(null);
    try {
      const d = await apiGet<Draft>(`/admin/drafts/${id}`);
      setDraft(d);
      setSubject(d.subject ?? '');
      setBodyMarkdown(d.bodyMarkdown ?? '');
      setPreviewBodyMarkdown(null);
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setOpeningDraftId(null);
    }
  }, []);

  const deleteOpenDraft = useCallback(async () => {
    if (!draft || draft.status === 'sent') return;
    if (!window.confirm('Delete this draft permanently? This cannot be undone.')) return;
    setDeletingDraft(true);
    setMessage(null);
    try {
      await apiDelete(`/admin/drafts/${draft.id}`);
      setMessage('Draft deleted.');
      await load();
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeletingDraft(false);
    }
  }, [draft, load]);

  const duplicateOpenDraft = useCallback(async () => {
    if (!draft) return;
    setDuplicating(true);
    setMessage(null);
    try {
      if (draft.status !== 'sent') {
        const currentBody = getBodyMarkdown();
        await apiPatch(`/admin/drafts/${draft.id}`, {
          subject,
          bodyMarkdown: currentBody,
          name: draftNameEdit.trim(),
        });
      }
      const result = (await apiPost(`/admin/drafts/${draft.id}/duplicate`)) as { draftId?: string };
      const newId = result?.draftId;
      if (!newId) throw new Error('Duplicate did not return a draft id');
      const d = await apiGet<Draft>(`/admin/drafts/${newId}`);
      setDraft(d);
      setSubject(d.subject ?? '');
      setBodyMarkdown(d.bodyMarkdown ?? '');
      setPreviewBodyMarkdown(null);
      setEditorVersion((v) => v + 1);
      await loadDraftList();
      setMessage(
        draft.status === 'sent'
          ? 'Duplicated from the saved sent version. You are now editing the new copy.'
          : 'Draft duplicated (your latest edits were saved into the copy). You are now editing the new copy.',
      );
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDuplicating(false);
    }
  }, [draft, draftNameEdit, getBodyMarkdown, subject, loadDraftList]);

  /** Server list is last 4 weeks only; include open draft if older so the select stays valid. */
  const draftListForSelect = useMemo((): DraftSummary[] => {
    const base = draftList.slice();
    if (draft && !base.some((x) => x.id === draft.id)) {
      base.push({
        id: draft.id,
        weekKey: draft.weekKey,
        status: draft.status,
        name: draft.name,
        subject: draft.subject,
        generatedAt: draft.generatedAt,
        memoRangeStart: draft.memoRangeStart,
        memoRangeEnd: draft.memoRangeEnd,
      });
    }
    base.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
    return base;
  }, [draft, draftList]);

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
    void load();
  }, [authReady, load]);

  useEffect(() => {
    if (draft) {
      setSubject(draft.subject ?? '');
      setBodyMarkdown(draft.bodyMarkdown ?? '');
      setDraftNameEdit(draft.name ?? '');
      loadPreviewBody(draft.id);
      loadMediaCandidates(draft.id);
      setEditorVersion(v => v + 1);
    }
  }, [draft?.id]);

  const saveRenameFromModal = useCallback(async () => {
    if (!draft) return;
    const next = renameModalValue.trim();
    const prev = (draft.name ?? '').trim();
    if (next === prev) {
      setShowRenameModal(false);
      return;
    }
    setSavingRename(true);
    setMessage(null);
    try {
      const updated = (await apiPatch(`/admin/drafts/${draft.id}`, { name: next })) as Draft;
      setDraft(updated);
      setDraftNameEdit(updated.name ?? '');
      await loadDraftList();
      setShowRenameModal(false);
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingRename(false);
    }
  }, [draft, renameModalValue, loadDraftList]);

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
      await loadDraftList();
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGenerating(false);
      setShowGenerateModal(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const currentBody = getBodyMarkdown();
      if (draft.status === 'sent') {
        await apiPatch(`/admin/drafts/${draft.id}`, { name: draftNameEdit.trim() });
      } else {
        await apiPatch(`/admin/drafts/${draft.id}`, {
          subject,
          bodyMarkdown: currentBody,
          name: draftNameEdit.trim(),
        });
      }
      setMessage('Saved.');
      const updated = await apiGet<Draft>(`/admin/drafts/${draft.id}`);
      setDraft(updated);
      setSubject(updated.subject ?? '');
      setBodyMarkdown(updated.bodyMarkdown ?? '');
      setDraftNameEdit(updated.name ?? '');
      setPreviewBodyMarkdown(null);
      loadPreviewBody(updated.id);
      setEditorVersion(v => v + 1);
      await loadDraftList();
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
      await apiPatch(`/admin/drafts/${draft.id}`, {
        subject,
        bodyMarkdown: currentBody,
        name: draftNameEdit.trim(),
      });
      const result = await apiPost(`/admin/drafts/${draft.id}/chat`, {
        message: chatMessage.trim(),
        provider: llmProvider,
      }) as { subject: string; bodyMarkdown: string };
      setSubject(result.subject);
      setBodyMarkdown(result.bodyMarkdown);
      setEditorVersion(v => v + 1);
      setChatMessage('');
      setMessage('Draft updated. You can edit further or ask again.');
      await loadDraftList();
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
      setDraftNameEdit(updated.name ?? '');
      await loadDraftList();
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 gap-y-2">
          <h1 className="text-2xl font-semibold">Newsletter</h1>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowGenerateModal(true)}
              disabled={generating}
              className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate'}
            </button>
            {draft ? (
              <>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || chatLoading}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {draft.status !== 'sent' ? (
                  <button
                    type="button"
                    onClick={openSendNow}
                    className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                  >
                    Send
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm font-medium text-slate-700">AI model:</span>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
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
          </div>
        </div>

        {(generating || chatLoading) && (
          <NewsletterWorkingBanner mode={chatLoading ? 'agent' : 'generating'} />
        )}

        {draftListForSelect.length > 0 && (
          <div className="mb-5 flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="draft-list-select"
                aria-label="Choose draft"
                value={draft?.id ?? ''}
                disabled={
                  !!openingDraftId ||
                  draftListLoading ||
                  duplicating ||
                  savingRename ||
                  chatLoading ||
                  generating
                }
                onChange={(e) => {
                  const id = e.target.value;
                  if (id && id !== draft?.id) void openDraftById(id);
                }}
                className="min-w-[12rem] flex-1 max-w-md rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-50"
              >
                {!draft ? (
                  <option value="" disabled>
                    Select draft…
                  </option>
                ) : null}
                {draftListForSelect.map((d) => (
                  <option key={d.id} value={d.id}>
                    {formatDraftOptionLabel(d)}
                  </option>
                ))}
              </select>
              {openingDraftId ? <span className="text-xs text-slate-500">Opening…</span> : null}
              {draft ? (
                <button
                  type="button"
                  onClick={() => void duplicateOpenDraft()}
                  disabled={
                    duplicating ||
                    !!openingDraftId ||
                    deletingDraft ||
                    savingRename ||
                    chatLoading ||
                    generating
                  }
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {duplicating ? 'Duplicating…' : 'Duplicate'}
                </button>
              ) : null}
              {draft ? (
                <button
                  type="button"
                  onClick={() => {
                    setRenameModalValue(draft.name ?? '');
                    setShowRenameModal(true);
                  }}
                  disabled={
                    !!openingDraftId || duplicating || deletingDraft || savingRename || chatLoading || generating
                  }
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Rename
                </button>
              ) : null}
              {draft && draft.status !== 'sent' ? (
                <button
                  type="button"
                  onClick={() => void deleteOpenDraft()}
                  disabled={
                    deletingDraft || !!openingDraftId || savingRename || chatLoading || generating
                  }
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  {deletingDraft ? 'Deleting…' : 'Delete'}
                </button>
              ) : null}
            </div>
            {draft ? <DraftMemoRangeBlurb draft={draft} /> : null}
          </div>
        )}

        {!draft ? (
          <div className="border border-slate-200 rounded-lg p-6 bg-slate-50">
            {generating ? (
              <div className="flex flex-col items-center justify-center gap-4 py-8 text-center" role="status" aria-live="polite">
                <DraftWorkingGlyph size="lg" />
                <div>
                  <p className="font-medium text-slate-800 flex items-center justify-center gap-2 flex-wrap">
                    Generating your draft
                    <BouncingDots />
                  </p>
                  <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
                    Memos are being read and turned into this week&apos;s newsletter. You&apos;ll see it here when
                    it&apos;s ready.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <p className="text-slate-700">
                  {draftListForSelect.length > 0
                    ? 'Select a draft above, or use Generate (top right) to create one from your memos.'
                    : 'No drafts in the last four weeks. Use Generate (top right) to create one from your memos.'}
                </p>
                {message && <p className="text-sm text-slate-600 mt-3">{message}</p>}
              </>
            )}
          </div>
        ) : (
          <>
            {message && <p className="text-sm text-slate-600 mb-4">{message}</p>}

            <div className="relative">
            <div
              className={`grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start ${chatLoading || generating ? 'pointer-events-none select-none' : ''}`}
            >
              <div className="space-y-4">
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
                    The agent sees the full transcripts for memos linked to this draft (same set as when it
                    was generated, or the memo date range if older). Ask it to elaborate or pull in
                    details—it should stick to what is actually in those memos. Describe edits (e.g. “Expand
                    the park day paragraph using the memo” or “More casual tone”).
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
            {(chatLoading || generating) && (
              <div
                className="absolute inset-0 z-20 flex items-start justify-center pt-[min(8rem,15vh)] rounded-lg bg-white/75 backdrop-blur-[3px]"
                role="status"
                aria-live="polite"
                aria-busy="true"
              >
                <div className="mx-4 flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-violet-200 bg-white/95 px-8 py-7 text-center shadow-lg shadow-violet-200/50">
                  <DraftWorkingGlyph size="lg" />
                  <div>
                    <p className="font-medium text-slate-800 flex items-center justify-center gap-2 flex-wrap">
                      {chatLoading ? (
                        <>
                          Agent is editing your draft
                          <BouncingDots />
                        </>
                      ) : (
                        <>
                          Generating a new draft
                          <BouncingDots />
                        </>
                      )}
                    </p>
                    <p className="text-xs text-slate-600 mt-2">
                      {chatLoading
                        ? 'Rewriting from your instructions and memo transcripts—almost there.'
                        : 'This screen will refresh when the new draft is ready. Memos are being read and written up.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
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
        {showGenerateModal && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={(e) => e.target === e.currentTarget && !generating && setShowGenerateModal(false)}
          >
            <div
              className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold text-slate-800 mb-2">Generate draft from memos</h2>
              <p className="text-slate-600 text-sm mb-4">
                Choose which memo dates to include. A new draft will be created from memos in that range.
              </p>
              <div className="flex flex-wrap items-center gap-4 mb-2">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="generate-modal-from"
                    className="text-sm font-bold text-slate-900 whitespace-nowrap"
                  >
                    From
                  </label>
                  <input
                    id="generate-modal-from"
                    type="date"
                    value={generateStartDate}
                    onChange={(e) => setGenerateStartDate(e.target.value)}
                    disabled={generating}
                    className="border rounded-lg px-2 py-1.5 text-sm disabled:opacity-50"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="generate-modal-to" className="text-sm font-bold text-slate-900 whitespace-nowrap">
                    To
                  </label>
                  <input
                    id="generate-modal-to"
                    type="date"
                    value={generateEndDate}
                    onChange={(e) => setGenerateEndDate(e.target.value)}
                    disabled={generating}
                    className="border rounded-lg px-2 py-1.5 text-sm disabled:opacity-50"
                  />
                </div>
              </div>
              <p className="mb-6 text-xs text-slate-600">
                Memos from{' '}
                <span className="font-bold text-slate-900">
                  {formatMemoRangeDate(`${generateStartDate}T12:00:00`)}
                  {' – '}
                  {formatMemoRangeDate(`${generateEndDate}T12:00:00`)}
                </span>
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowGenerateModal(false)}
                  disabled={generating}
                  className="px-4 py-2 border rounded-lg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void generateDraft()}
                  disabled={generating}
                  className="px-4 py-2 bg-slate-700 text-white rounded-lg disabled:opacity-50"
                >
                  {generating ? 'Generating…' : 'Generate draft'}
                </button>
              </div>
              {generating && (
                <div
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-white/93 backdrop-blur-[2px] px-8 py-10 text-center"
                  role="status"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <DraftWorkingGlyph size="lg" />
                  <p className="mt-5 font-medium text-slate-800 flex flex-wrap items-center justify-center gap-2">
                    Weaving your newsletter from memos
                    <BouncingDots />
                  </p>
                  <p className="text-xs text-slate-600 mt-2 max-w-xs">
                    The model is reading your memos and drafting—usually well under a minute.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        {showRenameModal && draft && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={(e) => e.target === e.currentTarget && !savingRename && setShowRenameModal(false)}
          >
            <div
              className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold text-slate-800 mb-2">Rename draft</h2>
              <p className="text-slate-600 text-sm mb-4">
                This label appears in the draft list. Leave it empty to use the generated date instead.
              </p>
              <label htmlFor="rename-modal-input" className="block text-sm font-medium text-slate-700 mb-1">
                Name
              </label>
              <input
                id="rename-modal-input"
                type="text"
                autoFocus
                value={renameModalValue}
                onChange={(e) => setRenameModalValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && !savingRename) setShowRenameModal(false);
                  if (e.key === 'Enter' && !savingRename) void saveRenameFromModal();
                }}
                maxLength={200}
                disabled={savingRename}
                placeholder={
                  draft.generatedAt
                    ? new Date(draft.generatedAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })
                    : 'Draft name'
                }
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-6 disabled:opacity-50"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => !savingRename && setShowRenameModal(false)}
                  disabled={savingRename}
                  className="px-4 py-2 border border-slate-300 rounded-lg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveRenameFromModal()}
                  disabled={savingRename}
                  className="px-4 py-2 bg-slate-700 text-white rounded-lg disabled:opacity-50"
                >
                  {savingRename ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
