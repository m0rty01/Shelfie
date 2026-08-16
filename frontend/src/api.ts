const RAW_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
export const API_BASE = RAW_BASE ? `${RAW_BASE.replace(/\/$/, '')}/api` : '/api';

export type DetectedBook = {
  spine_id: string;
  spine_b64: string;
  ocr_title?: string | null;
  ocr_author?: string | null;
  best_match?: { id: number; title: string; author: string; cover_url?: string | null } | null;
  confidence: number;
  status: 'high' | 'low' | 'unreadable';
  reason?: string | null;
};

export type ScanResponse = {
  scan_id: string;
  detected_count: number;
  auto_added_count: number;
  review: DetectedBook[];
  auto_added: DetectedBook[];
};

export type LibraryBook = {
  id: string;
  catalog_id?: number | null;
  title: string;
  author: string;
  cover_url?: string | null;
  spine_b64?: string | null;
  confidence: number;
  confirmed_at: string;
};

export type CatalogItem = {
  id: number;
  title: string;
  author: string;
  edition?: string | null;
  cover_url?: string | null;
};

async function toJson(res: Response) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`BAD_DATA: server returned unreadable response`);
  }
}

export async function scanImage(uri: string, timeoutMs = 60000): Promise<ScanResponse> {
  const form = new FormData();
  // React Native FormData supports { uri, name, type }
  // @ts-ignore
  form.append('image', { uri, name: 'shelf.jpg', type: 'image/jpeg' });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/scan`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(t);
    if (e?.name === 'AbortError') throw new Error('TIMEOUT: The AI took too long to respond.');
    throw new Error('NETWORK: Could not reach the server.');
  }
  clearTimeout(t);

  if (!res.ok) {
    const err = await toJson(res).catch(() => ({ detail: 'Server error' }));
    const detail = (err && err.detail) || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return toJson(res);
}

export async function getLibrary(): Promise<LibraryBook[]> {
  const res = await fetch(`${API_BASE}/library`);
  if (!res.ok) throw new Error('Failed to load library');
  return toJson(res);
}

export async function confirmBook(payload: {
  catalog_id?: number | null;
  title: string;
  author: string;
  cover_url?: string | null;
  spine_b64?: string | null;
  confidence?: number;
}): Promise<LibraryBook> {
  const res = await fetch(`${API_BASE}/library/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confidence: 1.0, ...payload }),
  });
  if (!res.ok) throw new Error('Failed to confirm book');
  return toJson(res);
}

export async function deleteBook(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/library/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete book');
}

export async function searchCatalog(q: string): Promise<CatalogItem[]> {
  const res = await fetch(`${API_BASE}/catalog?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error('Search failed');
  const data = await toJson(res);
  return data.results || [];
}

export async function getBook(id: string): Promise<LibraryBook> {
  const res = await fetch(`${API_BASE}/library/${id}`);
  if (!res.ok) throw new Error('Not found');
  return toJson(res);
}
