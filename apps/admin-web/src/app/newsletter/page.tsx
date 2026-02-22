'use client';

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

type Draft = {
  id: string;
  weekKey: string;
  status: string;
  subject: string;
  bodyMarkdown: string;
  bodyHtml?: string;
  generatedAt: string;
};

export default function NewsletterPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subject, setSubject] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    apiGet<Draft>('/admin/drafts/current')
      .then((d) => {
        setDraft(d);
        setSubject(d.subject ?? '');
        setBodyMarkdown(d.bodyMarkdown ?? '');
      })
      .catch(() => setDraft(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (draft) {
      setSubject(draft.subject ?? '');
      setBodyMarkdown(draft.bodyMarkdown ?? '');
    }
  }, [draft]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiPatch(`/admin/drafts/${draft.id}`, { subject, bodyMarkdown });
      setMessage('Saved.');
      load();
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
      setMessage('Approved. It will be sent on Sunday.');
      load();
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <p>Loading…</p>
      </AdminLayout>
    );
  }

  if (!draft) {
    return (
      <AdminLayout>
        <p>No draft yet. The Saturday job generates the draft; check back after it runs.</p>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Newsletter Review</h1>
        <p className="text-slate-600 mb-4">
          Week: {draft.weekKey} · Status: {draft.status} · Generated:{' '}
          {draft.generatedAt ? new Date(draft.generatedAt).toLocaleString() : '—'}
        </p>
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Body (Markdown)</label>
            <textarea
              value={bodyMarkdown}
              onChange={(e) => setBodyMarkdown(e.target.value)}
              rows={16}
              className="w-full border rounded-lg p-2 font-mono text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 bg-slate-600 text-white rounded-lg disabled:opacity-50"
            >
              Save edits
            </button>
            {draft.status !== 'sent' && (
              <button
                onClick={approve}
                disabled={saving}
                className="px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50"
              >
                Approve (send Sunday)
              </button>
            )}
          </div>
          {message && <p className="text-sm text-slate-600">{message}</p>}
        </div>
      </div>
    </AdminLayout>
  );
}
