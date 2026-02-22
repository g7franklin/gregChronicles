'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function HomePage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(`${base}/api/public/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, smsConsent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Subscribe failed');
      setMessage('Thanks! You’re subscribed.');
      setName('');
      setEmail('');
      setPhone('');
      setSmsConsent(false);
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white">
        <div className="max-w-2xl mx-auto px-4 py-4 flex justify-between items-center">
          <span className="font-semibold text-lg">Life Newsletter</span>
          <Link href="/archive" className="text-stone-600 hover:underline text-sm">
            Archive
          </Link>
        </div>
      </header>
      <main className="flex-1 max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-semibold text-stone-800 mb-4">
          A weekly personal newsletter
        </h1>
        <p className="text-stone-600 mb-8">
          One person’s week in notes, voice memos, and short updates—delivered every Sunday.
        </p>
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
            className="px-6 py-2 bg-stone-800 text-white rounded-lg disabled:opacity-50"
          >
            {submitting ? 'Subscribing…' : 'Subscribe'}
          </button>
          {message && <p className="text-sm text-stone-600">{message}</p>}
        </form>
      </main>
    </div>
  );
}
