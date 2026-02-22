'use client';

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';

type Subscriber = {
  id: string;
  name: string;
  email: string;
  phone: string;
  smsConsent: boolean;
  status: string;
  createdAt: string;
};

export default function SubscribersPage() {
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    apiGet<{ subscribers: Subscriber[] }>('/admin/subscribers')
      .then((r) => setSubs(r.subscribers))
      .catch(() => setSubs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await apiPost('/admin/subscribers', { name, email, phone, smsConsent });
      setName('');
      setEmail('');
      setPhone('');
      setSmsConsent(false);
      setMessage('Created.');
      load();
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const setStatus = async (id: string, status: string) => {
    try {
      await apiPatch(`/admin/subscribers/${id}`, { status });
      load();
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this subscriber?')) return;
    try {
      await apiDelete(`/admin/subscribers/${id}`);
      load();
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const exportCsv = async () => {
    try {
      const { getAuthToken } = await import('@/lib/firebase');
      const token = await getAuthToken();
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(`${base}/api/admin/subscribers/export.csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'subscribers.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage('Export failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Subscribers</h1>
        <form onSubmit={create} className="flex flex-wrap gap-2 mb-6 p-4 bg-white rounded-lg border">
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border rounded px-2 py-1"
            required
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border rounded px-2 py-1"
            required
          />
          <input
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="border rounded px-2 py-1"
          />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} />
            SMS consent
          </label>
          <button type="submit" className="px-4 py-2 bg-slate-800 text-white rounded-lg">
            Add
          </button>
        </form>
        <button
          type="button"
          onClick={exportCsv}
          className="mb-4 px-4 py-2 bg-slate-600 text-white rounded-lg"
        >
          Export CSV
        </button>
        {message && <p className="text-sm text-slate-600 mb-2">{message}</p>}
        {loading ? (
          <p>Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border p-2 text-left">Name</th>
                  <th className="border p-2 text-left">Email</th>
                  <th className="border p-2 text-left">Phone</th>
                  <th className="border p-2 text-left">SMS</th>
                  <th className="border p-2 text-left">Status</th>
                  <th className="border p-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id}>
                    <td className="border p-2">{s.name}</td>
                    <td className="border p-2">{s.email}</td>
                    <td className="border p-2">{s.phone}</td>
                    <td className="border p-2">{s.smsConsent ? 'Yes' : 'No'}</td>
                    <td className="border p-2">{s.status}</td>
                    <td className="border p-2">
                      {s.status === 'active' ? (
                        <button
                          type="button"
                          onClick={() => setStatus(s.id, 'unsubscribed')}
                          className="text-amber-600 text-sm mr-2"
                        >
                          Unsubscribe
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setStatus(s.id, 'active')}
                          className="text-sky-600 text-sm mr-2"
                        >
                          Reactivate
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(s.id)}
                        className="text-red-600 text-sm"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
