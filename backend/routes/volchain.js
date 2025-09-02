const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');

// Reuse server-scoped helpers via requires
const volchain = require('../volchain_chain.js');
const guard = require('../volchain_guard.js');

const { txRateLimiter, txBodySizeGuard } = require('../middleware/security');

// Basic endpoints moved from server.js
router.get('/volchain/events', (req, res) => {
  try {
    // Prevent caching so UI always sees the freshest list
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    // Override ETag to avoid 304 Not Modified on dynamic content
    res.set('ETag', String(Date.now()));

    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 50));
    const before = req.query.cursor ? Number(req.query.cursor) : undefined;
    let events = [];
    let nextCursor = null;
    try {
      const r = volchain.getEvents(limit, before);
      events = Array.isArray(r?.events) ? r.events : [];
      nextCursor = (typeof r?.nextCursor === 'number') ? r.nextCursor : null;
    } catch {}

    // Merge fallback UI log to surface recent stake/unstake/remove immediately
    try {
      const fs = require('fs');
      const path = require('path');
      const logPath = path.join(__dirname, '..', 'volchain_log.json');
      if (fs.existsSync(logPath)) {
        const arr = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        if (Array.isArray(arr) && arr.length > 0) {
          // Prepend fallback events that are not already present (by memo.op_id or ts+type)
          const seen = new Set(events.map(e => (e?.memo?.op_id || `${e?.ts||''}:${e?.type||''}:${e?.gridIndex||''}`)));
          for (const ev of arr.slice(0, limit)) {
            const key = ev?.memo?.op_id || `${ev?.ts||''}:${ev?.type||''}:${ev?.gridIndex||''}`;
            if (!seen.has(key)) {
              events.unshift(ev);
              seen.add(key);
            }
          }
        }
      }
    } catch {}

    // Resolve usernames from pubkeys/addresses
    try {
      const { readDB } = require('../lib/db');
      const db = readDB();
      const pubToUser = {};
      const addrToUser = {};
      try {
        for (const u of (db.users || [])) {
          if (u && u.username && u.powPubkey) {
            const pkHexLower = String(u.powPubkey).toLowerCase();
            const pkHexUpper = String(u.powPubkey).toUpperCase();
            pubToUser[pkHexLower] = u.username;
            pubToUser[pkHexUpper] = u.username;
            try {
              const b64 = volchain.hexToB64(String(u.powPubkey));
              const addr = volchain.addrFromPub(b64);
              if (addr) addrToUser[addr] = u.username;
            } catch {}
          }
        }
      } catch {}

      // Build quick index of recent block txs by timestamp to recover missing pubkeys for legacy mint entries
      const tsNeeding = new Set();
      for (const e of events) {
        if (e && e.type === 'mint' && (!e.pubkey || e.pubkey === '') && e.ts) tsNeeding.add(Number(e.ts));
      }
      const tsToPubHex = {};
      if (tsNeeding.size > 0) {
        try {
          let before = undefined;
          let safety = 0;
          while (tsNeeding.size > 0 && safety < 10) {
            safety++;
            const page = volchain.getBlocks(500, before) || { blocks: [], nextCursor: null };
            const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
            for (const b of blocks) {
              const txs = Array.isArray(b?.txs) ? b.txs : [];
              for (const tx of txs) {
                try {
                  if (String(tx?.type) !== 'mint') continue;
                  const ts = Number(tx?.ts || 0);
                  if (!tsNeeding.has(ts)) continue;
                  let hex = null;
                  if (tx && typeof tx.pubkey === 'string') {
                    if (/^[0-9a-fA-F]{64}$/.test(tx.pubkey)) hex = tx.pubkey.toLowerCase();
                    else {
                      try { const h = volchain.b64ToHex(tx.pubkey); if (h && /^[0-9a-fA-F]{64}$/.test(h)) hex = h.toLowerCase(); } catch {}
                    }
                  }
                  if (!hex && tx && tx.memo && typeof tx.memo.toPubkey === 'string') {
                    try { const h = volchain.b64ToHex(tx.memo.toPubkey); if (h && /^[0-9a-fA-F]{64}$/.test(h)) hex = h.toLowerCase(); } catch {}
                  }
                  if (hex) {
                    tsToPubHex[ts] = hex;
                    tsNeeding.delete(ts);
                  }
                } catch {}
              }
            }
            if (page && typeof page.nextCursor === 'number') before = page.nextCursor; else break;
          }
        } catch {}
      }

      for (const e of events) {
        try {
          // Attach username for events carrying a pubkey (hex or base64)
          let pkHex = null;
          if (e && typeof e.pubkey === 'string') {
            if (/^[0-9a-fA-F]{64}$/.test(e.pubkey)) {
              pkHex = e.pubkey.toLowerCase();
            } else {
              try {
                const hex = volchain.b64ToHex(e.pubkey);
                if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) pkHex = hex.toLowerCase();
              } catch {}
            }
          }
          // For mint where pubkey may be empty, try memo.toPubkey (base64)
          if (!pkHex && e && e.memo && typeof e.memo.toPubkey === 'string') {
            try {
              const hex = volchain.b64ToHex(e.memo.toPubkey);
              if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) pkHex = hex.toLowerCase();
            } catch {}
          }
          // Fallback: match by timestamp using recent blocks index
          if (!pkHex && e && e.type === 'mint' && e.ts && tsToPubHex[Number(e.ts)]) {
            pkHex = tsToPubHex[Number(e.ts)];
          }
          if (pkHex && !e.username && pubToUser[pkHex]) {
            e.username = pubToUser[pkHex];
          }

          // Attach fromUser/toUser for transfer-like events using address mapping
          if (e && typeof e.from === 'string' && !e.fromUser && addrToUser[e.from]) {
            e.fromUser = addrToUser[e.from];
          }
          if (e && typeof e.to === 'string' && !e.toUser && addrToUser[e.to]) {
            e.toUser = addrToUser[e.to];
          }
          // Fallback: toUser via memo.toPubkey
          if (!e?.toUser && e?.memo && typeof e.memo.toPubkey === 'string') {
            try {
              const hex = volchain.b64ToHex(e.memo.toPubkey);
              const name = pubToUser[String(hex || '').toLowerCase()];
              if (name) e.toUser = name;
            } catch {}
          }

          // Final fallback: for dig mints without pubkey, use gridIndex → owner/dugBy
          if (e && e.type === 'mint' && !e.username && (!e.pubkey || e.pubkey === '')) {
            try {
              const gi = (typeof e.gridIndex === 'number') ? e.gridIndex : (e?.memo && typeof e.memo.gridIndex === 'number' ? e.memo.gridIndex : null);
              if (gi !== null) {
                const b = (db.grid && Array.isArray(db.grid)) ? db.grid[gi] : null;
                const name = (b && (b.owner || b.dugBy)) ? (b.owner || b.dugBy) : null;
                if (name && typeof name === 'string') e.username = name;
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}

    // Global sort by timestamp (newest first), then by id desc if present
    try {
      events.sort((a, b) => {
        const ta = Number(a?.ts || 0);
        const tb = Number(b?.ts || 0);
        if (tb !== ta) return tb - ta;
        const ia = Number(a?.id || 0);
        const ib = Number(b?.id || 0);
        return ib - ia;
      });
    } catch {}
    // Trim to limit after sorting
    if (events.length > limit) events = events.slice(0, limit);
    return res.json({ events, nextCursor });
  } catch { res.status(500).json({ error: 'Failed to read volchain events' }); }
});

router.get('/volchain/holders', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 10));
    const db = require('../lib/db').readDB();
    const pubToUser = {};
    for (const u of db.users) {
      if (u.powPubkey) {
        pubToUser[String(u.powPubkey).toLowerCase()] = u;
        pubToUser[String(u.powPubkey).toUpperCase()] = u;
      }
    }
    const top = volchain.getTopHolders(limit).map(h => ({
      pubkey: h.pubkey,
      balance: h.balance,
      name: pubToUser[h.pubkey]?.username || h.pubkey.slice(0, 8),
      color: pubToUser[h.pubkey]?.color || '#888'
    }));
    res.json(top);
  } catch { res.status(500).json({ error: 'Failed to read volchain holders' }); }
});
router.get('/volchain/head', (req, res) => {
  try { const head = volchain.getHead(); res.json(head); } catch { res.status(500).json({ error: 'head_failed' }); }
});

