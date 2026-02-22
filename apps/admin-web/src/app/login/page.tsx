'use client';

import { useEffect } from 'react';
import { getAuth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { signInWithGoogle } from '@/lib/firebase';

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    const auth = getAuth();
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) router.replace('/capture');
    });
    return () => unsub();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white p-8 rounded-xl shadow-lg text-center">
        <h1 className="text-2xl font-semibold text-slate-800 mb-2">Life Newsletter Admin</h1>
        <p className="text-slate-600 mb-6">Sign in to continue</p>
        <button
          onClick={() => signInWithGoogle().then(() => router.push('/capture'))}
          className="px-6 py-3 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
