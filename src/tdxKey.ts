// The visitor's own TDX keys (optional, up to three: TDX lets each member create three, each with
// its own per-minute quota). Kept only in this browser, sent with transit requests so the server
// can query TDX with them; never included in exported settings.

export interface TdxKey {
  id: string;
  secret: string;
}

export const MAX_TDX_KEYS = 3;
const KEY = "tdxKeys";
const OLD_KEY = "tdxKey"; // a single key, before several were allowed

const valid = (v: any): v is TdxKey => v && typeof v.id === "string" && typeof v.secret === "string" && Boolean(v.id && v.secret);

export function loadTdxKeys(): TdxKey[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(list)) return list.filter(valid).slice(0, MAX_TDX_KEYS);
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? "null");
    if (valid(old)) return [old];
  } catch {}
  return [];
}

export function saveTdxKeys(keys: TdxKey[]) {
  try {
    localStorage.removeItem(OLD_KEY);
    if (keys.length) localStorage.setItem(KEY, JSON.stringify(keys.slice(0, MAX_TDX_KEYS)));
    else localStorage.removeItem(KEY);
  } catch {}
}

/** Headers carrying the keys (X-TDX-Id / -Secret, then -2, -3), for requests that go to TDX through our server. */
export function tdxHeaders(keys: TdxKey[] = loadTdxKeys()): Record<string, string> {
  const h: Record<string, string> = {};
  keys.slice(0, MAX_TDX_KEYS).forEach((k, i) => {
    const suffix = i ? `-${i + 1}` : "";
    h[`X-TDX-Id${suffix}`] = k.id;
    h[`X-TDX-Secret${suffix}`] = k.secret;
  });
  return h;
}

const TDX_API = /^\/api\/(bus|train|stations|tdx-check|parking|geocode)/;
export const usesTdx = (url: string) => TDX_API.test(url);
