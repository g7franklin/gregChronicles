'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminLayout from '@/components/AdminLayout';
import { apiGet } from '@/lib/api';

type Attachment = {
  id: string;
  type: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
};

type Memo = {
  id: string;
  createdAt: string;
  transcript: string;
  title?: string;
  attachmentSummary?: string;
  attachments?: Attachment[];
};

export default function MemoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [memo, setMemo] = useState<Memo | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    apiGet<Memo>(`/admin/memos/${id}`)
      .then(setMemo)
      .catch(() => setMemo(null));
  }, [id]);

  useEffect(() => {
    if (!memo?.attachments?.length) return;
    const load = async () => {
      const urls: Record<string, string> = {};
      for (const a of memo.attachments!) {
        try {
          const r = await apiGet<{ url: string }>(
            `/admin/memos/${id}/attachments/${a.id}/signedUrl`
          );
          urls[a.id] = r.url;
        } catch {
          urls[a.id] = '#';
        }
      }
      setSignedUrls(urls);
    };
    load();
  }, [id, memo?.attachments]);

  if (!memo) {
    return (
      <AdminLayout>
        <p>Loading…</p>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto">
        <Link href="/memos" className="text-sky-600 hover:underline mb-4 inline-block">
          ← Back to Memos
        </Link>
        <h1 className="text-2xl font-semibold">{memo.title || 'Memo'}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {new Date(memo.createdAt).toLocaleString()}
        </p>
        {memo.attachmentSummary && (
          <p className="text-slate-600 mt-2">{memo.attachmentSummary}</p>
        )}
        <div className="mt-4 prose max-w-none">
          <p className="whitespace-pre-wrap">{memo.transcript}</p>
        </div>
        {memo.attachments && memo.attachments.length > 0 && (
          <div className="mt-6">
            <h2 className="text-lg font-medium mb-2">Attachments</h2>
            <div className="space-y-4">
              {memo.attachments.map((a) => (
                <div key={a.id} className="border rounded-lg p-3 bg-white">
                  <p className="text-sm text-slate-600">
                    {a.originalName} ({a.type}, {(a.sizeBytes / 1024).toFixed(1)} KB)
                  </p>
                  {signedUrls[a.id] && (
                    <>
                      {a.type === 'audio' && (
                        <audio controls src={signedUrls[a.id]} className="mt-2 w-full max-w-md" />
                      )}
                      {a.type === 'video' && (
                        <video controls src={signedUrls[a.id]} className="mt-2 w-full max-w-md" />
                      )}
                      {a.type === 'image' && (
                        <img
                          src={signedUrls[a.id]}
                          alt={a.originalName}
                          className="mt-2 max-w-full h-auto max-h-96 rounded object-contain"
                        />
                      )}
                      <a
                        href={signedUrls[a.id]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-600 text-sm mt-2 inline-block"
                      >
                        Download
                      </a>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
