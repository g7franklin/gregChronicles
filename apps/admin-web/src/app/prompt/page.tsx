'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { getAuth } from '@/lib/firebase';
import { apiGet, apiPost } from '@/lib/api';

type LatestPrompt = {
  id: string;
  systemPrompt: string;
  createdAt?: string;
};

type TestResult = {
  raw: string;
  subject: string | null;
  bodyMarkdown: string;
  bodyHtml?: string;
};

export default function PromptPage() {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [llmProvider, setLlmProvider] = useState<'claude' | 'grok'>('grok');
  const [message, setMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback((opts?: { mode?: 'full' | 'quiet' }) => {
    const quiet = opts?.mode === 'quiet';
    if (!quiet) {
      setLoading(true);
      setMessage(null);
      setSuccessNotice(null);
    }
    return apiGet<LatestPrompt>('/admin/prompts/latest')
      .then((latest) => {
        setSystemPrompt(typeof latest.systemPrompt === 'string' ? latest.systemPrompt : '');
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('No prompt versions yet')) {
          setSystemPrompt('');
          return;
        }
        setMessage(msg);
      })
      .finally(() => {
        if (!quiet) setLoading(false);
      });
  }, []);

  // Wait for Firebase to restore the session before calling the API (otherwise no Bearer token is sent).
  useEffect(() => {
    const auth = getAuth();
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    void load();
  }, [authReady, load]);

  useEffect(() => {
    if (!successNotice) return;
    const id = window.setTimeout(() => setSuccessNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [successNotice]);

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
    setSuccessNotice(null);
    try {
      await apiPost('/admin/prompts', { systemPrompt });
      await load({ mode: 'quiet' });
      setSuccessNotice('Prompt saved. It will be used the next time you generate a draft.');
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
      const result = (await apiPost('/admin/prompts/test', { systemPrompt, provider: llmProvider })) as TestResult;
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
          Edit the system prompt here only—nothing is loaded from the codebase. The editor always shows your most recently
          saved version. Draft generation uses that latest save (plus a fixed memo/context template on the server).
        </p>
        {successNotice && (
          <div
            className="fixed top-4 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm text-white shadow-lg"
            role="status"
            aria-live="polite"
          >
            {successNotice}
          </div>
        )}
        {message && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-900 text-sm" role="alert">
            {message}
          </div>
        )}

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
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-slate-800 text-white rounded-lg disabled:opacity-50"
            >
              Save new version
            </button>
          </div>
        </form>

        <div className="mt-8 border-t pt-6">
          <h2 className="text-lg font-medium mb-2">Test prompt</h2>
          <p className="text-sm text-slate-600 mb-3">
            Run the current system prompt with fake memos and context to see sample output. Uses the same format as the Saturday job.
          </p>
          <div className="flex items-center gap-3 mb-3">
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
