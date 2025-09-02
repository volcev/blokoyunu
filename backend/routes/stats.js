const express = require('express');
const router = express.Router();
const { readDB } = require('../lib/db');
const { computeLocalStats } = require('../lib/stats');

router.get('/top-miners', (req, res) => {
  try {
    const data = readDB();
    const counts = {};
    for (const block of data.grid) {
      if (block.dugBy) {
        const key = block.dugBy;
        if (!counts[key]) {
          const user = data.users.find(u => u.username === key);
          counts[key] = { count: 0, color: user ? user.color : '#888' };
        }
        counts[key].count++;
      }
    }
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([name, info]) => ({ name, count: info.count, color: info.color }));
    res.json(sorted);
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

// Per-user totals: total (balance/mined), used (staked), available
router.get('/stats/users-balances', (req, res) => {
  try {
    const db = readDB();
    const v = require('../volchain_chain.js');
    const snap = v.getSnapshot();
    const balances = snap?.balances || {};
    const staked = snap?.staked || {};

    const users = Array.isArray(db?.users) ? db.users : [];

    // Helper: compute mined/used from Digzone/GridB for fallback
    const minedByUser = {};
    try {
      for (const b of (db?.grid || [])) {
        if (b && b.dugBy) minedByUser[b.dugBy] = (minedByUser[b.dugBy] || 0) + 1;
      }
    } catch {}
    const readGridB = require('../lib/gridb').readGridB;
    let usedByUser = {};
    try {
      const gridb = readGridB((db?.grid || []).length);
      for (const cell of (gridb || [])) {
        if (cell && cell.owner) {
          const def = Number(cell.defense || 1) || 1;
          usedByUser[cell.owner] = (usedByUser[cell.owner] || 0) + def;
        }
      }
    } catch {}

    const rows = users.map(u => {
      const username = String(u?.username || '');
      const hex = (u && u.powPubkey && typeof u.powPubkey === 'string') ? u.powPubkey : null;
      let total = 0, used = 0, available = 0;
      if (hex) {
        const lower = hex.toLowerCase();
        const upper = hex.toUpperCase();
        const bal = Number(balances[lower] ?? balances[upper] ?? 0);
        const stk = Number(staked[lower] ?? staked[upper] ?? 0);
        total = bal;
        used = Math.min(stk, bal);
        available = Math.max(0, bal - used);
      } else {
        // Fallback: derive from Digzone/GridB
        const mined = Number(minedByUser[username] || 0);
        const usedCount = Number(usedByUser[username] || 0);
        total = mined;
        used = Math.min(usedCount, mined);
        available = Math.max(0, mined - used);
      }
      return { username, total, used, available };
    });

    // Sort by total desc
    rows.sort((a, b) => b.total - a.total);

    res.json({ success: true, users: rows });
  } catch (e) {
    res.status(500).json({ error: 'failed' });
  }
});

router.get('/stats/volchain', (req, res) => {
  try {
    const username = String(req.query.username || '');
    const grid = computeLocalStats(username || null);
    // Compose volchain totals from snapshot
    const v = require('../volchain_chain.js');
    const snap = v.getSnapshot();
    const balances = snap?.balances || {};
    let totalSupply = 0;
    for (const key in balances) { totalSupply += Number(balances[key] || 0); }
    let userBalance = 0;
    let userPubkey = null;
    if (username) {
      const db = readDB();
      const user = db.users.find(u => u.username === username);
      const hex = user?.powPubkey ? String(user.powPubkey) : null;
      if (hex) {
        userPubkey = hex;
        const lower = hex.toLowerCase();
        const upper = hex.toUpperCase();
        userBalance = Number(balances[lower] || balances[upper] || 0);
      }
    }
    res.json({ success: true, grid, source: 'volchain', volchain: { totalSupply, currentUser: { balance: userBalance, pubkey: userPubkey } } });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

router.get('/stats/blockchain', async (req, res) => {
  try {
    const username = req.query.username;
    const stats = computeLocalStats(username);
    res.json(stats);
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

module.exports = router;



