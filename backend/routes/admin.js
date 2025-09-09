const express = require('express');
const path = require('path');
// fs is already required at top
const router = express.Router();
const volchain = require('../volchain_chain.js');
const guard = require('../volchain_guard.js');
const { readDB, writeDB } = require('../lib/db');
const { readGridB, writeGridB } = require('../lib/gridb');
const { getAdminSecret } = require('../lib/admin');
const { enforceInvariants, autoCorrectInvariants, updateUserBalancesFile, resolveUsernameToPubkey } = require('../lib/invariants');
const fs = require('fs');

// Minimal subset: volatile-sensitive admin endpoints migrated here
router.post('/admin/volchain-faucet', (req, res) => {
  try {
    if (String(process.env.VOLCHAIN_DEV_FAUCET) !== '1') return res.status(403).json({ ok:false, error:'forbidden' });
    const secret = getAdminSecret();
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    if (!secret || hdr !== secret) return res.status(403).json({ ok:false, error:'forbidden' });
    const { toPubkey, amount, reason, digId, dig_id } = req.body || {};
    if (!toPubkey || typeof toPubkey !== 'string') return res.status(400).json({ ok:false, error:'missing_toPubkey' });
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || Math.floor(amt) !== amt) return res.status(400).json({ ok:false, error:'invalid_amount' });
    const snap = volchain.getSnapshot();
    const sysNonce = ((snap.accounts && snap.accounts['SYSTEM'] && snap.accounts['SYSTEM'].nonce) || 0) + 1;
    const memo = { reason: reason||'faucet', toPubkey: toPubkey };
    const tx = { type:'mint', from:'SYSTEM', to:null, amount: amt, nonce: sysNonce, memo, pubkey:'', sig:'' };
    try { volchain.enqueueTx(tx); return res.json({ ok:true }); }
    catch (e) { return res.status(400).json({ ok:false, error: String(e?.message || e) }); }
  } catch (e) { return res.status(500).json({ ok:false, error:'internal' }); }
});

router.get('/admin/export-snapshot', async (req, res) => {
  try {
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    const secret = getAdminSecret(); if (!secret || hdr !== secret) return res.status(403).json({ ok:false, error:'forbidden' });
    const dataDir = process.env.VOLCHAIN_DIR || path.join(__dirname, '..', 'volchain');
    const file = path.join(dataDir, 'snapshot.json');
    if (!fs.existsSync(file)) return res.status(404).json({ ok:false, error:'snapshot_not_found' });
    res.setHeader('Content-Type', 'application/json');
    fs.createReadStream(file).pipe(res);
  } catch (e) { res.status(500).json({ ok:false, error:'failed' }); }
});

module.exports = router;

// Extended admin endpoints
router.get('/admin/user-balances', (req, res) => {
  try {
    const filePath = path.join(__dirname, '..', 'user_balances.json');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'user_balances.json not found' });
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (e) { res.status(500).json({ error: 'read_failed', details: e.message }); }
});

router.post('/admin/user-balances/update', (req, res) => {
  try { updateUserBalancesFile(); return res.json({ success: true }); } catch (e) { return res.status(500).json({ error:'update_failed', details: e.message }); }
});

router.get('/admin/invariants/check', (req, res) => {
  try {
    const v = require('../volchain_chain.js');
    const snapshot = v.getSnapshot();
    const db = readDB();
    const gridb = readGridB(db.grid.length);
    const issues = enforceInvariants(snapshot, db, gridb);
    res.json({
      status: issues.length === 0 ? 'HEALTHY' : 'ISSUES_DETECTED',
      issues,
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: 'check_failed', details: e.message }); }
});

router.post('/admin/invariants/correct', async (req, res) => {
  try {
    const v = require('../volchain_chain.js');
    const snapshot = v.getSnapshot();
    const db = readDB();
    const gridb = readGridB(db.grid.length);
    const success = await autoCorrectInvariants(snapshot, db, gridb);
    res.json({ success, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: 'correct_failed', details: e.message }); }
});

router.get('/admin/debug/pubkey-resolution', (req, res) => {
  try {
    const db = readDB();
    const snapshot = require('../volchain_chain.js').getSnapshot();
    const info = {
      timestamp: new Date().toISOString(),
      volchain_users: Object.keys(snapshot.balances || {}),
      db_users: (db.users || []).map(u => ({ username: u.username, pubkey: u.powPubkey }))
    };
    res.json(info);
  } catch (e) { res.status(500).json({ error: 'debug_failed', details: e.message }); }
});


