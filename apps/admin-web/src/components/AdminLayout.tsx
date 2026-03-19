'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getAuth } from '@/lib/firebase';
import { signOut } from '@/lib/firebase';

const NAV = [
  { href: '/capture', label: 'Capture' },
  { href: '/newsletter', label: 'Generate Newsletter' },
  { href: '/memos', label: 'Memos' },
  { href: '/subscribers', label: 'Subscribers' },
  { href: '/prompt', label: 'Prompt Editor' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    try {
      const auth = getAuth();
      const unsub = auth.onAuthStateChanged((user) => {
        setReady(true);
        if (!user) router.replace('/login');
      });
      return () => unsub();
    } catch (err) {
      // If Firebase initialization fails synchronously, we'd otherwise get stuck on "Loading…".
      // Redirecting to login avoids an infinite spinner and keeps the app protected.
      // eslint-disable-next-line no-console
      console.error('AdminLayout auth init failed', err);
      setReady(true);
      router.replace('/login');
    }
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center justify-between">
        <nav className="flex gap-4">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={pathname === href ? 'underline' : 'hover:underline'}
            >
              {label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => signOut().then(() => router.push('/login'))}
          className="text-sm text-slate-300 hover:text-white"
        >
          Sign out
        </button>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
