import React, { useEffect, useRef, useState, useCallback } from 'react';

type Event = {
  ts: number;
  type: 'mint' | 'burn' | 'transfer';
  reason?: string;
  username?: string;
  pubkey?: string;
  amount?: number;
  gridIndex?: number;
  fromUser?: string;
  from?: string;
  to?: string;
};

const formatTs = (ts: number) => {
  try {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`; // compact format
  } catch {
    return String(ts);
  }
};

const shortHex = (v?: string, len: number = 6) => {
  if (!v || typeof v !== 'string') return '';
  return v.length > len ? `${v.slice(0, len)}…` : v;
};

type Props = {
  autoRefreshMs?: number;
};

const VolchainActivity: React.FC<Props> = ({ autoRefreshMs }) => {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSigRef = useRef<string>('');

  const buildSignature = useCallback((list: Event[]) => {
    try {
      return JSON.stringify(list.slice(0, 50).map(e => ({ t: e.ts, y: e.type, a: e.amount, f: e.from, o: e.to })));
    } catch {
      return String(Date.now());
    }
  }, []);

  const fetchEvents = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      const silent = !!opts?.silent;
      if (!silent) {
        // Only show loading on manual/initial fetch
        setLoading(true);
        setError(null);
      }
      const resp = await fetch('/volchain/events');
      if (!resp.ok) throw new Error('Failed to load events');
      const data = await resp.json();
      const incoming: Event[] = Array.isArray(data) ? data : [];
      // Avoid re-render if unchanged
      const sig = buildSignature(incoming);
      if (sig !== lastSigRef.current) {
        lastSigRef.current = sig;
        setEvents(incoming);
      }
    } catch (e: any) {
      if (!opts?.silent) {
        setError(e?.message || 'Failed to load events');
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [buildSignature]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs <= 0) return;
    const id = setInterval(() => fetchEvents({ silent: true }), autoRefreshMs);
    return () => clearInterval(id);
  }, [autoRefreshMs, fetchEvents]);

  return (
    <div style={{ overflowX: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Recent (max 1000)</strong>
        {!autoRefreshMs && (
          <button className="settings-button" onClick={() => fetchEvents()} disabled={loading}>Refresh</button>
        )}
      </div>
      {loading && events.length === 0 && <p>Loading events…</p>}
      {error && <p style={{ color: '#c00' }}>❌ {error}</p>}
      <div style={{ maxHeight: 260, minHeight: 260, overflowY: 'auto', overflowX: 'hidden', marginTop: 6, border: '1px solid #eee', borderRadius: 6, padding: 6 }}>
        {events.length === 0 && !loading && <p>No events yet.</p>}
        {events.slice(0, 50).map((e, idx) => {
          const baseStyle: React.CSSProperties = {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            padding: '4px 4px',
            borderBottom: '1px dashed #eee',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          };
          const timeEl = (
            <span style={{ color: '#666', width: 80, flex: '0 0 auto' }}>{formatTs(e.ts)}</span>
          );
          const typeEl = (
            <span style={{ color: '#333', width: 58, flex: '0 0 auto' }}>{e.type.toUpperCase()}</span>
          );
          let msg = '';
          if (e.type === 'mint') {
            msg = `+${e.amount} to ${e.username || shortHex(e.pubkey)}`;
          } else if (e.type === 'burn') {
            msg = `-${e.amount} from ${e.username || shortHex(e.pubkey)}`;
          } else if (e.type === 'transfer') {
            const fromShort = e.fromUser || shortHex(e.from);
            const toShort = shortHex(e.to);
            msg = `${e.amount} from ${fromShort} to ${toShort}`;
          }
          return (
            <div key={idx} style={baseStyle}>
              {timeEl}
              {typeEl}
              <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VolchainActivity;