// Align Volchain snapshot (balances/staked/supply) from Digzone (db.json) + GridB (gridb.json)
router.post('/admin/volchain-align-from-digzone', (req, res) => {
  try {
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    const secret = getAdminSecret(); if (!secret || hdr !== secret) return res.status(403).json({ ok:false, error:'forbidden' });

    const db = readDB();
    const gridb = readGridB(db.grid.length);
    const volchain = require('../volchain_chain.js');
    const snap = volchain.getSnapshot();

    // Build username -> pubkey map (case-insensitive)
    const nameToPub = {};
    for (const u of (db.users || [])) {
      if (u && u.username) {
        const pk = resolveUsernameToPubkey(u.username, db.users);
        if (pk) nameToPub[String(u.username).toLowerCase()] = pk;
      }
    }

    // Compute mined per pubkey from Digzone (prefer owner/status, fallback dugBy)
    const minedByPk = {};
    for (const b of (db.grid || [])) {
      if (!b) continue;
      let ownerName = null;
      if (b.status === 'dug' && b.owner) ownerName = String(b.owner).toLowerCase();
      else if (b.dugBy) ownerName = String(b.dugBy).toLowerCase();
      if (!ownerName) continue;
      const pk = nameToPub[ownerName] || resolveUsernameToPubkey(ownerName, db.users);
      if (pk) minedByPk[pk] = (minedByPk[pk] || 0) + 1;
    }

    // Compute used per pubkey from GridB defenses
    const usedByPk = {};
    for (const g of (gridb || [])) {
      if (g && g.owner) {
        const pk = resolveUsernameToPubkey(g.owner, db.users);
        if (pk) usedByPk[pk] = (usedByPk[pk] || 0) + Math.max(1, Number(g.defense || 1));
      }
    }

    // Rebuild balances/staked, clamp staked<=balance (normalize keys to lowercase 64-hex)
    const newBalances = {};
    const newStaked = {};
    const keys = new Set([...Object.keys(minedByPk), ...Object.keys(usedByPk)]);
    for (const pk of keys) {
      const key = String(pk).toLowerCase();
      const bal = Math.max(0, Math.floor(Number(minedByPk[pk] || 0)));
      const used = Math.max(0, Math.floor(Number(usedByPk[pk] || 0)));
      newBalances[key] = bal;
      newStaked[key] = Math.min(used, bal);
    }

    // Persist snapshot.json atomically
    const path = require('path');
    const dataDir = process.env.VOLCHAIN_DIR || path.join(__dirname, '..', 'volchain');
    const SNAPSHOT_FILE = path.join(dataDir, 'snapshot.json');
    const updated = { ...snap, balances: newBalances, staked: newStaked };
    try {
      updated.supply = Object.values(newBalances).reduce((s, v) => s + Number(v || 0), 0);
    } catch {}
    const tmp = SNAPSHOT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
    fs.renameSync(tmp, SNAPSHOT_FILE);

    // Also update accounts.json and stats.json to keep server invariants happy
    try {
      const ACCOUNTS_FILE = path.join(__dirname, '..', 'accounts.json');
      const STATS_FILE = path.join(__dirname, '..', 'stats.json');
      // username list
      const accs = [];
      const seen = new Set();
      for (const u of (db.users || [])) {
        const pk = resolveUsernameToPubkey(u.username, db.users);
        if (!pk) continue;
        const mined = Number(newBalances[pk] || 0);
        const used = Number(newStaked[pk] || 0);
        const available = Math.max(0, mined - used);
        accs.push({ username: u.username, balance: mined, used, available });
        seen.add(pk);
      }
      // Any pubkeys without usernames are skipped (no username mapping)
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accs, null, 2));
      const totalSupply = accs.reduce((s,a)=>s+Number(a.balance||0),0);
      let stats = {};
      try { stats = JSON.parse(fs.readFileSync(STATS_FILE,'utf8')); } catch {}
      stats.total_supply = totalSupply;
      if (!Number.isFinite(Number(stats.next_mined_seq))) stats.next_mined_seq = 1;
      fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch {}

    return res.json({ ok:true, balances: Object.keys(newBalances).length, staked: Object.keys(newStaked).length, supply: updated.supply });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'align_failed', details: String(e?.message || e) });
  }
});


