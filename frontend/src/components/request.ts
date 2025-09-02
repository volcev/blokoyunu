// Minimal fetch wrapper to add X-Chain-Id and X-Op-Id automatically
// - Fetches chain id once at app start and caches it
// - Generates UUID v4 for op-id per call unless provided

let __chainIdPromise: Promise<string> | null = null;
let __cachedChainId: string | null = null;

function uuidv4(): string {
  // RFC4122 v4 UUID using crypto.getRandomValues
  const buf = new Uint8Array(16);
  (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto.getRandomValues(buf) : buf.fill(0);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const bth = Array.from(buf).map(b => b.toString(16).padStart(2, '0'));
  return `${bth[0]}${bth[1]}${bth[2]}${bth[3]}-${bth[4]}${bth[5]}-${bth[6]}${bth[7]}-${bth[8]}${bth[9]}-${bth[10]}${bth[11]}${bth[12]}${bth[13]}${bth[14]}${bth[15]}`;
}

async function getChainId(): Promise<string> {
  if (__cachedChainId) return __cachedChainId;
  if (!__chainIdPromise) {
    __chainIdPromise = fetch('/chain/info')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`chain_info_http_${r.status}`)))
      .then(j => String(j?.chain_id || 'volchain-main'))
      .catch(() => 'volchain-main')
      .then(cid => { __cachedChainId = cid; return cid; });
  }
  return __chainIdPromise;
}

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  requireOpId?: boolean;
};

export async function apiFetch(input: string, opts: RequestOptions = {}): Promise<Response> {
  const method = (opts.method || 'GET').toUpperCase();
  const requireOp = opts.requireOpId ?? (method !== 'GET' && method !== 'HEAD');
  const headers: Record<string, string> = Object.assign({}, opts.headers || {});

  // Always attach session token if available
  const session = (typeof window !== 'undefined') ? (localStorage.getItem('session_token') || '') : '';
  if (session && !headers['X-Session-Token']) headers['X-Session-Token'] = session;

  // Content type default for JSON bodies
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  // Chain id and op id for mutations
  if (method === 'POST' || method === 'PATCH' || method === 'DELETE' || method === 'PUT') {
    try {
      const cid = await getChainId();
      if (!headers['X-Chain-Id']) headers['X-Chain-Id'] = cid;
    } catch {}
    if (requireOp && !headers['X-Op-Id']) headers['X-Op-Id'] = uuidv4();
  }

  const init: RequestInit = {
    method,
    headers,
    body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined
  };
  return fetch(input, init);
}

export async function withRetry(input: string, opts: RequestOptions = {}, retries = 1): Promise<Response> {
  let lastErr: any = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await apiFetch(input, opts);
      if (res.status === 400) {
        try {
          const j = await res.clone().json();
          if (j && (j.error === 'CHAIN_ID mismatch' || j.error === 'CHAIN_ID required')) {
            __cachedChainId = null; __chainIdPromise = null; await getChainId();
            continue;
          }
        } catch {}
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i === retries) throw e;
    }
  }
  if (lastErr) throw lastErr;
  return apiFetch(input, opts);
}


