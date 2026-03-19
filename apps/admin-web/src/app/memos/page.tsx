'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/AdminLayout';
import { apiGet, apiPostFormData } from '@/lib/api';

type Memo = {
  id: string;
  createdAt: string;
  transcript: string;
  title?: string;
  attachments?: Array<{ id: string; type: string; originalName: string }>;
};

type AttachmentFile = { file: File; id: string };

export default function MemosPage() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [query, setQuery] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNewMemo, setShowNewMemo] = useState(false);
  const [newTranscript, setNewTranscript] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newAttachmentSummary, setNewAttachmentSummary] = useState('');
  const [newAttachments, setNewAttachments] = useState<AttachmentFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const formatRecordedAt = (iso: string): string =>
    new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  const loadMemos = useCallback(() => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    setLoading(true);
    apiGet<{ memos: Memo[] }>(`/admin/memos?${params}`)
      .then((r) => setMemos(r.memos))
      .catch(() => setMemos([]))
      .finally(() => setLoading(false));
  }, [query, start, end]);

  useEffect(() => {
    loadMemos();
  }, [loadMemos]);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ok =
        f.type.startsWith('image/') ||
        f.type.startsWith('audio/') ||
        f.type.startsWith('video/');
      if (ok) {
        setNewAttachments((prev) => [...prev, { file: f, id: Math.random().toString(36).slice(2) }]);
      }
    }
  }, []);

  const removeAttachment = (id: string) => {
    setNewAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const submitNewMemo = async () => {
    setSubmitting(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('transcript', newTranscript);
      if (newTitle) form.append('title', newTitle);
      if (newAttachmentSummary) form.append('attachmentSummary', newAttachmentSummary);
      newAttachments.forEach((a) => {
        form.append('attachments', a.file, a.file.name);
      });
      await apiPostFormData('/admin/memos', form);
      setMessage('Memo created.');
      setNewTranscript('');
      setNewTitle('');
      setNewAttachmentSummary('');
      setNewAttachments([]);
      loadMemos();
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Memos</h1>

        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowNewMemo((v) => !v)}
            className="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700"
          >
            {showNewMemo ? 'Hide new memo' : 'New memo (with photos)'}
          </button>
        </div>

        {showNewMemo && (
          <div className="border border-slate-200 rounded-lg p-4 mb-6 bg-slate-50">
            <h2 className="text-lg font-medium mb-3">Create memo</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Transcript / notes</label>
                <textarea
                  value={newTranscript}
                  onChange={(e) => setNewTranscript(e.target.value)}
                  rows={3}
                  className="w-full border rounded-lg p-2"
                  placeholder="What’s this memo about?"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title (optional)</label>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full border rounded-lg p-2"
                  placeholder="Short title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Attachment summary (optional)</label>
                <input
                  value={newAttachmentSummary}
                  onChange={(e) => setNewAttachmentSummary(e.target.value)}
                  className="w-full border rounded-lg p-2"
                  placeholder="e.g. Photos from the hike"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Photos / attachments</label>
                <input
                  id="memo-photo-upload"
                  type="file"
                  accept="image/*,.heic,.heif,audio/*,video/*"
                  multiple
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-sky-50 file:text-sky-700"
                  onChange={(e) => addFiles(e.target.files)}
                />
                {newAttachments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {newAttachments.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 text-sm">
                        <span className="text-slate-600">{a.file.name}</span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(a.id)}
                          className="text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2 items-center">
                <button
                  type="button"
                  onClick={submitNewMemo}
                  disabled={submitting || !newTranscript.trim()}
                  className="px-4 py-2 bg-sky-600 text-white rounded-lg disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Save memo'}
                </button>
                {message && <span className="text-sm text-slate-600">{message}</span>}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-4 mb-4">
          <input
            type="search"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border rounded px-2 py-1"
          />
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="border rounded px-2 py-1"
          />
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="border rounded px-2 py-1"
          />
        </div>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <ul className="space-y-2">
            {memos.map((m) => (
              <li key={m.id} className="border rounded-lg p-3 bg-white">
                <Link href={`/memos/${m.id}`} className="font-medium text-sky-600 hover:underline">
                  {formatRecordedAt(m.createdAt)}
                </Link>
                <p className="text-sm text-slate-500 mt-1">
                  {m.title || 'Untitled'}
                  {m.attachments?.length ? ` · ${m.attachments.length} attachment(s)` : ''}
                </p>
                <p className="text-slate-700 mt-1 line-clamp-2">
                  {(m.transcript || '').slice(0, 200)}
                  {(m.transcript?.length ?? 0) > 200 ? '…' : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminLayout>
  );
}
