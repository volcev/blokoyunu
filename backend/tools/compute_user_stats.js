#!/usr/bin/env node
/*
Aggregates per-user stats from:
- File store: db.json (dig grid with dugBy/owner), gridb.json (defense)
- VolChain snapshot via volchain_chain.js (balances)
- PostgreSQL (optional): dig_blocks, gridb_blocks, accounts, users

Outputs JSON with per-user stats for: file(db+gridb), pg, volchain and a summary diff.
*/

const fs = require('fs');
const path = require('path');

// Lazy PG import; handle absence or connectivity gracefully
let pg = null;
try { pg = require('../lib/pg'); } catch {}

function readJSON(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

function safeGetVolchainSnapshot() {
  try {
    const v = require('../volchain_chain.js');
    return v.getSnapshot();
  } catch (e) {
    try {
      const snapPath = path.join(__dirname, '..', 'volchain', 'snapshot.json');
      return readJSON(snapPath) || {};
    } catch {
      return {};
    }
  }
}

function aggregateFromFile(dbPath, gridbPath) {
  const db = readJSON(dbPath);
  const gridb = readJSON(gridbPath);
  const result = { users: {}, totals: { dugCells: 0 } };
  if (!db || !Array.isArray(db.grid)) return result;
  // Count dug cells and per-user mined/owned
  for (const b of db.grid) {
    if (!b || b.status !== 'dug') continue;
    result.totals.dugCells += 1;
    if (b.dugBy) {
      const u = result.users[b.dugBy] || { mined: 0, owned: 0, defense: 0 };
      u.mined += 1;
      result.users[b.dugBy] = u;
    }
    if (b.owner) {
      const u = result.users[b.owner] || { mined: 0, owned: 0, defense: 0 };
      u.owned += 1;
      result.users[b.owner] = u;
    }
  }
  // Defense from gridb.json
  if (Array.isArray(gridb)) {
    for (const gb of gridb) {
      if (gb && gb.owner && typeof gb.defense === 'number') {
        const u = result.users[gb.owner] || { mined: 0, owned: 0, defense: 0 };
        u.defense += gb.defense;
        result.users[gb.owner] = u;
      }
    }
  }
  return result;
}

async function aggregateFromPG() {
  const result = { users: {}, totals: { dugCells: 0 } };
  if (!pg) return result;
  try {
    await pg.ensureSchema();
  } catch {}
  try {
    const { rows: digRows } = await pg.query('SELECT dug_by AS username FROM dig_blocks WHERE status = $1', ['dug']);
    for (const r of digRows) {
      if (!r.username) continue;
      result.totals.dugCells += 1;
      const u = result.users[r.username] || { mined: 0, owned: 0, defense: 0 };
      u.mined += 1;
      result.users[r.username] = u;
    }
  } catch {}
  try {
    const { rows: gbRows } = await pg.query('SELECT owner, defense FROM gridb_blocks');
    for (const r of gbRows) {
      if (!r.owner) continue;
      const def = Number(r.defense || 0);
      const u = result.users[r.owner] || { mined: 0, owned: 0, defense: 0 };
      u.owned += 1;
      u.defense += def;
      result.users[r.owner] = u;
    }
  } catch {}
  // VolChain balances from accounts table if present
  try {
    const { rows: acct } = await pg.query('SELECT pubkey, balance FROM accounts');
    result.accounts = acct;
  } catch {}
  // Map usernames to pubkeys (if available)
  try {
    const { rows: users } = await pg.query('SELECT username, pow_pubkey FROM users');
    result.userPub = {};
    for (const r of users) {
      if (r.username && r.pow_pubkey) result.userPub[r.username] = r.pow_pubkey;
    }
  } catch {}
  return result;
}

function aggregateFromVolchain(dbPath) {
  const snap = safeGetVolchainSnapshot();
  const balances = snap && snap.balances ? snap.balances : {};
  const db = readJSON(dbPath) || { users: [] };
  const pubToUser = {};
  if (Array.isArray(db.users)) {
    for (const u of db.users) {
      if (u && u.powPubkey) pubToUser[String(u.powPubkey)] = u.username;
    }
  }
  const result = { users: {}, totals: { totalSupply: 0 } };
  for (const [pub, balRaw] of Object.entries(balances)) {
    const balance = Number(balRaw || 0);
    result.totals.totalSupply += balance;
    const username = pubToUser[pub] || pubToUser[pub.toLowerCase()] || pubToUser[pub.toUpperCase()] || null;
    const key = username || pub;
    const u = result.users[key] || { balance: 0 };
    u.balance += balance;
    result.users[key] = u;
  }
  return result;
}

(async () => {
  const baseDir = path.join(__dirname, '..');
  const dbPath = path.join(baseDir, 'db.json');
  const gridbPath = path.join(baseDir, 'gridb.json');

  const fileAgg = aggregateFromFile(dbPath, gridbPath);
  const pgAgg = await aggregateFromPG();
  const volAgg = aggregateFromVolchain(dbPath);

  // Compose unified per-user view
  const usernames = new Set([
    ...Object.keys(fileAgg.users),
    ...Object.keys(pgAgg.users || {}),
    ...Object.keys(volAgg.users)
  ]);

  // Optional mapping username -> pubkey from db.json users
  const db = readJSON(dbPath) || { users: [] };
  const userPub = {};
  if (Array.isArray(db.users)) {
    for (const u of db.users) {
      if (u && u.username) userPub[u.username] = u.powPubkey || null;
    }
  }

  const perUser = {};
  for (const name of usernames) {
    const f = fileAgg.users[name] || { mined: 0, owned: 0, defense: 0 };
    const p = (pgAgg.users && pgAgg.users[name]) || { mined: 0, owned: 0, defense: 0 };
    const v = volAgg.users[name] || { balance: 0 };
    perUser[name] = {
      username: name,
      pubkey: userPub[name] || null,
      file: f,
      pg: p,
      volchain: v
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    file: fileAgg.totals,
    volchain: { totalSupply: volAgg.totals.totalSupply },
    users: perUser
  };

  const outPath = path.join(baseDir, 'user_stats_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(outPath);
})();




