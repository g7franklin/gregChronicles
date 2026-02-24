'use client';

import { useEffect, useState, useCallback } from 'react';
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
    }
  }, [draft?.id]);

  const generateDraft = async () => {
    setGenerating(true);
    setMessage(null);
    try {
      const result = (await apiPost('/admin/drafts/generate')) as { draftId?: string };
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
      await apiPatch(`/admin/drafts/${draft.id}`, { subject, bodyMarkdown });
      setMessage('Saved.');
      const updated = await apiGet<Draft>(`/admin/drafts/${draft.id}`);
      setDraft(updated);
      setSubject(updated.subject ?? '');
      setBodyMarkdown(updated.bodyMarkdown ?? '');
      setPreviewBodyMarkdown(null);
      loadPreviewBody(updated.id);
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
      await apiPost(`/admin/drafts/${draft.id}/approve`);
      setMessage('Marked ready for Sunday. It will be sent Sunday at 6 AM.');
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
      const result = await apiPost(`/admin/drafts/${draft.id}/chat`, {
        message: chatMessage.trim(),
      }) as { subject: string; bodyMarkdown: string };
      setSubject(result.subject);
      setBodyMarkdown(result.bodyMarkdown);
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

        {!draft ? (
          <div className="border border-slate-200 rounded-lg p-6 bg-slate-50">
            <p className="text-slate-700 mb-4">
              No draft yet. Generate one from the last 7 days of memos (same content the Saturday job
              uses).
            </p>
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
                onClick={generateDraft}
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
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Body (Markdown / HTML)
                </label>
                <textarea
                  value={bodyMarkdown}
                  onChange={(e) => setBodyMarkdown(e.target.value)}
                  rows={16}
                  className="w-full border rounded-lg p-2 font-mono text-sm"
                />
              </div>

              <div className="border border-slate-200 rounded-lg p-4 bg-white">
                <h2 className="text-lg font-medium text-slate-800 mb-2">Preview (what viewers will see)</h2>
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
                      const html = previewBodyMarkdown ?? bodyMarkdown;
                      const isHtml = /^\s*</.test(html) || html.includes('<div') || html.includes('<p') || html.includes('<table');
                      return isHtml ? (
                        <div
                          className="newspaper-content max-w-[600px] mx-auto [&_a]:text-stone-700 [&_a]:underline [&_a:hover]:text-stone-900"
                          dangerouslySetInnerHTML={{ __html: html }}
                        />
                      ) : (
                        <pre className="whitespace-pre-wrap font-sans text-stone-700 text-sm">
                          {html}
                        </pre>
                      );
                    })()
                  ) : (
                    <p className="text-stone-500">No content yet.</p>
                  )}
                </div>
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
      </div>
    </AdminLayout>
  );
}
