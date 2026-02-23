const API_BASE = '/api';

async function getToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const { getAuthToken } = await import('./firebase');
  return getAuthToken();
}

async function fetchApi(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers: HeadersInit = {
    ...(init.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetchApi(path);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiPatch(path: string, body: unknown): Promise<unknown> {
  const res = await fetchApi(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? undefined : res.json();
}

export async function apiPost(path: string, body?: unknown): Promise<unknown> {
  const res = await fetchApi(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? undefined : res.json();
}

export async function apiPostFormData(path: string, formData: FormData): Promise<unknown> {
  const token = await getToken();
  const headers: HeadersInit = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { error?: string; details?: string };
      const msg = body.details ? `${body.error ?? 'Error'}: ${body.details}` : body.error ?? text;
      throw new Error(msg);
    } catch (e) {
      if (e instanceof SyntaxError) {
        const generic = /Internal Server Error|Bad Gateway|ECONNREFUSED/i.test(text)
          ? `${text} — Is the API running at http://localhost:8080? Check the API terminal for the real error.`
          : text;
        throw new Error(generic);
      }
      if (e instanceof Error) throw e;
      throw new Error(text);
    }
  }
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetchApi(path, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
}