router.get('/volchain/state/:addr', (req, res) => {
  try { const st = volchain.getState(req.params.addr); res.json(st); } catch { res.status(500).json({ error: 'state_failed' }); }
});

router.get('/volchain/blocks', (req, res) => {
  try { const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 20)); const before = req.query.cursor ? Number(req.query.cursor) : undefined; const { blocks, nextCursor } = volchain.getBlocks(limit, before); res.json({ blocks, nextCursor }); } catch { res.status(500).json({ error:'Failed to read blocks' }); }
});

router.post('/volchain/tx', txRateLimiter, txBodySizeGuard, async (req, res) => {
  try {
    const b = req.body || {};
    // Require valid signature unless type is system-only
    if (b.type !== 'mint' && b.type !== 'stake' && b.type !== 'unstake') {
      const ok = await volchain.verifyTxSignature(b);
      if (!ok) return res.status(400).json({ ok:false, error:'bad_signature' });
    }
    b.memo = b.memo || {};
    if (!b.memo.op_id) b.memo.op_id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    volchain.enqueueTx(b);
    return res.json({ ok:true, op_id: b.memo.op_id });
  } catch (e) {
    const msg = String(e?.message || e);
    const known = ['FROM_ADDRESS_MISMATCH','TO_RESOLVE_FAILED','BAD_TO_PUBKEY','BAD_PUBKEY','invalid_amount','duplicate_dig_id','invalid_nonce','insufficient_available','insufficient_stake','mempool_full','memo_too_large','bad_chain_id','DIG_ID_REQUIRED','DIG_ID_DUPLICATE','missing_op_id','duplicate_op_id'];
    const code = known.includes(msg) ? msg : 'INTERNAL';
    if (code === 'INTERNAL') logger.error('POST /volchain/tx error:', e);
    return res.status(code==='INTERNAL'?500:400).json({ ok:false, error: code });
  }
});

