'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/AdminLayout';
import { apiGet } from '@/lib/api';

type Memo = {
  id: string;
  createdAt: string;
  transcript: string;
  title?: string;
  attachments?: Array<{ id: string; type: string; originalName: string }>;
};

export default function MemosPage() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [query, setQuery] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    apiGet<{ memos: Memo[] }>(`/admin/memos?${params}`)
      .then((r) => setMemos(r.memos))
      .catch(() => setMemos([]))
      .finally(() => setLoading(false));
  }, [query, start, end]);

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Memos</h1>
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
                  {m.title || m.id}
                </Link>
                <p className="text-sm text-slate-500 mt-1">
                  {new Date(m.createdAt).toLocaleString()}
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
