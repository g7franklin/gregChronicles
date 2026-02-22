'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

type Newsletter = {
  id: string;
  subject: string;
  sentAt: string;
  bodyMarkdown?: string;
  bodyHtml?: string;
  publicSlug: string;
};

export default function NewsletterPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [newsletter, setNewsletter] = useState<Newsletter | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    fetch(`${base}/api/public/newsletters/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then(setNewsletter)
      .catch(() => setNewsletter(null))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  if (!newsletter) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-stone-600">Newsletter not found.</p>
        <Link href="/archive" className="text-stone-800 underline">
          Back to archive
        </Link>
      </div>
    );
  }

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
      <article className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold text-stone-800 mb-2">{newsletter.subject}</h1>
        <p className="text-sm text-stone-500 mb-8">
          {newsletter.sentAt ? new Date(newsletter.sentAt).toLocaleDateString() : ''}
        </p>
        <div
          className="prose prose-stone max-w-none"
          dangerouslySetInnerHTML={
            newsletter.bodyHtml
              ? { __html: newsletter.bodyHtml }
              : undefined
          }
        />
        {!newsletter.bodyHtml && newsletter.bodyMarkdown && (
          <pre className="whitespace-pre-wrap font-sans text-stone-700">
            {newsletter.bodyMarkdown}
          </pre>
        )}
      </article>
    </div>
  );
}
