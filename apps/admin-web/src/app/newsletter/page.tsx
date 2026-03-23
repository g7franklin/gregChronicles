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
  const editorRef = useRef<HTMLDivElement>(null);

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
      setEditorVersion(v => v + 1);
    }
  }, [draft?.id]);

  /**
   * Sanitize video tags in HTML before rendering:
   * - Remove autoplay/loop/muted so videos don't load or play until clicked
   * - Add controls, playsinline, preload="none"
   * An IntersectionObserver later upgrades preload to "metadata" when the
   * video scrolls into view, so the first frame shows without blocking page load.
   */
  /** Convert **text** to <strong> so LLM output renders bold in preview. */
  function markdownBoldToHtml(html: string): string {
    return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function sanitizeVideoHtml(html: string): string {
    return html.replace(/<video\b([^>]*)>/gi, (_match, attrs: string) => {
      let cleaned = attrs
        .replace(/\s*(autoplay|loop|muted)\b/gi, '')
        .replace(/\s*preload=["'][^"']*["']/gi, '');
      if (!/controls/i.test(cleaned)) cleaned += ' controls';
      if (!/playsinline/i.test(cleaned)) cleaned += ' playsinline';
      cleaned += ' preload="none"';
      return `<video${cleaned}>`;
    });
  }

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
      setMessage('Marked ready for Sunday. It will be sent Sunday at 6 AM.');
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
      setMessage('Draft set back to pending approval. It will not be sent Sunday.');
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
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Newsletter Draft</h1>
        <p className="text-slate-600 mb-4">
          Generate a draft from your memos, edit it (by hand or with the agent), then save as ready
          for Sunday 6 AM or send now.
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
                  ✓ Approved for Sunday — This draft will be sent on the planned date.
                </p>
                <p className="mt-1 text-sm font-medium text-green-800">
                  Planned send: {draft.plannedSendLabel ?? `Week ${draft.weekKey} (Sunday 6 AM)`}
                </p>
                <p className="mt-0.5 text-sm text-green-700">
                  Week: {draft.weekKey} · Generated: {draft.generatedAt ? new Date(draft.generatedAt).toLocaleString() : '—'}
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
                  Pending approval — This draft will not be sent until you approve it.
                </p>
                <p className="mt-1 text-sm font-medium text-amber-900">
                  If approved, planned send: {draft.plannedSendLabel ?? `Week ${draft.weekKey} (Sunday 6 AM)`}
                </p>
                <p className="mt-0.5 text-sm text-amber-800">
                  Week: {draft.weekKey} · Generated: {draft.generatedAt ? new Date(draft.generatedAt).toLocaleString() : '—'}
                </p>
              </div>
            )}

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
              {draft.status !== 'sent' && draft.status !== 'approved' && (
                <button
                  onClick={approve}
                  disabled={saving}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50"
                >
                  Save as ready for Sunday
                </button>
              )}
              {draft.status === 'approved' && (
                <button
                  onClick={unapprove}
                  disabled={saving}
                  className="px-4 py-2 bg-slate-500 text-white rounded-lg hover:bg-slate-600 disabled:opacity-50"
                >
                  Unapprove (back to pending)
                </button>
              )}
              {draft.status !== 'sent' && (
                <button
                  onClick={openSendNow}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                >
                  Send now (manual)
                </button>
              )}
            </div>
            {message && <p className="text-sm text-slate-600 mb-4">{message}</p>}

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
                            ? sanitizeVideoHtml(markdownBoldToHtml(bodyMarkdown))
                            : `<div style="white-space:pre-wrap;font-family:sans-serif;color:#44403c;font-size:0.875rem">${bodyMarkdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
                          return (
                            <div
                              key={editorVersion}
                              ref={editorRef}
                              contentEditable
                              suppressContentEditableWarning
                              className="newspaper-content max-w-[600px] mx-auto [&_a]:text-stone-700 [&_a]:underline [&_a:hover]:text-stone-900 focus:outline-none cursor-text [&_*]:cursor-text"
                              dangerouslySetInnerHTML={{ __html: content }}
                              onClick={(e) => {
                                const target = e.target as HTMLElement;
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
                            const html = sanitizeVideoHtml(markdownBoldToHtml(raw));
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
                This will create a new draft from your memos. Your current draft will still
                exist but will no longer be shown as the current week&apos;s draft.
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
