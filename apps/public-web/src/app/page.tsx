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

export default function HomePage() {
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
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white">
        <div className="max-w-2xl mx-auto px-4 py-4 flex justify-between items-center">
          <Link
            href="/subscribe"
            className="px-4 py-1.5 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors"
          >
            Subscribe
          </Link>
          <span className="font-semibold text-lg text-stone-800">Greg Chronicles</span>
        </div>
      </header>
      <main className="flex-1 max-w-2xl mx-auto px-4 py-12">
        <p className="text-stone-600 mb-8">
          Greg Chronicles is a weekly newsletter sharing life updates, ideas, and reflections.
        </p>
        {loading ? (
          <p className="text-stone-500">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-stone-500">No newsletters yet. Check back soon!</p>
        ) : (
          <ul className="space-y-4">
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/n/${n.publicSlug}`}
                  className="block p-4 rounded-lg border border-stone-200 hover:bg-stone-50 transition-colors"
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
