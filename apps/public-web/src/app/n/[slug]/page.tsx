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
        <Link href="/" className="text-stone-800 underline">
          Back to archive
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="font-semibold text-lg text-stone-800">
            Greg Chronicles
          </Link>
          <Link href="/subscribe" className="text-stone-600 hover:underline text-sm">
            Subscribe
          </Link>
        </div>
      </header>
      <article className="max-w-5xl mx-auto px-4 py-12">
        <div
          className="p-8 bg-[#fafaf8] border border-stone-300"
          style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
          }}
        >
          {newsletter.bodyHtml ? (
            <div
              className="newspaper-content [&_a]:text-stone-700 [&_a]:underline [&_a:hover]:text-stone-900"
              dangerouslySetInnerHTML={{ __html: newsletter.bodyHtml }}
            />
          ) : newsletter.bodyMarkdown ? (
            <pre className="whitespace-pre-wrap font-sans text-stone-700 text-sm">
              {newsletter.bodyMarkdown}
            </pre>
          ) : (
            <p className="text-stone-500">No content.</p>
          )}
        </div>
        <p className="mt-4 text-sm text-stone-500 text-center">
          {newsletter.sentAt ? new Date(newsletter.sentAt).toLocaleDateString() : ''}
        </p>
      </article>
    </div>
  );
}
