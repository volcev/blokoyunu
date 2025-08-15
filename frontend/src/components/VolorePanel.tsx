import React, { useEffect, useMemo, useState } from 'react';

type Props = { username: string | null };

type Holder = { name: string; pubkey: string; balance: number; color: string };

const VolorePanel: React.FC<Props> = ({ username }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [used, setUsed] = useState<number>(0);
  const [available, setAvailable] = useState<number>(0);
  const [address, setAddress] = useState<string>('');
  const [top, setTop] = useState<Holder[]>([]);
  const [toPubkey, setToPubkey] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [txMsg, setTxMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);

  // removed unused constant

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // Volchain stats (single source of truth for total balance)
        const volResp = await fetch(`/stats/volchain?username=${encodeURIComponent(username || '')}`);
        const vol = await volResp.json();
        const volBalance: number = vol?.volchain?.currentUser?.balance ?? 0;
        setTotal(volBalance);
        if (vol?.volchain?.currentUser?.pubkey) setAddress(vol.volchain.currentUser.pubkey);

        // GridB for used (defense sum); available = balance - used
        const gbResp = await fetch('/gridb');
        const gridb = await gbResp.json();
        const u = Array.isArray(gridb)
          ? gridb.filter((b: any) => b && b.owner === username).reduce((s: number, b: any) => s + (typeof b.defense === 'number' ? b.defense : 1), 0)
          : 0;
        setUsed(u);
        setAvailable(Math.max(0, volBalance - u));

        // Top list should match Top Miners (by mined blocks)
        try {
          const tmResp = await fetch('/top-miners');
          const tm = await tmResp.json();
          if (Array.isArray(tm)) {
            const mapped: Holder[] = tm.slice(0, 3).map((m: any) => ({
              name: m.name,
              color: m.color || '#888',
              // Reuse fields to avoid extra types: store count in balance, and name in pubkey placeholder
              balance: m.count,
              pubkey: m.name,
            }));
            setTop(mapped);
          }
        } catch {}
      } catch (e: any) {
        setError(e?.message || 'Failed to load Volore stats');
      } finally {
        setLoading(false);
      }
    })();
  }, [username]);

  const sessionToken = (typeof window !== 'undefined') ? (localStorage.getItem('session_token') || '') : '';
  const canSend = useMemo(() => available > 0 && /^([0-9a-fA-F]{64})$/.test(toPubkey) && amount > 0 && amount <= available && !!sessionToken, [available, toPubkey, amount, sessionToken]);

  const validationMessage = useMemo(() => {
    if (!sessionToken) return 'Please log in to send Volore';
    if (available <= 0) return 'No Available Volore to send';
    if (address && toPubkey && toPubkey.toLowerCase() === address.toLowerCase()) return 'You cannot send Volore to yourself';
    if (!/^([0-9a-fA-F]{64})$/.test(toPubkey)) return 'Invalid destination address (must be 64 hex)';
    if (!amount || amount <= 0) return 'Amount must be greater than 0';
    if (amount > available) return 'Amount exceeds Available Volore';
    return '';
  }, [sessionToken, available, toPubkey, amount, address]);
  const showInlineValidation = (toPubkey.length > 0 || (typeof amount === 'number' && amount > 0)) && !!validationMessage && !canSend;

  const handleCopyAddress = async () => {
    try {
      if (!address) return;
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleSend = async () => {
    try {
      setTxMsg(null);
      setError(null);
      if (!canSend) {
        if (validationMessage) setError(validationMessage);
        return;
      }
      setConfirmOpen(false);
      const resp = await fetch('/volchain/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
        body: JSON.stringify({ toPubkey, amount })
      });
      const json = await resp.json();
      if (!resp.ok || json?.error) {
        setError(json?.error || 'Transfer failed');
        return;
      }
      setTxMsg(`✅ Sent ${amount} Volore to ${toPubkey.slice(0,8)}…`);
      // Refresh balances: Volchain total decreases by amount; used unchanged
      setTotal(prev => Math.max(0, (typeof prev === 'number' ? prev : 0) - amount));
      setAvailable(json.availableAfter ?? Math.max(0, available - amount));
      setToPubkey('');
      setAmount(0);
    } catch (e: any) {
      setError(e?.message || 'Transfer failed');
    }
  };

  const handleClickSend = () => {
    setTxMsg(null);
    setError(null);
    if (!canSend) {
      if (validationMessage) setError(validationMessage);
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <div>
      {loading && <p>Loading Volore…</p>}
      {error && <p style={{ color: '#c00' }}>❌ {error}</p>}

      <div className="stats-section">
        <h4 className="section-title">📊 Volore Balances</h4>
        <div className="stats-row">
          <div className="stat-item">
            <span className="stat-label">Total Volore:</span>
            <span className="stat-value">{total.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Used Volore (Warzone):</span>
            <span className="stat-value">{used.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Available Volore:</span>
            <span className="stat-value highlight">{available.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="stats-section">
        <h4 className="section-title">🔗 Your Volchain Address</h4>
        <div className="tech-info">
          <div className="tech-item">
            <span className="tech-label">Address:</span>
            <span className="tech-value tech-address">{address ? `${address.slice(0,8)}...${address.slice(-8)}` : '-'}</span>
            <button
              type="button"
              onClick={handleCopyAddress}
              title="Copy address"
              aria-label="Copy address"
              style={{ marginLeft: 8, padding: '2px 6px', borderRadius: 4, border: '1px solid #ccc', background: '#f7f7f7', cursor: 'pointer' }}
            >
              ⧉
            </button>
            {copied && <span style={{ marginLeft: 6, fontSize: 12, color: '#4CAF50' }}>Copied</span>}
          </div>
        </div>
      </div>

      <div className="stats-section">
        <h4 className="section-title">📤 Send Volore</h4>
        <div className="stats-row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <input
            placeholder="Receiver Volchain address (64-hex)"
            value={toPubkey}
            onChange={e => setToPubkey(e.target.value.trim())}
            style={{ flex: '1 1 320px', padding: 8 }}
          />
          <input
            type="number"
            placeholder={`Amount (max ${available})`}
            value={amount || ''}
            min={1}
            max={available}
            onChange={e => setAmount(Number(e.target.value))}
            style={{ width: 160, padding: 8 }}
          />
          <button className="settings-button" disabled={!canSend} onClick={handleClickSend}>
            Send
          </button>
        </div>
        {showInlineValidation && !error && <p style={{ color: '#c00' }}>❗ {validationMessage}</p>}
        {txMsg && <p>{txMsg}</p>}
      </div>

      {confirmOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: 20, borderRadius: 8, maxWidth: 420, width: '90%', boxShadow: '0 6px 24px rgba(0,0,0,0.2)' }}>
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>Confirm Transfer</h4>
            <p style={{ marginTop: 0 }}>Do you really want to send <strong>{amount}</strong> Volore to<br/>
              <span style={{ fontFamily: 'monospace' }}>{toPubkey.slice(0,12)}…{toPubkey.slice(-12)}</span>?</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="settings-button" onClick={() => setConfirmOpen(false)} style={{ background: '#e0e0e0', color: '#333' }}>Cancel</button>
              <button className="settings-button" onClick={handleSend} style={{ background: '#4CAF50', color: '#fff' }}>Send</button>
            </div>
          </div>
        </div>
      )}

      <div className="stats-section">
        <h4 className="section-title">🏆 Top Volore Miners</h4>
        <div className="top-miners-list">
          {top.map((h, i) => (
            <div key={h.pubkey} className="miner-item">
              <span className="miner-rank">{i + 1}</span>
              <div className="miner-color" style={{ backgroundColor: h.color || '#e0e0e0' }}></div>
              <span className="miner-name">{h.name}</span>
              <span className="miner-blocks">{h.balance}</span>
            </div>
          ))}
        </div>
      </div>

      
    </div>
  );
};

export default VolorePanel;