router.post('/volchain/canonicalize', (req, res) => {
  try {
    if (String(process.env.VOLCHAIN_DEBUG_CANON) !== '1') return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const v = require('../volchain_chain.js');
    const canon = v.canonicalTx(b);
    try { const fromDerived = v.addrFromPub(Buffer.from(String(b.pubkey||''), 'base64')); const fromMatches = (fromDerived === b.from); return res.json({ canonical: canon, fromDerived, fromMatches }); } catch { return res.json({ canonical: canon }); }
  } catch { return res.status(500).json({ error: 'internal' }); }
});

router.get('/volchain/health', (req, res) => {
  try { const snap = volchain.getSnapshot(); const mempoolSize = (()=>{ try{ const v=require('../volchain_chain.js'); return (v.__mempoolSize && v.__mempoolSize()) || 0; } catch { return 0; }})(); res.json({ lastId: snap?.lastId ?? 0, lastHash: snap?.lastHash ?? null, accounts: snap?.balances ? Object.keys(snap.balances).length : 0, height: snap?.height ?? 0, lastBlockId: snap?.lastBlockId ?? 0, lastBlockHash: snap?.lastBlockHash ?? null, lastBlockTime: snap?.lastBlockTime ?? null, mempoolSize }); } catch { res.status(500).json({ error:'Failed to read volchain health' }); }
});

module.exports = router;


