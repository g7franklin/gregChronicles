/** Use direct API URL in the browser so the Authorization header is sent (Next.js rewrites don't forward it). */
function getApiBase(): string {
  if (typeof window === 'undefined') return '/api';
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
}

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
  const base = getApiBase();
  const url = path.startsWith('http') ? path : `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}`;
  return fetch(url, { ...init, headers });
}

function parseErrorResponse(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: string; details?: string };
    if (body.details) return `${body.error ?? 'Error'}: ${body.details}`;
    if (body.error) return body.error;
  } catch {
    // not JSON
  }
  if (/Internal Server Error|Bad Gateway|ECONNREFUSED/i.test(text)) {
    return `${text} — Is the API running? Check the API terminal for the real error.`;
  }
  return text;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetchApi(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseErrorResponse(text));
  }
  return res.json();
}

export async function apiPatch(path: string, body: unknown): Promise<unknown> {
  const res = await fetchApi(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseErrorResponse(text));
  }
  return res.status === 204 ? undefined : res.json();
}

export async function apiPost(path: string, body?: unknown): Promise<unknown> {
  const res = await fetchApi(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseErrorResponse(text));
  }
  return res.status === 204 ? undefined : res.json();
}

export async function apiPostFormData(path: string, formData: FormData): Promise<unknown> {
  const token = await getToken();
  const headers: HeadersInit = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const base = getApiBase();
  const url = path.startsWith('http') ? path : `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseErrorResponse(text));
  }
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetchApi(path, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseErrorResponse(text));
  }
}
