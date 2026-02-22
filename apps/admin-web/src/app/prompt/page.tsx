'use client';

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { apiGet, apiPost } from '@/lib/api';

type ActivePrompt = {
  id: string | null;
  systemPrompt: string;
  userPromptTemplate: string;
  notes?: string;
  isDefault?: boolean;
  placeholders?: string[];
};

export default function PromptPage() {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPromptTemplate, setUserPromptTemplate] = useState('');
  const [notes, setNotes] = useState('');
  const [placeholders, setPlaceholders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [previewVars, setPreviewVars] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([
      apiGet<ActivePrompt>('/admin/prompts/active'),
      apiGet<{ placeholders: string[] }>('/admin/prompts/placeholders').catch(() => ({ placeholders: [] })),
    ])
      .then(([active, pl]) => {
        setSystemPrompt(active.systemPrompt ?? '');
        setUserPromptTemplate(active.userPromptTemplate ?? '');
        setNotes(active.notes ?? '');
        setPlaceholders(pl.placeholders ?? []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await apiPost('/admin/prompts', { systemPrompt, userPromptTemplate, notes });
      setMessage('Saved and set as active.');
      load();
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const resetDefault = async () => {
    if (!confirm('Replace current prompt with the default?')) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiPost('/admin/prompts/reset-default');
      setMessage('Reset to default.');
      load();
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const updatePreview = () => {
    let out = userPromptTemplate;
    out = out.replace(/\{\{WEEK_RANGE\}\}/g, '2026-02-15 to 2026-02-22');
    out = out.replace(/\{\{MEMOS_JSON\}\}/g, '[{"id":"m1","transcript":"Sample memo..."}]');
    out = out.replace(/\{\{CONTEXT_NEWSLETTERS_JSON\}\}/g, '[{"subject":"Last week"}]');
    out = out.replace(/\{\{STYLE_GUIDELINES\}\}/g, '(optional style notes)');
    setPreviewVars(out);
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
        <h1 className="text-2xl font-semibold mb-4">Prompt Editor</h1>
        <p className="text-slate-600 mb-4">
          The Saturday draft job loads the latest active prompt. Edit and save to use a new version.
        </p>
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">System prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={8}
              className="w-full border rounded-lg p-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">User prompt template</label>
            <p className="text-xs text-slate-500 mb-1">
              Placeholders: {placeholders.join(', ')}
            </p>
            <textarea
              value={userPromptTemplate}
              onChange={(e) => setUserPromptTemplate(e.target.value)}
              rows={14}
              className="w-full border rounded-lg p-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border rounded-lg p-2"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-slate-800 text-white rounded-lg disabled:opacity-50"
            >
              Save & set active
            </button>
            <button
              type="button"
              onClick={resetDefault}
              disabled={saving}
              className="px-4 py-2 bg-slate-500 text-white rounded-lg disabled:opacity-50"
            >
              Reset to default
            </button>
          </div>
          {message && <p className="text-sm text-slate-600">{message}</p>}
        </form>
        <div className="mt-8 border-t pt-6">
          <h2 className="text-lg font-medium mb-2">Preview variables</h2>
          <p className="text-sm text-slate-600 mb-2">
            Example of how the user prompt will look with sample data injected.
          </p>
          <button
            type="button"
            onClick={updatePreview}
            className="px-3 py-1 bg-slate-200 rounded text-sm mb-2"
          >
            Generate preview
          </button>
          {previewVars && (
            <pre className="bg-slate-100 p-4 rounded text-xs overflow-auto max-h-64 whitespace-pre-wrap">
              {previewVars}
            </pre>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
