'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function SubscribePage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'duplicate' | 'error'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(`${base}/api/public/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, ...(phone ? { phone, smsConsent } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Subscribe failed');

      if (data.message === 'Already subscribed') {
        setResult({ type: 'duplicate', text: 'You are already subscribed.' });
      } else {
        setResult({ type: 'success', text: 'You have been successfully subscribed.' });
      }
    } catch (err) {
      setResult({ type: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setSubmitting(false);
    }
  };

  const showForm = !result || result.type === 'error';

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white">
        <div className="max-w-2xl mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="font-semibold text-lg text-stone-800">
            Greg Chronicles
          </Link>
        </div>
      </header>
      <main className="flex-1 max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-semibold text-stone-800 mb-4">Subscribe</h1>
        <p className="text-stone-600 mb-8">
          Enter your email to receive Greg Chronicles in your inbox every week.
        </p>

        {showForm ? (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full border border-stone-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full border border-stone-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Phone (optional)</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full border border-stone-300 rounded-lg px-3 py-2"
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={smsConsent}
                onChange={(e) => setSmsConsent(e.target.checked)}
              />
              <span className="text-sm text-stone-600">I consent to receive SMS notifications (link to new edition)</span>
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2 bg-stone-800 text-white rounded-lg disabled:opacity-50 hover:bg-stone-700 transition-colors"
            >
              {submitting ? 'Subscribing…' : 'Subscribe'}
            </button>
            {result?.type === 'error' && (
              <p className="text-sm text-red-600">{result.text}</p>
            )}
          </form>
        ) : (
          <div>
            <p className="text-stone-700 font-medium mb-6">{result?.text}</p>
            <Link
              href="/"
              className="px-6 py-2 bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors"
            >
              Take me back to articles
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
