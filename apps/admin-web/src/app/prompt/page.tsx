'use client';

import { useEffect, useState, useRef } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { apiGet, apiPost } from '@/lib/api';

type ActivePrompt = {
  id: string | null;
  systemPrompt: string;
  notes?: string;
  isDefault?: boolean;
};

type TestResult = {
  raw: string;
  subject: string | null;
  bodyMarkdown: string;
  bodyHtml?: string;
};

export default function PromptPage() {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);

  const load = () => {
    setLoading(true);
    apiGet<ActivePrompt>('/admin/prompts/active')
      .then((active) => {
        setSystemPrompt(active.systemPrompt ?? '');
        setNotes(active.notes ?? '');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const iframe = previewIframeRef.current;
    const html = testResult?.bodyHtml ?? testResult?.bodyMarkdown;
    if (!iframe || !html) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Georgia,"Times New Roman",serif;background:#fafaf8;color:#222;margin:0;padding:24px;font-size:14px;line-height:1.5}a{color:#333;text-decoration:underline}</style></head><body><div style="max-width:600px;margin:0 auto">${html.replace(/<script\b[\s\S]*?<\/script>/gi, '')}</div></body></html>`
    );
    doc.close();
  }, [testResult]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await apiPost('/admin/prompts', { systemPrompt, notes });
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

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const result = (await apiPost('/admin/prompts/test', { systemPrompt })) as TestResult;
      setTestResult(result);
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
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
        <h1 className="text-2xl font-semibold mb-4">Prompt Editor</h1>
        <p className="text-slate-600 mb-4">
          Edit the system prompt. The Saturday draft job uses the active prompt with a fixed user template (memos + context). Save to set as active.
        </p>
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">System prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={10}
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
          <h2 className="text-lg font-medium mb-2">Test prompt</h2>
          <p className="text-sm text-slate-600 mb-3">
            Run the current system prompt with fake memos and context to see sample output. Uses the same format as the Saturday job.
          </p>
          <button
            type="button"
            onClick={runTest}
            disabled={testing || !systemPrompt.trim()}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg disabled:opacity-50 hover:bg-emerald-700"
          >
            {testing ? 'Testing…' : 'Run test'}
          </button>
          {testError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
              {testError}
            </div>
          )}
          {testResult && (
            <div className="mt-4 space-y-4">
              {testResult.subject && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subject (email subject line)</label>
                  <p className="p-2 bg-slate-100 rounded font-medium">{testResult.subject}</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Preview: How it looks to recipients
                </label>
                <div className="mt-1 overflow-hidden rounded border border-stone-300 bg-[#fafaf8]">
                  {(testResult.bodyHtml ?? testResult.bodyMarkdown) ? (
                    <iframe
                      ref={previewIframeRef}
                      title="Newsletter preview"
                      className="w-full border-0 h-[32rem]"
                      sandbox="allow-same-origin"
                    />
                  ) : (
                    <pre className="p-8 whitespace-pre-wrap text-sm text-slate-600 max-h-[32rem] overflow-auto">
                      {testResult.bodyMarkdown}
                    </pre>
                  )}
                </div>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-slate-600 hover:text-slate-800">
                  Raw source (bodyMarkdown)
                </summary>
                <pre className="mt-2 p-4 bg-slate-100 rounded text-xs overflow-auto max-h-48 whitespace-pre-wrap">
                  {testResult.bodyMarkdown}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
