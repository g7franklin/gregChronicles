'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type NewsletterItem = {
  id: string;
  weekKey: string;
  sentAt: string;
  subject: string;
  publicSlug: string;
};

export default function ArchivePage() {
  const [items, setItems] = useState<NewsletterItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    fetch(`${base}/api/public/newsletters`)
      .then((r) => r.json())
      .then((data) => setItems(data.newsletters ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="max-w-2xl mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="font-semibold text-lg text-stone-800">
            Life Newsletter
          </Link>
          <Link href="/archive" className="text-stone-600 hover:underline text-sm">
            Archive
          </Link>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold text-stone-800 mb-6">Archive</h1>
        {loading ? (
          <p className="text-stone-500">Loading…</p>
        ) : (
          <ul className="space-y-4">
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/n/${n.publicSlug}`}
                  className="block p-4 rounded-lg border border-stone-200 hover:bg-stone-50"
                >
                  <span className="font-medium text-stone-800">{n.subject}</span>
                  <span className="block text-sm text-stone-500 mt-1">
                    {n.sentAt ? new Date(n.sentAt).toLocaleDateString() : n.weekKey}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
