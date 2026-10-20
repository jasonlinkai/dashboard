// The visitor's own TDX key (optional). Kept only in this browser, sent with transit requests so
// the server can query TDX with it; never included in exported settings.

export interface TdxKey {
  id: string;
  secret: string;
}

const KEY = "tdxKey";

export function loadTdxKey(): TdxKey | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.id === "string" && typeof v.secret === "string" && v.id && v.secret) return v;
  } catch {}
  return null;
}

export function saveTdxKey(k: TdxKey | null) {
  try {
    if (k) localStorage.setItem(KEY, JSON.stringify(k));
    else localStorage.removeItem(KEY);
  } catch {}
}

/** Headers carrying the key, for requests that go to TDX through our server. */
export function tdxHeaders(k: TdxKey | null = loadTdxKey()): Record<string, string> {
  return k ? { "X-TDX-Id": k.id, "X-TDX-Secret": k.secret } : {};
}

const TDX_API = /^\/api\/(bus|train|stations|tdx-check)/;
export const usesTdx = (url: string) => TDX_API.test(url);
