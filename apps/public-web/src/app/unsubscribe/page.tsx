'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Missing unsubscribe link.');
      return;
    }
    setStatus('loading');
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    fetch(`${base}/api/public/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'GET' })
      .then((r) => r.json())
      .then((data) => {
        setStatus('done');
        setMessage(data.message || 'You’re unsubscribed.');
      })
      .catch(() => {
        setStatus('error');
        setMessage('Something went wrong. Try the link from your email again.');
      });
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-semibold text-stone-800 mb-4">Unsubscribe</h1>
        {status === 'loading' && <p className="text-stone-600">Processing…</p>}
        {status === 'done' && <p className="text-stone-600">{message}</p>}
        {status === 'error' && <p className="text-amber-700">{message}</p>}
        {!token && (
          <p className="text-stone-600 mt-2">
            Use the unsubscribe link from your newsletter email.
          </p>
        )}
        <Link href="/" className="inline-block mt-6 text-stone-800 underline">
          Back to home
        </Link>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-stone-600">Loading…</p></div>}>
      <UnsubscribeContent />
    </Suspense>
  );
}
