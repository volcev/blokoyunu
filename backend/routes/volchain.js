const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');

// Reuse server-scoped helpers via requires
const volchain = require('../volchain_chain.js');
const guard = require('../volchain_guard.js');
const fs = require('fs');
const path = require('path');

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

    // Stable deduplication key across sources
    const computeKey = (e) => {
      try {
        if (e && e.memo && typeof e.memo.op_id === 'string' && e.memo.op_id) return `op:${e.memo.op_id}`;
        const type = String(e?.type || '');
        const ts = Number(e?.ts || 0);
        let who = '';
        if (typeof e?.pubkey === 'string' && /^[0-9a-fA-F]{64}$/.test(e.pubkey)) who = e.pubkey.toLowerCase();
        else if (typeof e?.pubkey === 'string' && /^[A-Za-z0-9+/=]+$/.test(e.pubkey)) { try { who = volchain.b64ToHex(e.pubkey).toLowerCase(); } catch {} }
        if (!who && typeof e?.username === 'string') who = `u:${e.username}`;
        const gi = (e && typeof e.gridIndex === 'number') ? e.gridIndex : (e && e.memo && typeof e.memo.gridIndex === 'number') ? e.memo.gridIndex : '';
        const amt = (typeof e?.amount === 'number') ? e.amount : '';
        const reason = String((e?.reason || e?.memo?.reason) || '');
        return `ts:${ts}|type:${type}|who:${who}|gi:${gi}|amt:${amt}|r:${reason}`;
      } catch { return String(e?.ts || '') + ':' + String(e?.type || ''); }
    };
    const seen = new Set(events.map(ev => computeKey(ev)));

    // Include pending dig mints from mempool as preview items (so UI shows them before sealing)
    try {
      const fs = require('fs');
      const path = require('path');
      const mempoolPath = path.join(__dirname, '..', 'volchain', 'mempool.jsonl');
      if (fs.existsSync(mempoolPath)) {
        const raw = fs.readFileSync(mempoolPath, 'utf8');
        const lines = raw.split(/\n+/).filter(Boolean);
        const pending = [];
        for (let i = lines.length - 1; i >= 0 && pending.length < limit; i--) {
          try {
            const tx = JSON.parse(lines[i]);
            // Include mint (dig) and burn (attack) events
            if (tx && tx.type === 'mint' && String(tx?.memo?.reason || '').toLowerCase() === 'dig') {
              pending.push({ ts: Number(tx.ts || Date.now()), type: 'mint', pubkey: (typeof tx.pubkey === 'string' ? tx.pubkey : ''), amount: tx.amount, reason: tx?.memo?.reason, memo: tx.memo || {} });
            } else if (tx && tx.type === 'burn' && (String(tx?.memo?.reason || '').toLowerCase() === 'attack_burn_attacker' || String(tx?.memo?.reason || '').toLowerCase() === 'attack_burn_defender')) {
              pending.push({ ts: Number(tx.ts || Date.now()), type: 'burn', pubkey: (typeof tx.pubkey === 'string' ? tx.pubkey : ''), amount: tx.amount, reason: tx?.memo?.reason, username: tx?.memo?.username, memo: tx.memo || {} });
            }
          } catch {}
        }
        if (pending.length > 0) {
          for (const ev of pending) {
            const key = computeKey(ev);
            if (!seen.has(key)) { events.unshift(ev); seen.add(key); }
          }
        }
      }
    } catch {}

    // Merge fallback UI log only if mempool has items (avoid dupes after sealing)
    try {
      const mp = (volchain.__mempoolSize && typeof volchain.__mempoolSize === 'function') ? Number(volchain.__mempoolSize() || 0) : 0;
      if (mp > 0) {
        const fs = require('fs');
        const path = require('path');
        const logPath = path.join(__dirname, '..', 'volchain_log.json');
        if (fs.existsSync(logPath)) {
          const arr = JSON.parse(fs.readFileSync(logPath, 'utf8'));
          if (Array.isArray(arr) && arr.length > 0) {
            for (const ev of arr.slice(0, limit)) {
              const key = computeKey(ev);
              if (!seen.has(key)) { events.unshift(ev); seen.add(key); }
            }
            try {
              const coreEvents = [];
              for (let i = 0; i < arr.length && coreEvents.length < limit; i++) {
                const ev = arr[i];
                // Include mint (dig) events
                if (ev && ev.type === 'mint' && String(ev.reason || ev?.memo?.reason || '').toLowerCase() === 'dig') {
                  coreEvents.push(ev);
                }
                // Include burn (attack) events  
                else if (ev && ev.type === 'burn' && (String(ev.reason || ev?.memo?.reason || '').toLowerCase() === 'attack_burn_attacker' || String(ev.reason || ev?.memo?.reason || '').toLowerCase() === 'attack_burn_defender')) {
                  coreEvents.push(ev);
                }
              }
              if (coreEvents.length > 0) {
                for (const ev of coreEvents) {
                  const key = computeKey(ev);
                  if (!seen.has(key)) { events.unshift(ev); seen.add(key); }
                }
              }
            } catch {}
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
            try { const b64 = volchain.hexToB64(String(u.powPubkey)); const addr = volchain.addrFromPub(b64); if (addr) addrToUser[addr] = u.username; } catch {}
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
          // Additional: map hex pubkeys directly (used by attack events and some legacy entries)
          const isHex64 = (s) => typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);
          if (e && typeof e.from === 'string' && !e.fromUser && isHex64(e.from)) {
            const keyLower = e.from.toLowerCase();
            if (pubToUser[keyLower]) e.fromUser = pubToUser[keyLower];
          }
          if (e && typeof e.to === 'string' && !e.toUser && isHex64(e.to)) {
            const keyLower = e.to.toLowerCase();
            if (pubToUser[keyLower]) e.toUser = pubToUser[keyLower];
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
    // Final dedup across all sources (stable by current order)
    try {
      const seenAll = new Set();
      const uniq = [];
      for (const e of events) {
        const k = computeKey(e);
        if (seenAll.has(k)) continue;
        seenAll.add(k);
        uniq.push(e);
      }
      events = uniq;
    } catch {}
    // Collapse near-duplicates within the same second for identical (type, user/pubkey, reason, gridIndex)
    // BUT preserve attack-related burns by including op_id in the key
    try {
      const isHex64 = (s) => typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);
      const collapseKey = (e) => {
        const t = String(e?.type || '');
        const s = Math.floor(Number(e?.ts || 0) / 1000);
        let who = '';
        if (typeof e?.username === 'string') who = e.username;
        else if (typeof e?.pubkey === 'string' && isHex64(e.pubkey)) who = e.pubkey.toLowerCase();
        const r = String((e?.reason || e?.memo?.reason) || '');
        const gi = (e && typeof e.gridIndex === 'number') ? e.gridIndex : (e && e.memo && typeof e.memo.gridIndex === 'number') ? e.memo.gridIndex : '';
        
        // Include op_id for attack-related burns to prevent deduplication
        const opId = String((e?.op_id || e?.memo?.op_id) || '');
        const isAttackBurn = (t === 'burn' && (r === 'attack_burn_attacker' || r === 'attack_burn_defender'));
        
        if (isAttackBurn && opId) {
          return `${s}|${t}|${who}|${r}|${gi}|${opId}`;
        }
        
        return `${s}|${t}|${who}|${r}|${gi}`;
      };
      const seenBuckets = new Set();
      const compact = [];
      for (const e of events) {
        const bk = collapseKey(e);
        if (seenBuckets.has(bk)) continue;
        seenBuckets.add(bk);
        compact.push(e);
      }
      events = compact;
    } catch {}
    // Show only core events in UI: mint, burn, transfer
    try {
      const core = new Set(['mint','burn','transfer']);
      events = events.filter(e => core.has(String(e?.type || '').toLowerCase()));
    } catch {}
    // Trim to limit after sorting, dedup and filtering
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
    // Only accept core types here; system-only mints are handled server-side
    const t = String(b.type || '').toLowerCase();
    if (t !== 'transfer') {
      return res.status(400).json({ ok:false, error:'unsupported_type' });
    }
    // Require valid signature for transfer
    {
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
  try { const snap = volchain.getSnapshot(); const mempoolSize = (()=>{ try{ const v=require('../volchain_chain.js'); return (v.__mempoolSize && v.__mempoolSize()) || 0; } catch { return 0; }})(); const producerUptime = (()=>{ try{ const v=require('../volchain_chain.js'); return (v.__producerUptimeMs && v.__producerUptimeMs()) || 0; } catch { return 0; }})(); res.json({ lastId: snap?.lastId ?? 0, lastHash: snap?.lastHash ?? null, accounts: snap?.balances ? Object.keys(snap.balances).length : 0, height: snap?.height ?? 0, lastBlockId: snap?.lastBlockId ?? 0, lastBlockHash: snap?.lastBlockHash ?? null, lastBlockTime: snap?.lastBlockTime ?? null, mempoolSize, producerUptime }); } catch { res.status(500).json({ error:'Failed to read volchain health' }); }
});

// Manual seal endpoint (server process)
router.post('/volchain/seal', (req, res) => {
  try {
    const remote = (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
    const isLocal = (remote === '127.0.0.1' || remote === '::1');
    if (!isLocal) {
      const expectedFile = path.join(__dirname, '..', 'admin.secret');
      const expected = fs.existsSync(expectedFile) ? String(fs.readFileSync(expectedFile, 'utf8')).trim() : '';
      const provided = String(req.get('X-Admin-Secret') || '').trim();
      if (!expected || provided !== expected) return res.status(403).json({ ok:false, error:'forbidden' });
    }
    const batch = Math.max(1, Math.min(10000, Number(req.query.batch || 1000)));
    const block = volchain.sealPending(batch);
    return res.json({ ok:true, sealed: !!block, block });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'seal_failed' });
  }
});

router.get('/volchain/seal', (req, res) => {
  try {
    const batch = Math.max(1, Math.min(10000, Number(req.query.batch || 1000)));
    const block = volchain.sealPending(batch);
    return res.json({ ok:true, sealed: !!block, block });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'seal_failed' });
  }
});

// Admin: Backfill snapshot deltas into mempool and seal (fix balance_mined mismatches)
router.post('/admin/volchain-seed-backfill', (req, res) => {
  try {
    // Hard-disable unless explicitly allowed
    if (String(process.env.VOLCHAIN_ALLOW_BACKFILL) !== '1') {
      return res.status(403).json({ ok:false, error:'backfill_disabled' });
    }
    const secretFile = path.join(__dirname, '..', 'admin.secret');
    const expected = fs.existsSync(secretFile) ? String(fs.readFileSync(secretFile, 'utf8')).trim() : '';
    const provided = String(req.get('X-Admin-Secret') || '').trim();
    if (!expected || provided !== expected) return res.status(401).json({ ok:false, error:'unauthorized' });
    try { volchain.enqueueSeedBackfillTxs(); } catch {}
    try { volchain.sealPending(10000); } catch {}
    return res.json({ ok:true });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'internal' });
  }
});

module.exports = router;


