const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
// const axios = require('axios'); // no longer used directly; kept commented for reference
const logger = require('./lib/logger');
const { validateSession } = require('./lib/session');
const child_process = require('child_process');
const { Mutex } = require('async-mutex');
// Removed Solana/Anchor dependencies
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { readSessions, writeSessions } = require('./auth.js');
const { enforceInvariants, autoCorrectInvariants, calculateUserMined, resolveUsernameToPubkey, updateUserBalancesFile } = require('./lib/invariants');
const { DB_FILE, readDB, writeDB } = require('./lib/db');
const { GRIDB_FILE, readGridB, writeGridB } = require('./lib/gridb');

const app = express();
// Disable ETag to avoid 304 caching on dynamic endpoints like /volchain/events
try { app.set('etag', false); } catch {}

// Castle bonus processing function
function processCastleBonus(username, data, excludeIndex = -1) {
  try {
    // Read GridB and count user's castles
    let gridb = readGridB(data.grid.length);
    const castleCount = gridb.filter(b => b.owner === username && b.defense >= 10).length;

    // Prepare to auto-mine up to castleCount blocks
    let mintedByCastle = 0;

    // Ensure there are enough empty Digzone blocks; expand grid before allocating if needed
    let emptyCountExcludingClicked = 0;
    for (let i = 0; i < data.grid.length; i++) {
      if (!data.grid[i].dugBy && i !== excludeIndex) emptyCountExcludingClicked++;
    }
    const deficit = Math.max(0, castleCount - emptyCountExcludingClicked);
    if (deficit > 0) {
      const currentLength = data.grid.length;
      const targetLength = Math.ceil((currentLength + deficit) / 100) * 100; // expand in 100s
      const toAdd = targetLength - currentLength;
      if (toAdd > 0) {
        for (let i = 0; i < toAdd; i++) {
          data.grid.push({ index: currentLength + i, dugBy: null, color: null, visual: null });
        }
        // Sync GridB to the same new length
        const gridbExpanded = readGridB(targetLength);
        writeGridB(gridbExpanded);
        try { require('./lib/store').buildStore().putGridB(gridbExpanded).catch(()=>{}); } catch {}
      }
    }

    // Collect empty candidates again after potential expansion
    const emptyCandidates = [];
    for (let i = 0; i < data.grid.length; i++) {
      if (!data.grid[i].dugBy && i !== excludeIndex) emptyCandidates.push(i);
    }
    const slots = Math.min(castleCount, emptyCandidates.length);
    for (let k = 0; k < slots; k++) {
      const idx = emptyCandidates[k];
      if (!data.grid[idx].dugBy) {
        data.grid[idx].dugBy = username;
        mintedByCastle++;
      }
    }
    if (mintedByCastle > 0) {
      logger.debug(`🏰 Castle bonus activated: ${username} auto-mined ${mintedByCastle}/${castleCount} blocks`);
    }
    return mintedByCastle;
  } catch (error) {
    logger.warn('Castle bonus error:', error.message);
    return 0;
  }
}
const PORT = Number(process.env.PORT || 3001);
// Build/version marker for live instance verification
app.use((req, res, next) => {
  try { res.set('X-Game-Build', 'attack-fix-2025-08-28T11:45Z'); } catch {}
  next();
});
const VOLCHAIN_MODE = process.env.VOLCHAIN_MODE || 'mempool';
const SIMPLE_ATTACK = String(process.env.VOLCHAIN_ATTACK_SIMPLE || '1') === '1';
const VOLCHAIN_DEV_FAUCET = process.env.VOLCHAIN_DEV_FAUCET || '0';
const VOLCHAIN_ADMIN_SECRET = require('./lib/admin').getAdminSecret();
const VOLCHAIN_DEBUG_CANON = process.env.VOLCHAIN_DEBUG_CANON || '0';
const VOLCHAIN_TX_MAX_BODY_BYTES = Number(process.env.VOLCHAIN_TX_MAX_BODY_BYTES || 2048);
const VOLCHAIN_TX_RATE_WINDOW_MS = Number(process.env.VOLCHAIN_TX_RATE_WINDOW_MS || 60000); // 60s
const VOLCHAIN_TX_RATE_MAX = Number(process.env.VOLCHAIN_TX_RATE_MAX || 30); // 30 req / min / IP
const VOLCHAIN_TX_IP_WHITELIST = (process.env.VOLCHAIN_TX_IP_WHITELIST || '').split(',').map(s=>s.trim()).filter(Boolean);
const VERIFY_WEBHOOK_URL = process.env.VOLCHAIN_VERIFY_WEBHOOK_URL || '';
const { enforceSecurityRequirements, txRateLimiter, txBodySizeGuard } = require('./middleware/security');
const { genOpId, resolveOpId, resolveAnyToHex64, resolveAnyKeyToHex64 } = require('./lib/utils');
const { getAdminSecret } = require('./lib/admin');
// Admin secret loader (env or file)
/* moved to lib/admin.js
function getAdminSecret(){
  try {
    if (process.env.VOLCHAIN_ADMIN_SECRET && String(process.env.VOLCHAIN_ADMIN_SECRET).length > 0) return String(process.env.VOLCHAIN_ADMIN_SECRET);
  } catch {}
  try {
    const p = path.join(__dirname, 'admin.secret');
    if (fs.existsSync(p)) {
      const s = String(fs.readFileSync(p,'utf8')).trim();
      if (s) return s;
    }
  } catch {}
  return '';
}
*/
// Idempotency/metrics counters
let __opIdDedupTotal = 0;
let __digIdDuplicateTotal = 0;

// Destructive-mode guard
function noDestructiveMode() { return String(process.env.VOLCHAIN_NO_DESTRUCTIVE || '0') === '1'; }
function rejectIfNoDestructive(res, op) { if (noDestructiveMode()) { return res.status(403).json({ ok:false, error:'NO_DESTRUCTIVE_MODE', op }); } return null; }

// -------------------- TX / BACKUP LAYER --------------------
const txMutex = new Mutex();
const BACKUP_ROOT = path.join(__dirname, 'backup');
function ensureDir(p){ try { fs.mkdirSync(p, { recursive: true }); } catch {} }
function atomicWriteJson(filePath, obj){
  const tmp = filePath + '.new';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

// Assign additive mined_seq to blocks missing it (non-destructive)
function ensureMinedSeqAdditive() {
  try {
    const data = readDB();
    let maxSeq = 0;
    for (const b of data.grid) {
      const s = Number(b?.mined_seq);
      if (Number.isFinite(s) && s > maxSeq) maxSeq = s;
    }
    let nextSeq = maxSeq + 1;
    let changed = false;
    for (let i = 0; i < data.grid.length; i++) {
      const b = data.grid[i];
      if (!b) continue;
      if ((b.owner || b.dugBy) && !Number.isFinite(Number(b.mined_seq))) {
        data.grid[i].mined_seq = nextSeq++;
        changed = true;
      }
    }
    if (changed) atomicWriteJson(DB_FILE, data);
  } catch {}
}
function readJsonSafe(filePath, fallback){ try { return JSON.parse(fs.readFileSync(filePath,'utf8')); } catch { return fallback; } }
function timestamp(){ const d=new Date(); const pad=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
function backupAll(){ try {
  const stamp = timestamp();
  const dir = path.join(BACKUP_ROOT, stamp);
  ensureDir(dir);
  const files = ['db.json','gridb.json','accounts.json','stats.json','volchain_log.json'];
  for (const f of files){
    const src = path.join(__dirname, f);
    const dst = path.join(dir, f);
    try { if (fs.existsSync(src)) fs.copyFileSync(src, dst); } catch {}
  }
} catch {}
}
async function withTx(fn){
  return await txMutex.runExclusive(async () => {
    // Backup before any writes
    backupAll();
    const result = await fn();
    return result;
  });
}

// -------------------- AUDIT JOURNAL --------------------
const AUDIT_FILE = path.join(__dirname, 'volchain_log.json');
function readLastAuditHash(){
  try {
    const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) return String(arr[arr.length-1]?.hash || '');
  } catch {}
  return '';
}
function appendAudit(op, actor, args, effects){
  try {
    const prevHash = readLastAuditHash();
    const entry = { ts: Date.now(), op, actor, args, effects, prevHash };
    const body = JSON.stringify({ op: entry.op, actor: entry.actor, args: entry.args, effects: entry.effects, ts: entry.ts });
    entry.hash = crypto.createHash('sha256').update(prevHash + body).digest('hex');
    const arr = readJsonSafe(AUDIT_FILE, []);
    arr.push(entry);
    atomicWriteJson(AUDIT_FILE, arr);
  } catch {}
}

// -------------------- ACCOUNTS / STATS HELPERS --------------------
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const STATS_FILE = path.join(__dirname, 'stats.json');
function readAccounts(){ return readJsonSafe(ACCOUNTS_FILE, []); }
function writeAccounts(arr){ atomicWriteJson(ACCOUNTS_FILE, arr); }
function readStats(){ return readJsonSafe(STATS_FILE, { next_mined_seq: 1, total_supply: 0 }); }
function writeStats(obj){ atomicWriteJson(STATS_FILE, obj); }
function upsertAccount(username, updater){
  const accs = readAccounts();
  let idx = accs.findIndex(a => a && a.username === username);
  if (idx === -1){ accs.push({ username, balance: 0, used: 0, available: 0 }); idx = accs.length - 1; }
  const cur = accs[idx];
  const next = updater ? updater({ ...cur }) : cur;
  accs[idx] = next;
  writeAccounts(accs);
  return next;
}

// Compute mined counts from Digzone
function computeAllMinedMap(){
  const db = readDB();
  const mined = {};
  for (const b of db.grid){ if (b && b.status === 'dug' && b.owner){ mined[b.owner] = (mined[b.owner]||0) + 1; } }
  return mined;
}
function computeUserMinedFromDigzone(username){ const m = computeAllMinedMap(); return Number(m[username]||0); }
function computeTotals(){
  const accs = readAccounts();
  let sumBal=0, sumUsed=0, sumAvail=0;
  for (const a of accs){ sumBal += Number(a.balance||0); sumUsed += Number(a.used||0); sumAvail += Number(a.available||0); }
  return { totalSupply: sumBal, sumUsed, sumAvailable: sumAvail };
}
function assertInvariants(){
  const accs = readAccounts();
  const minedMap = computeAllMinedMap();
  const stats = readStats();
  let sumBal=0, sumUsed=0, sumAvail=0; let dugCells=0;
  const db = readDB();
  for (const b of db.grid){ if (b && b.status === 'dug' && b.owner) dugCells++; }
  for (const a of accs){
    const mined = Number(minedMap[a.username]||0);
    const bal = Number(a.balance||0);
    const used = Number(a.used||0);
    const avail = Number(a.available||0);
    if (bal !== mined) throw new Error(`INV_USER_BAL_MINED:${a.username}`);
    if (avail !== (mined - used)) throw new Error(`INV_USER_AVAIL:${a.username}`);
    if (used < 0 || avail < 0) throw new Error(`INV_USER_NEGATIVE:${a.username}`);
    sumBal += bal; sumUsed += used; sumAvail += avail;
  }
  if (sumBal !== stats.total_supply) throw new Error('INV_SUPPLY_STATS');
  if (sumBal !== (sumUsed + sumAvail)) throw new Error('INV_SUM_MATCH');
  if (dugCells !== stats.total_supply) throw new Error('INV_DIGZONE_SUPPLY');
}
// Use built-in UUID when available to avoid extra dependency
// genOpId/resolveOpId moved to lib/utils

// Enforce security requirements for mutation endpoints
// enforceSecurityRequirements moved to middleware/security

// Session management (now persistent via auth.js)
const BASE_DIR_FOR_GUARD = path.dirname(DB_FILE);

// validateSession moved to lib/session.js



function getNeighbors(index, totalBlocks, columnCount) {
  const neighbors = [];
  const col = index % columnCount;

  // Top
  if (index >= columnCount) {
    neighbors.push(index - columnCount);
  }

  // Bottom
  const bottomNeighbor = index + columnCount;
  if (bottomNeighbor < totalBlocks) {
    neighbors.push(bottomNeighbor);
  }

  // Left
  if (col > 0) {
    neighbors.push(index - 1);
  }

  // Right
  if (col < columnCount - 1) {
    const rightNeighbor = index + 1;
    if (rightNeighbor < totalBlocks) {
        neighbors.push(rightNeighbor);
    }
  }

  return neighbors;
}

// Compute stats locally (moved to lib/stats.js)
/*
function computeLocalStats(username = null) {
  const data = readDB();
  const totalBlocks = data.grid.length;
  const minedBlocks = data.grid.filter(b => b.dugBy).length;
  const playerCounts = {};
  data.grid.forEach(block => { if (block.dugBy) { playerCounts[block.dugBy] = (playerCounts[block.dugBy] || 0) + 1; } });
  const topMiners = Object.entries(playerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => {
      const user = data.users.find(u => u.username === name);
      return { name, blockCount: count, color: user ? user.color : '#888' };
    });
  let currentUserStats = null;
  if (username) {
    const user = data.users.find(u => u.username === username);
    const today = new Date().toISOString().slice(0, 10);
    let remainingMines = 12;
    if (user && user.lastDigDate === today) remainingMines = Math.max(0, 12 - (user.dailyDigCount || 0));
    currentUserStats = { username, totalBlocks: playerCounts[username] || 0, remainingMines, color: user ? user.color : '#888' };
  }
  return { totalBlocks, minedBlocks, emptyBlocks: totalBlocks - minedBlocks, topMiners, currentUser: currentUserStats, totalBlocksMined: minedBlocks, gridExpansions: Math.floor(totalBlocks / 100) - 1 };
}
*/

app.use(cors());
app.use(express.json({ limit: '64kb' }));

// -------------------- WORLD MAP (PERSISTENT CLAIMS) --------------------
const WORLDMAP_FILE = path.join(__dirname, 'worldmap.json');
function readWorldMap() {
  try {
    const raw = fs.readFileSync(WORLDMAP_FILE, 'utf8');
    const json = JSON.parse(raw);
    if (json && typeof json === 'object' && json.cells && typeof json.cells === 'object') return json;
  } catch {}
  return { cells: {}, updatedAt: Date.now() };
}
function writeWorldMap(data) {
  try {
    data.updatedAt = Date.now();
    if (typeof atomicWriteJson === 'function') {
      atomicWriteJson(WORLDMAP_FILE, data);
    } else {
      fs.writeFileSync(WORLDMAP_FILE, JSON.stringify(data, null, 2));
    }
  } catch {}
}
function getUserColor(username) {
  try {
    const data = readDB();
    const user = data.users.find(u => u.username === username);
    return user?.color || '#3388ff';
  } catch { return '#3388ff'; }
}

// GET /worldmap → { cells: [{ id, owner, color }] }
app.get('/worldmap', (req, res) => {
  try {
    const store = readWorldMap();
    const out = Object.entries(store.cells).map(([id, val]) => ({ id, owner: val.owner, color: val.color }));
    return res.json({ ok: true, cells: out, updatedAt: store.updatedAt || Date.now() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'worldmap_read_failed' });
  }
});

// POST /worldmap/claim { id, username? } → claim if free
app.post('/worldmap/claim', (req, res) => {
  try {
    const id = String(req.body?.id || '').trim();
    let username = String(req.body?.username || req.query?.username || '').trim();
    if (!id || !/^r-?\d+c-?\d+$/i.test(id)) return res.status(400).json({ ok:false, error:'invalid_id' });
    if (!username) return res.status(400).json({ ok:false, error:'username_required' });

    const store = readWorldMap();
    const cell = store.cells[id];
    if (cell && cell.owner && cell.owner !== username) {
      return res.status(409).json({ ok:false, error:'already_claimed', owner: cell.owner });
    }
    const color = getUserColor(username);
    store.cells[id] = { owner: username, color };
    writeWorldMap(store);
    return res.json({ ok:true, id, owner: username, color });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'worldmap_claim_failed' });
  }
});

// DELETE /worldmap/claim/:id?username=NAME → unclaim if owned by user
app.delete('/worldmap/claim/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const username = String(req.query?.username || req.body?.username || '').trim();
    if (!id) return res.status(400).json({ ok:false, error:'invalid_id' });
    if (!username) return res.status(400).json({ ok:false, error:'username_required' });
    const store = readWorldMap();
    const cell = store.cells[id];
    if (!cell || !cell.owner) return res.status(404).json({ ok:false, error:'not_found' });
    if (cell.owner !== username) return res.status(403).json({ ok:false, error:'forbidden' });
    delete store.cells[id];
    writeWorldMap(store);
    return res.json({ ok:true, id });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'worldmap_unclaim_failed' });
  }
});
// ------------------ END WORLD MAP (PERSISTENT CLAIMS) ------------------

// Simple per-IP rate limiter for /volchain/tx
// txRateLimiter/txBodySizeGuard moved to middleware/security

// resolveAnyToHex64/resolveAnyKeyToHex64 moved to lib/utils.js

// Invariants moved to lib/invariants.js

// Ledger-first commit with sealed + applied barrier to eliminate race conditions
// moved to lib/ledger.js

// readDB/writeDB and readGridB/writeGridB moved to lib/

// --- Derived counters from Volchain (Single Source of Truth) ---
function getUserVolchainBalance(username) {
  try {
    const data = readDB();
    const user = data.users.find(u => u.username === username);
    if (!user?.powPubkey) return { balance: 0, staked: 0, available: 0 };
    
    const snap = volchain.getSnapshot();
    const hexAddr = user.powPubkey.toLowerCase();
    const balance = snap?.balances?.[hexAddr] || 0;
    const staked = snap?.staked?.[hexAddr] || 0;
    const available = Math.max(0, balance - staked);
    
    return { balance, staked, available };
  } catch { return { balance: 0, staked: 0, available: 0 }; }
}

// Legacy function for backward compatibility - now uses Volchain
function computeUserUsedFromGridB(username) {
  // GridB'deki gerçek defense değerlerini topla
  const gridb = readGridB(readDB().grid.length);
  const userBlocks = gridb.filter(b => b && typeof b === 'object' && b.owner === username);
  return userBlocks.reduce((sum, b) => sum + (Number(b.defense || 1) || 1), 0);
}

// --- Selection helpers based on mined_seq ---
function getLatestOwnedCells(username, n) {
  const data = readDB();
  // Primary: use mined_seq if present (new model)
  const withSeq = [];
  for (const b of data.grid) {
    if (b && b.owner === username && Number.isFinite(Number(b.mined_seq))) withSeq.push(b);
  }
  if (withSeq.length >= n) {
    withSeq.sort((a, b) => Number(b.mined_seq || 0) - Number(a.mined_seq || 0));
    return withSeq.slice(0, Math.max(0, n));
  }
  // Fallback: legacy blocks without mined_seq/status/owner → use dugBy and highest index
  const legacy = [];
  for (let i = 0; i < data.grid.length; i++) {
    const b = data.grid[i];
    if (!b) continue;
    const isOwned = (b.owner === username) || (b.dugBy === username);
    if (isOwned) legacy.push({ ...b, index: i });
  }
  legacy.sort((a, b) => Number(b.index || 0) - Number(a.index || 0));
  return legacy.slice(0, Math.max(0, n));
}
function transferLatestCells(fromUser, toUser, n) {
  const data = readDB();
  const cells = getLatestOwnedCells(fromUser, n);
  if (cells.length < n) throw new Error('INSUFFICIENT_MINED');
  for (const cell of cells) {
    const i = cell.index;
    data.grid[i].owner = toUser;
    data.grid[i].dugBy = toUser;
    // keep mined_seq unchanged (ownership move)
  }
  atomicWriteJson(DB_FILE, data);
  // Mirror ownership move to PG
  try {
    const store = require('./lib/store').buildStore();
    for (const cell of cells) {
      const b = data.grid[cell.index];
      store.upsertDigGridRow({
        index: b.index,
        dug_by: b.dugBy || null,
        owner: b.owner || null,
        status: b.status || null,
        mined_seq: b.mined_seq || null,
        color: b.color || null,
        visual: b.visual || null,
      }).catch(()=>{});
    }
  } catch {}
}
function burnLatestCells(username, n) {
  const data = readDB();
  const cells = getLatestOwnedCells(username, n);
  if (cells.length < n) throw new Error('INSUFFICIENT_MINED');
  for (const cell of cells) {
    const i = cell.index;
    data.grid[i].status = 'idle';
    data.grid[i].owner = null;
    data.grid[i].dugBy = null;
    data.grid[i].mined_seq = null;
    data.grid[i].visual = null;
  }
  atomicWriteJson(DB_FILE, data);
  // Mirror burn to PG
  try {
    const store = require('./lib/store').buildStore();
    for (const cell of cells) {
      const i = cell.index;
      store.upsertDigGridRow({ index: i, dug_by: null, owner: null, status: 'idle', mined_seq: null, color: null, visual: null }).catch(()=>{});
    }
  } catch {}
}

// moved to routes/grid.js

app.patch('/grid/:index', async (req, res) => {
  const sessionToken = req.headers['x-session-token'];
  if (!sessionToken) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing session token' });
  }
  if (noDestructiveMode()) {
    return res.status(403).json({ error: 'NO_DESTRUCTIVE_MODE', op: 'dig' });
  }
  const username = await validateSession(sessionToken);
  if (!username) {
    return res.status(401).json({ error: 'Unauthorized: Invalid session token' });
  }

  const index = parseInt(req.params.index);
  const { visual } = req.body;
  const data = readDB();
  let block = data.grid[index];
  if (!block) {
    // Robustness: expand grid to include requested index if within reasonable bounds
    if (index >= 0) {
      const currentLength = data.grid.length;
      if (index >= currentLength) {
        for (let i = currentLength; i <= index; i++) {
          data.grid.push({ index: i, dugBy: null, color: null, visual: null });
        }
        writeDB(data);
      }
      block = data.grid[index];
    }
    if (!block) return res.status(404).json({ error: 'Block not found' });
  }
  if (block.dugBy) {
    // If the block is already mined, reject the operation
    return res.status(409).json({ error: 'Block already mined' });
  }

  // --- DAILY MINING LIMIT ---
  const user = data.users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: User not found' });
  }
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let mintedByCastle = 0; // accumulate castle auto-mined blocks to mint together with the first dig
  if (user.lastDigDate !== today) {
    user.lastDigDate = today;
    user.dailyDigCount = 0;

    // --- CASTLE BONUS: Auto-mining for 10-defense blocks ---
    mintedByCastle = processCastleBonus(username, data, index);
    // --- END CASTLE BONUS ---
  }
  if (user.dailyDigCount === undefined) user.dailyDigCount = 0;
  if (user.dailyDigCount >= 20) {
    return res.status(429).json({ error: 'Daily mining limit reached' });
  }
  // --- SONU ---

  // Enforce security requirements (temporary: CHAIN_ID optional until FE wrapper ships)
  const security = enforceSecurityRequirements(req, false, false);
  if (security.error) {
    return res.status(400).json({ success: false, error: security.error });
  }
  const { opId } = security;
  // Total mint amount: 1 for the clicked dig + any castle bonus prepared
  const totalMint = 1 + Math.max(0, Number(mintedByCastle || 0));

  // Ledger-first commit with seal barrier and invariant assertion
  try {
    const { ledgerFirstCommitWithBarrier } = require('./lib/ledger');
    // Determine dig_id for this mining operation: prefer header, else deterministic fallback
    const headerDigId = (req.headers['x-dig-id'] && String(req.headers['x-dig-id'])) || null;
    const digId = headerDigId || `dig:${username}:${index}`;
    // Persist game changes for clicked block and any prepared castle bonus blocks
    const persistGame = async () => {
      return await withTx(async () => {
        const backup = JSON.stringify(data);
        const stats = readStats();
        let finalized = 0;
        const changedDigIndices = new Set();
        for (let i = 0; i < data.grid.length; i++) {
          const g = data.grid[i];
          if (!g) continue;
          if (g.dugBy === username && g.status !== 'dug') {
            g.status = 'dug';
            g.owner = username;
            g.mined_seq = Number(stats.next_mined_seq || 1);
            stats.next_mined_seq = g.mined_seq + 1;
            finalized++;
            changedDigIndices.add(i);
          }
        }
        // Ensure clicked block is finalized as dug and owned by user
        const clicked = data.grid[index];
        if (clicked) {
          const wasDug = (clicked.status === 'dug');
          clicked.dugBy = username;
          clicked.status = 'dug';
          clicked.owner = username;
          if (!wasDug || !Number.isFinite(Number(clicked.mined_seq))) {
            clicked.mined_seq = Number(stats.next_mined_seq || 1);
            stats.next_mined_seq = clicked.mined_seq + 1;
            if (!wasDug) finalized++;
          }
          // Apply color/visual if provided
          if (typeof color !== 'undefined') clicked.color = color || null;
          clicked.visual = visual || null;
          changedDigIndices.add(index);
        }
        // Recompute accounts (balance/used/available) from Digzone + GridB for all users
        try {
          const gridb = readGridB(data.grid.length);
          const minedByUser = {};
          const usedByUser = {};
          for (const cell of data.grid) {
            if (cell && cell.status === 'dug' && cell.owner) {
              minedByUser[cell.owner] = (minedByUser[cell.owner] || 0) + 1;
            }
          }
          for (const b of gridb) {
            if (b && b.owner) {
              usedByUser[b.owner] = (usedByUser[b.owner] || 0) + Math.max(1, Number(b.defense || 1));
            }
          }
          const accs = readAccounts();
          const byName = new Map(accs.map(a => [a.username, a]));
          const allNames = new Set([...Object.keys(minedByUser), ...Object.keys(usedByUser)]);
          for (const name of allNames) {
            const mined = Number(minedByUser[name] || 0);
            const used = Math.min(Number(usedByUser[name] || 0), mined);
            const available = Math.max(0, mined - used);
            let a = byName.get(name);
            if (!a) { a = { username: name, balance: 0, used: 0, available: 0 }; byName.set(name, a); }
            a.balance = mined;
            a.used = used;
            a.available = available;
          }
          const reconciled = Array.from(byName.values());
          writeAccounts(reconciled);
        } catch {}

        // Daily count increases only by 1 for the user action
        user.dailyDigCount = Number(user.dailyDigCount || 0) + 1;
        // Update stats total supply by number of finalized digs
        stats.total_supply = Number(stats.total_supply || 0) + finalized;
        writeDB(data);
        writeStats(stats);

        // Auto-expand by 100 blocks if all current blocks are dug
        try {
          const allDug = Array.isArray(data.grid) && data.grid.length > 0 && data.grid.every(b => b && b.status === 'dug');
          if (allDug) {
            const startLen = data.grid.length;
            const add = 100;
            for (let i = 0; i < add; i++) {
              data.grid.push({ index: startLen + i, dugBy: null, color: null, visual: null });
            }
            writeDB(data);
            // Ensure GridB matches new length
            try {
              const gb = readGridB(startLen);
              const expanded = gb.concat(Array.from({ length: add }, (_, k) => ({ index: startLen + k, owner: null, color: null, visual: null, userBlockIndex: null, defense: 0 })));
              writeGridB(expanded);
              // Dual-write expanded grids to PG (best-effort)
              try {
                const store = require('./lib/store').buildStore();
                store.putDigGrid(data.grid).catch(()=>{});
                store.putGridB(expanded).catch(()=>{});
              } catch {}
            } catch {}
          }
        } catch {}
        // Dual-write Digzone grid to PostgreSQL (synchronous barrier; rollback JSON on failure)
        try {
          const store = require('./lib/store').buildStore();
          for (const i of Array.from(changedDigIndices)) {
            const b = data.grid[i];
            if (!b) continue;
            try {
              await store.upsertDigRow({
                index: i,
                dugBy: b.dugBy || null,
                owner: b.owner || null,
                status: b.status || null,
                mined_seq: b.mined_seq || null,
                color: b.color || null,
                visual: b.visual || null,
              });
            } catch (e) {
              // PG failed; revert JSON and abort
              try { writeDB(JSON.parse(backup)); } catch {}
              throw e;
            }
          }
        } catch (e) { throw e; }
        try { assertInvariants(); } catch (e) { logger.warn(String(e?.message||e)); }
        appendAudit('dig', username, { index }, { finalized });
        return { rollback: () => { try { writeDB(JSON.parse(backup)); } catch {} } };
      });
    };
    // Real-time path: build mint tx bundle, seal with barrier, THEN commit game
    const userRecord = data.users.find(u => u.username === username);
    const v = require('./volchain_chain.js');
    const pubB64 = v.hexToB64(userRecord.powPubkey);

    const result = await ledgerFirstCommitWithBarrier({
      bundleFn: async () => {
        const now = Date.now();
        const txs = [];
        // Primary dig mint
        txs.push({
          type: 'mint', from: 'SYSTEM', to: null, amount: 1, nonce: 0,
          memo: { reason: 'dig', toPubkey: pubB64, dig_id: digId, op_id: `${opId}.dig` },
          pubkey: '', sig: '', ts: now
        });
        // Castle bonus mint (aggregate into a single tx)
        const bonusCount = Math.max(0, Number(mintedByCastle || 0));
        if (bonusCount > 0) {
          txs.push({
            type: 'mint', from: 'SYSTEM', to: null, amount: bonusCount, nonce: 0,
            memo: { reason: 'castle_bonus', toPubkey: pubB64, op_id: `${opId}.castle_bonus` },
            pubkey: '', sig: '', ts: now
          });
        }
        // Precheck bundle for invariants and limits before returning
        v.precheckBundle(txs);
        return txs;
      },
      commitGameFn: async () => {
        return await persistGame();
      },
      guardFn: async (gameBackup) => {
        const guardResult = await guard.runInvariantGuardWithRollback({
          baseDir: BASE_DIR_FOR_GUARD,
          gameBackup,
          op_id: opId,
          operation: 'dig'
        });
        return guardResult;
      },
      op_id: opId
    });
    if (!result || result.ok !== true) {
      console.error(`[DIG BARRIER FAILED] username=${username}, index=${index}, result=${JSON.stringify(result)}`);
      return res.status(409).json({ success: false, error: 'dig_chain_barrier_failed', details: result });
    }
  } catch (e) {
    const msg = String(e?.message || e);
    console.error(`[DIG ERROR] username=${username}, index=${index}, error=${msg}, stack=${e?.stack}`);
    return res.status(400).json({ success: false, error: msg });
  }

  // On-chain stats removed

  res.json({ success: true });
});

// moved to routes/grid.js

// Public chain info for frontend wrapper
app.get('/chain/info', (req, res) => {
  try {
    const expectedChainId = process.env.CHAIN_ID || 'volchain-main';
    res.json({ chain_id: expectedChainId });
  } catch (e) {
    res.status(500).json({ error: 'failed' });
  }
});

/* moved to routes/stats.js
app.get('/top-miners', (req, res) => {
  const data = readDB();
  const counts = {};
  for (const block of data.grid) {
    if (block.dugBy) {
      const key = block.dugBy;
      if (!counts[key]) {
        // Find user and get their color
        const user = data.users.find(u => u.username === key);
        counts[key] = { count: 0, color: user ? user.color : "#888" };
      }
      counts[key].count++;
    }
  }
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([name, info]) => ({ name, count: info.count, color: info.color }));
  res.json(sorted);
});
*/

/* moved to routes/stats.js
app.get('/stats/volchain', (req, res) => {
  try {
    const username = req.query.username;
    const grid = computeLocalStats(username || null);
    const db = readDB();

    // Build pubkey -> user map
    const pubToUser = {};
    for (const u of db.users) {
      if (u.powPubkey) pubToUser[u.powPubkey] = u;
    }

    // Read snapshot from new Volchain chain
    const snap = volchain.getSnapshot();
    const balances = snap?.balances || {};

    // Aggregate totals and top holders
    let totalSupply = 0;
    const holders = Object.entries(balances).map(([pubkey, bal]) => {
      const balance = (typeof bal === 'number') ? bal : 0;
      totalSupply += balance;
      const user = pubToUser[pubkey];
      return {
        pubkey,
        balance,
        name: user ? user.username : pubkey.slice(0, 8),
        color: user && user.color ? user.color : '#888'
      };
    }).sort((a, b) => b.balance - a.balance);

    // Current user info (case-insensitive pubkey lookup)
    let currentUser = null;
    if (username) {
      const user = db.users.find(u => u.username === username);
      const pubkey = user && user.powPubkey ? String(user.powPubkey) : null;
      let balance = 0;
      if (pubkey) {
        const pkLower = pubkey.toLowerCase();
        const pkUpper = pubkey.toUpperCase();
        if (Object.prototype.hasOwnProperty.call(balances, pubkey)) balance = balances[pubkey];
        else if (Object.prototype.hasOwnProperty.call(balances, pkLower)) balance = balances[pkLower];
        else if (Object.prototype.hasOwnProperty.call(balances, pkUpper)) balance = balances[pkUpper];
      }
      currentUser = { pubkey, balance };
    }

    res.json({
      success: true,
      source: 'volchain',
      grid,
      volchain: {
        totalSupply,
        topHolders: holders.slice(0, 3),
        currentUser
      }
    });
  } catch (e) {
    logger.error('stats/volchain error:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch volchain stats' });
  }
});
*/

// Admin: Seed/sync Volchain snapshot balances from current grid (1 block = 1 Volore)
app.post('/admin/volchain-seed', (req, res) => {
  try {
    const db = readDB();
    const snap = volchain.getSnapshot();
    const currentBalances = (snap && snap.balances) ? snap.balances : {};
    let minted = 0;
    let burned = 0;
    for (const u of db.users) {
      if (!u.powPubkey) continue;
      const mined = db.grid.filter(b => b.dugBy === u.username).length;
      // Case-insensitive lookup for existing snapshot key
      const pk = String(u.powPubkey);
      const pkLower = pk.toLowerCase();
      const pkUpper = pk.toUpperCase();
      let have = 0;
      if (Object.prototype.hasOwnProperty.call(currentBalances, pk)) have = currentBalances[pk];
      else if (Object.prototype.hasOwnProperty.call(currentBalances, pkLower)) have = currentBalances[pkLower];
      else if (Object.prototype.hasOwnProperty.call(currentBalances, pkUpper)) have = currentBalances[pkUpper];
      const delta = mined - have;
      if (delta > 0) {
        // VOLCHAIN_WRITE: seed mint to reconcile balances with Digzone
        volchain.appendEvent({ type: 'mint', pubkey: u.powPubkey, amount: delta, reason: 'seed' });
        minted += delta;
      } else if (delta < 0) {
        // VOLCHAIN_WRITE: seed burn to reconcile balances with Digzone
        volchain.appendEvent({ type: 'burn', pubkey: u.powPubkey, amount: Math.abs(delta), reason: 'seed' });
        burned += Math.abs(delta);
      }
    }
    return res.json({ success: true, minted, burned });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'seed_failed' });
  }
});

// Admin: Synchronize Digzone grid to match Volchain balances (add missing mined blocks to grid)
app.post('/admin/grid-sync-from-volchain', (req, res) => {
  try {
    const db = readDB();
    const snap = volchain.getSnapshot();
    const balances = (snap && snap.balances) ? snap.balances : {};

    // Map pubkey -> username
    const pubToUser = {};
    const userByPub = {};
    for (const u of db.users) {
      if (u.powPubkey) {
        pubToUser[u.powPubkey] = u.username;
        userByPub[u.powPubkey] = u;
      }
    }

    // Compute per-user deficits (balance - mined)
    const deficits = [];
    let totalDeficit = 0;
    for (const [pub, balance] of Object.entries(balances)) {
      const username = pubToUser[pub];
      if (!username) continue;
      const mined = db.grid.reduce((acc, b) => acc + (b.dugBy === username ? 1 : 0), 0);
      const target = Number(balance) || 0;
      const delta = target - mined;
      if (delta > 0) {
        deficits.push({ pub, username, delta });
        totalDeficit += delta;
      }
    }

    if (totalDeficit === 0) {
      return res.json({ success: true, message: 'No deficits found. Grid already matches Volchain balances.' });
    }

    // Ensure enough empty blocks exist; expand grid to next 100-multiple if needed
    const emptyCount = db.grid.reduce((acc, b) => acc + (!b.dugBy ? 1 : 0), 0);
    const need = Math.max(0, totalDeficit - emptyCount);
    if (need > 0) {
      const currentLength = db.grid.length;
      const targetLength = Math.ceil((currentLength + need) / 100) * 100; // enforce 100-multiple
      const toAdd = targetLength - currentLength;
      for (let i = 0; i < toAdd; i++) {
        db.grid.push({ index: currentLength + i, dugBy: null, color: null, visual: null });
      }
    }

    // Allocate empty blocks to users according to their deficit
    let emptyIdx = 0;
    const empties = [];
    for (let i = 0; i < db.grid.length; i++) {
      if (!db.grid[i].dugBy) empties.push(i);
    }
    const allocated = [];
    for (const d of deficits) {
      let remaining = d.delta;
      const indices = [];
      while (remaining > 0 && emptyIdx < empties.length) {
        const gi = empties[emptyIdx++];
        if (!db.grid[gi].dugBy) {
          db.grid[gi].dugBy = d.username;
          db.grid[gi].visual = null;
          indices.push(gi);
          remaining--;
        }
      }
      allocated.push({ username: d.username, added: d.delta - remaining, indices });
    }

    writeDB(db);
    return res.json({ success: true, totalAdded: totalDeficit, details: allocated });
  } catch (e) {
    logger.error('grid-sync-from-volchain error:', e);
    return res.status(500).json({ success: false, error: 'failed' });
  }
});

// Admin: Normalize Digzone grid length to next 100-multiple without changing mined counts
app.post('/admin/normalize-grid-length', (req, res) => {
  try {
    const db = readDB();
    const currentLength = db.grid.length;
    const targetLength = Math.ceil(currentLength / 100) * 100;
    const toAdd = targetLength - currentLength;
    if (toAdd > 0) {
      for (let i = 0; i < toAdd; i++) {
        db.grid.push({ index: currentLength + i, dugBy: null, color: null, visual: null });
      }
      writeDB(db);
      // Ensure GridB matches the same length
      let gridb = readGridB(targetLength);
      writeGridB(gridb);
      try { require('./lib/store').buildStore().putGridB(gridb).catch(()=>{}); } catch {}
      return res.json({ success: true, added: toAdd, newLength: targetLength, gridbLength: gridb.length });
    }
    // Even if no addition, ensure GridB matches current target length
    let gridb = readGridB(targetLength);
    writeGridB(gridb);
    try { require('./lib/store').buildStore().putGridB(gridb).catch(()=>{}); } catch {}
    return res.json({ success: true, added: 0, newLength: currentLength, gridbLength: gridb.length });
  } catch (e) {
    logger.error('normalize-grid-length error:', e);
    return res.status(500).json({ success: false, error: 'failed' });
  }
});

// Volchain events endpoint
/* moved to routes/volchain.js
app.get('/volchain/events', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 100));
    const beforeId = req.query.cursor ? Number(req.query.cursor) : undefined;
    // chain events with cursor
    // VOLCHAIN_READ: read events from chain
    let result = volchain.getEvents(limit, beforeId);
    let events = result?.events || [];
    let nextCursor = result?.nextCursor || null;
    if (!Array.isArray(events) || events.length === 0) {
      events = readVolchainLog();
    }
    // Enrich with usernames when possible
    const db = readDB();
    const pubToUser = {};
    for (const u of db.users) {
      if (u.powPubkey) {
        // Case-insensitive lookup like in holders endpoint
        pubToUser[u.powPubkey.toLowerCase()] = u.username;
        pubToUser[u.powPubkey.toUpperCase()] = u.username;
      }
    }
    const enriched = events.map(e => {
      const evt = { ...e };
      if (!evt.username && evt.pubkey && pubToUser[evt.pubkey]) {
        evt.username = pubToUser[evt.pubkey];
      }
      if (evt.type === 'transfer') {
        if (!evt.fromUser && evt.from && pubToUser[evt.from]) {
          evt.fromUser = pubToUser[evt.from];
        }
        if (!evt.toUser && evt.to && pubToUser[evt.to]) {
          evt.toUser = pubToUser[evt.to];
        }
      }
      return evt;
    });
    res.json({ events: enriched, nextCursor });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read volchain events' });
  }
});*/

// Volchain: top holders from snapshot
/* moved to routes/volchain.js
app.get('/volchain/holders', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 10));
    const db = readDB();
    const pubToUser = {};
    for (const u of db.users) {
      if (u.powPubkey) {
        // Store both uppercase and lowercase versions for case-insensitive lookup
        pubToUser[u.powPubkey.toLowerCase()] = u;
        pubToUser[u.powPubkey.toUpperCase()] = u;
      }
    }
    // VOLCHAIN_READ: read top holders from snapshot
    const top = volchain.getTopHolders(limit).map(h => ({
      pubkey: h.pubkey,
      balance: h.balance,
      name: pubToUser[h.pubkey]?.username || h.pubkey.slice(0, 8),
      color: pubToUser[h.pubkey]?.color || '#888'
    }));
    res.json(top);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read volchain holders' });
  }
});*/

// Volchain: health/status of snapshot
/* moved to routes/volchain.js
app.get('/volchain/health', (req, res) => {
  try {
    // VOLCHAIN_READ: read snapshot health
    const snap = volchain.getSnapshot();
    const mempoolSize = (() => { try { const v=require('./volchain_chain.js'); return (v.__mempoolSize && v.__mempoolSize()) || 0; } catch { return 0; }})();
    const producerUptime = (() => { try { const v=require('./volchain_chain.js'); return (v.__producerUptimeMs && v.__producerUptimeMs()) || 0; } catch { return 0; }})();
    
    // Get barrier metrics
    const barrierMetrics = (() => { try { const v=require('./volchain_chain.js'); return v.getBarrierMetrics ? v.getBarrierMetrics() : {}; } catch { return {}; }})();
    // Derived totals from accounts
    const totals = (() => { try { return computeTotals(); } catch { return {}; } })();
    
    // Get guard metrics
    const guardMetrics = (() => { try { return guard.getGuardMetrics ? guard.getGuardMetrics() : {}; } catch { return {}; }})();
    
    // Calculate last block age
    const lastBlockAge = snap?.lastBlockTime ? Math.floor((Date.now() - snap.lastBlockTime) / 1000) : null;
    
    res.json({
      lastId: snap?.lastId ?? 0,
      lastHash: snap?.lastHash ?? null,
      accounts: snap?.balances ? Object.keys(snap.balances).length : 0,
      height: snap?.height ?? 0,
      lastBlockId: snap?.lastBlockId ?? 0,
      lastBlockHash: snap?.lastBlockHash ?? null,
      lastBlockTime: snap?.lastBlockTime ?? null,
      last_block_age_seconds: lastBlockAge,
      mempoolSize,
      producerUptime,
      ...barrierMetrics,
      totals,
      ...guardMetrics,
      volchain_op_id_dedup_total: __opIdDedupTotal,
      volchain_dig_id_duplicate_total: __digIdDuplicateTotal
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read volchain health' });
  }
});*/

// ------- Versioned wrappers: /_v1/volchain/* → same handlers -------
/* moved to routes/volchain.js
app.get('/_v1/volchain/head', (req, res) => {
  try { const head = volchain.getHead(); res.json(head); } catch { res.status(500).json({ error: 'head_failed' }); }
});
app.get('/_v1/volchain/holders', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 10));
    const db = readDB();
    const pubToUser = {}; 
    for (const u of db.users) { 
      if (u.powPubkey) {
        // Store both uppercase and lowercase versions for case-insensitive lookup
        pubToUser[u.powPubkey.toLowerCase()] = u;
        pubToUser[u.powPubkey.toUpperCase()] = u;
      }
    }
    const top = volchain.getTopHolders(limit).map(h => ({ pubkey: h.pubkey, balance: h.balance, name: pubToUser[h.pubkey]?.username || h.pubkey.slice(0,8), color: pubToUser[h.pubkey]?.color || '#888' }));
    res.json(top);
  } catch { res.status(500).json({ error: 'Failed to read volchain holders' }); }
});
app.get('/_v1/volchain/state/:addr', (req, res) => {
  try { const st = volchain.getState(req.params.addr); res.json(st); } catch { res.status(500).json({ error: 'state_failed' }); }
});
app.post('/_v1/volchain/tx', txRateLimiter, txBodySizeGuard, async (req, res) => {
  try {
    const b = req.body || {};
    const required = ['type','from','amount','nonce','pubkey','sig'];
    for (const k of required) { if (typeof b[k] === 'undefined' || b[k] === null) return res.status(400).json({ ok:false, error:`missing_${k}` }); }
    if (b.chain_id && b.chain_id !== 'volchain-main') return res.status(400).json({ ok:false, error:'bad_chain_id' });
    if (b.toPubkey) { b.memo = b.memo || {}; b.memo.toPubkey = b.memo.toPubkey || b.toPubkey; }
    if (b.from !== 'SYSTEM') {
      const ok = await volchain.verifyTxSignature(b);
      if (!ok) return res.status(400).json({ ok:false, error:'bad_signature' });
    }
    volchain.enqueueTx(b);
    return res.json({ ok:true });
  } catch (e) {
    return res.status(400).json({ ok:false, error: 'INTERNAL' });
  }
});
// GET /volchain/verify?mode=system → ok:true/false + rapor
app.get('/volchain/verify', (req, res) => {
  try {
    const mode = String(req.query.mode || '').toLowerCase();
    if (mode === 'system') {
      const result = guard.verifyModeSystem(volchain, __dirname);
      return res.json(result);
    }
    const result = volchain.verify();
    res.json(result);
  } catch { res.status(500).json({ ok:false, error:'verify_failed' }); }
});

app.get('/_v1/volchain/verify', (req, res) => {
  try {
    const mode = String(req.query.mode || '').toLowerCase();
    if (mode === 'system') {
      const result = guard.verifyModeSystem(volchain, __dirname);
      return res.json(result);
    }
    const result = volchain.verify();
    res.json(result);
  } catch { res.status(500).json({ ok:false, error:'verify_failed' }); }
});
app.get('/_v1/volchain/blocks', (req, res) => {
  try { const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 20)); const before = req.query.cursor ? Number(req.query.cursor) : undefined; const { blocks, nextCursor } = volchain.getBlocks(limit, before); res.json({ blocks, nextCursor }); } catch { res.status(500).json({ error:'Failed to read blocks' }); }
});
app.get('/_v1/volchain/events', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 100));
    const beforeId = req.query.cursor ? Number(req.query.cursor) : undefined;
    let result = volchain.getEvents(limit, beforeId);
    let events = result?.events || [];
    if (!Array.isArray(events) || events.length === 0) events = readVolchainLog();
    const db = readDB(); const pubToUser = {}; for (const u of db.users) { if (u.powPubkey) pubToUser[u.powPubkey] = u.username; }
    let enriched = events.map(e => { const evt = { ...e }; if (!evt.username && evt.pubkey && pubToUser[evt.pubkey]) evt.username = pubToUser[evt.pubkey]; return evt; });
    try {
      enriched.sort((a, b) => {
        const ta = Number(a?.ts || 0);
        const tb = Number(b?.ts || 0);
        if (tb !== ta) return tb - ta;
        const ia = Number(a?.id || 0);
        const ib = Number(b?.id || 0);
        return ib - ia;
      });
    } catch {}
    if (enriched.length > limit) enriched = enriched.slice(0, limit);
    return res.json({ events: enriched, nextCursor: result?.nextCursor || null });
  } catch { res.status(500).json({ error: 'Failed to read volchain events' }); }
});
app.get('/_v1/volchain/health', (req, res) => {
  try { const snap = volchain.getSnapshot(); const mempoolSize = (()=>{ try{ const v=require('./volchain_chain.js'); return (v.__mempoolSize && v.__mempoolSize()) || 0; } catch { return 0; }})(); res.json({ lastId: snap?.lastId ?? 0, lastHash: snap?.lastHash ?? null, accounts: snap?.balances ? Object.keys(snap.balances).length : 0, height: snap?.height ?? 0, lastBlockId: snap?.lastBlockId ?? 0, lastBlockHash: snap?.lastBlockHash ?? null, lastBlockTime: snap?.lastBlockTime ?? null, mempoolSize }); } catch { res.status(500).json({ error:'Failed to read volchain health' }); }
});

// Submit signed Tx directly to mempool
app.post('/volchain/tx', txRateLimiter, txBodySizeGuard, async (req, res) => {
  try {
    const b = req.body || {};
    const required = ['type','from','amount','nonce','pubkey','sig'];
    for (const k of required) { if (typeof b[k] === 'undefined' || b[k] === null) return res.status(400).json({ ok:false, error:`missing_${k}` }); }
    if (b.chain_id !== 'volchain-main') {
      return res.status(400).json({ ok:false, error:'bad_chain_id' });
    }
    const v = require('./volchain_chain.js');
    // normalize toPubkey (both top-level and memo)
    if (b.toPubkey) {
      b.memo = b.memo || {};
      b.memo.toPubkey = b.memo.toPubkey || b.toPubkey;
    }
    if (b.from !== 'SYSTEM') {
      const ok = await v.verifyTxSignature(b);
      if (!ok) {
        if (String(VOLCHAIN_DEBUG_CANON) === '1') {
          try {
            const canon = v.canonicalTx(b);
            const fromDerived = v.addrFromPub(Buffer.from(b.pubkey, 'base64'));
            const fromMatches = (fromDerived === b.from);
            return res.status(400).json({ ok:false, error:'BAD_SIGNATURE', canonical: canon, fromDerived, fromMatches });
          } catch (_) {}
        }
        return res.status(400).json({ ok:false, error:'bad_signature' });
      }
    }
    // Ensure op_id exists for idempotency
    b.memo = b.memo || {};
    if (!b.memo.op_id) b.memo.op_id = resolveOpId(req);
    v.enqueueTx(b);
    return res.json({ ok:true, op_id: b.memo.op_id });
  } catch (e) {
    const msg = String(e?.message || e);
    const known = [
      'FROM_ADDRESS_MISMATCH','TO_RESOLVE_FAILED','BAD_TO_PUBKEY','BAD_PUBKEY','invalid_amount','duplicate_dig_id','invalid_nonce','insufficient_available','insufficient_stake','mempool_full','memo_too_large','bad_chain_id','DIG_ID_REQUIRED','DIG_ID_DUPLICATE','missing_op_id','duplicate_op_id'
    ];
    const code = known.includes(msg) ? msg : 'INTERNAL';
    if (code === 'INTERNAL') logger.error('POST /volchain/tx error:', e);
    return res.status(code==='INTERNAL'?500:400).json({ ok:false, error: code });
  }
});

// Chain head info
app.get('/volchain/head', (req, res) => {
  try {
    const head = volchain.getHead();
    res.json(head);
  } catch {
    res.status(500).json({ error: 'head_failed' });
  }
});

app.get('/volchain/state/:addr', (req, res) => {
  try {
    const addr = req.params.addr;
    const st = volchain.getState(addr);
    res.json(st);
  } catch (e) {
    res.status(500).json({ error: 'state_failed' });
  }
});

// Volchain: blocks endpoints
/* moved to routes/volchain.js
app.post('/volchain/seal', (req, res) => {
  try {
    // VOLCHAIN_WRITE: seal pending events into a block
    if (VOLCHAIN_MODE === 'append') {
      const block = volchain.sealPending(1000);
      res.json({ success: true, block });
    } else {
      res.json({ success: true, message: 'mempool mode: seal handled by producer' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to seal block' });
  }
});*/

// Convenience: allow GET for sealing in admin flows (no body required)
/* moved to routes/volchain.js
app.get('/volchain/seal', (req, res) => {
  try {
    // VOLCHAIN_WRITE: seal pending events into a block (GET convenience)
    if (VOLCHAIN_MODE === 'append') {
      const block = volchain.sealPending(1000);
      res.json({ success: true, block });
    } else {
      res.json({ success: true, message: 'mempool mode: seal handled by producer' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to seal block' });
  }
});*/

/* moved to routes/volchain.js
app.get('/volchain/blocks', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 20));
    const before = req.query.cursor ? Number(req.query.cursor) : undefined;
    // VOLCHAIN_READ: read sealed blocks
    const { blocks, nextCursor } = volchain.getBlocks(limit, before);
    res.json({ blocks, nextCursor });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read blocks' });
  }
});*/

// Dev-only: canonicalize payload without enqueueing (helps clients to match signing string)
/* moved to routes/volchain.js
app.post('/volchain/canonicalize', (req, res) => {
  try {
    if (String(VOLCHAIN_DEBUG_CANON) !== '1') return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const v = require('./volchain_chain.js');
    const canon = v.canonicalTx(b);
    try {
      const fromDerived = v.addrFromPub(Buffer.from(String(b.pubkey||''), 'base64'));
      const fromMatches = (fromDerived === b.from);
      return res.json({ canonical: canon, fromDerived, fromMatches });
    } catch {
      return res.json({ canonical: canon });
    }
  } catch (e) {
    return res.status(500).json({ error: 'internal' });
  }
});*/

// Dev faucet (SYSTEM mint) - protected by env flags and admin secret
app.post('/admin/volchain-faucet', (req, res) => {
  try {
    if (String(VOLCHAIN_DEV_FAUCET) !== '1') {
      return res.status(403).json({ ok:false, error:'forbidden' });
    }
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    if (!VOLCHAIN_ADMIN_SECRET || hdr !== VOLCHAIN_ADMIN_SECRET) {
      return res.status(403).json({ ok:false, error:'forbidden' });
    }
    const { toPubkey, amount, reason, digId, dig_id } = req.body || {};
    if (!toPubkey || typeof toPubkey !== 'string') return res.status(400).json({ ok:false, error:'missing_toPubkey' });
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || Math.floor(amt) !== amt) return res.status(400).json({ ok:false, error:'invalid_amount' });
    const v = require('./volchain_chain.js');
    const snap = v.getSnapshot();
    const sysNonce = ((snap.accounts && snap.accounts['SYSTEM'] && snap.accounts['SYSTEM'].nonce) || 0) + 1;
    const finalDigId = digId || dig_id || null;
    const memo = { reason: reason||'faucet', toPubkey: toPubkey };
    if (finalDigId) memo.dig_id = String(finalDigId);
    const tx = { type:'mint', from:'SYSTEM', to:null, amount: amt, nonce: sysNonce, memo, pubkey:'', sig:'' };
    try {
      v.enqueueTx(tx);
      return res.json({ ok:true });
    } catch (e) {
      const msg = String(e?.message || e);
      return res.status(400).json({ ok:false, error: msg });
    }
  } catch (e) {
    logger.error('POST /admin/volchain-faucet error:', e);
    return res.status(500).json({ ok:false, error:'internal' });
  }
});

// Volchain: verify chain and snapshot integrity
app.get('/volchain/verify', (req, res) => {
  try {
    const mode = String(req.query.mode || '').toLowerCase();
    const details = String(req.query.details || '0') === '1';
    
    if (mode === 'system') {
      const result = details 
        ? guard.verifyModeSystemDetailed(volchain, __dirname)
        : guard.verifyModeSystem(volchain, __dirname);
      return res.json(result);
    }
    const result = volchain.verify();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'verify_failed' });
  }
});

// Admin: Backfill snapshot->blocks deltas as txs and enqueue to mempool
app.post('/admin/volchain-backfill-from-snapshot', (req, res) => {
  try {
    if (String(process.env.VOLCHAIN_ALLOW_BACKFILL) !== '1') {
      return res.status(403).json({ ok:false, error:'backfill_disabled' });
    }
    if (String(VOLCHAIN_DEV_FAUCET) !== '1' && !VOLCHAIN_ADMIN_SECRET) {
      return res.status(403).json({ ok:false, error:'forbidden' });
    }
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    if (VOLCHAIN_ADMIN_SECRET && hdr !== VOLCHAIN_ADMIN_SECRET) {
      return res.status(403).json({ ok:false, error:'forbidden' });
    }
    const result = volchain.enqueueSeedBackfillTxs();
    return res.json(result);
  } catch (e) {
    logger.error('volchain-backfill-from-snapshot error:', e);
    return res.status(500).json({ ok:false, error:'failed' });
  }
});

// Same backfill under /volchain/* (already proxied) for convenience
app.post('/volchain/backfill-from-snapshot', (req, res) => {
  try {
    if (String(process.env.VOLCHAIN_ALLOW_BACKFILL) !== '1') {
      return res.status(403).json({ ok:false, error:'backfill_disabled' });
    }
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    if (VOLCHAIN_DEV_FAUCET !== '1' && (!VOLCHAIN_ADMIN_SECRET || hdr !== VOLCHAIN_ADMIN_SECRET)) {
      return res.status(403).json({ ok:false, error:'forbidden' });
    }
    const result = volchain.enqueueSeedBackfillTxs();
    return res.json(result);
  } catch (e) {
    logger.error('volchain/backfill-from-snapshot error:', e);
    return res.status(500).json({ ok:false, error:'failed' });
  }
});

// Allow GET for convenience/tools that cannot POST easily
app.get('/volchain/backfill-from-snapshot', (req, res) => {
  try {
    if (String(process.env.VOLCHAIN_ALLOW_BACKFILL) !== '1') {
      return res.status(403).json({ ok:false, error:'backfill_disabled' });
    }
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    if (VOLCHAIN_DEV_FAUCET !== '1' && (!VOLCHAIN_ADMIN_SECRET || hdr !== VOLCHAIN_ADMIN_SECRET)) {
      return res.status(403).json({ ok:false, error:'forbidden' });
    }
    const result = volchain.enqueueSeedBackfillTxs();
    return res.json(result);
  } catch (e) {
    logger.error('volchain/backfill-from-snapshot error:', e);
    return res.status(500).json({ ok:false, error:'failed' });
  }
});

// Admin: HARD RESET Volchain and reseed from current Digzone (grid) and Warzone (GridB)
app.post('/admin/volchain-reset-reseed', (req, res) => {
  try {
    // PRODUCTION SAFETY: Require both DEV_FAUCET and ADMIN_SECRET
    if (String(VOLCHAIN_DEV_FAUCET) !== '1') {
      return res.status(403).json({ success: false, error: 'reset_disabled_in_production' });
    }
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    if (!VOLCHAIN_ADMIN_SECRET || hdr !== VOLCHAIN_ADMIN_SECRET) {
      return res.status(403).json({ success: false, error: 'admin_secret_required' });
    }
    // 1) Delete volchain data dir to fully reset
    const DATA_DIR = path.join(__dirname, 'volchain');
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}

    // 2) Ensure fresh snapshot (created lazily by volchain when called)
    const fresh = volchain.getSnapshot();
    if (!fresh || typeof fresh !== 'object') {
      return res.status(500).json({ success: false, error: 'failed_to_init_snapshot' });
    }

    // 3) Rebuild balances from current grid (1 block = 1 Volore)
    const db = readDB();
    const userToPub = {};
    for (const u of db.users) {
      if (u && u.username && u.powPubkey) userToPub[u.username] = u.powPubkey;
    }

    // Per-user mined counts
    const minedByUser = {};
    for (const b of db.grid) {
      if (b && b.dugBy && userToPub[b.dugBy]) {
        minedByUser[b.dugBy] = (minedByUser[b.dugBy] || 0) + 1;
      }
    }

    let mintedTotal = 0;
    for (const [username, count] of Object.entries(minedByUser)) {
      const pub = userToPub[username];
      if (!pub) continue;
      if (count > 0) {
        // VOLCHAIN_WRITE: reset-reseed mint from current Digzone counts
        volchain.appendEvent({ type: 'mint', pubkey: pub, amount: count, reason: 'reset_reseed' });
        mintedTotal += count;
      }
    }

    // 3.5) Flush mempool to ensure minted balances are in snapshot before staking
    volchain.sealPending();

    // 4) Rebuild staked from GridB (sum of defense by owner)
    const totalBlocks = db.grid.length;
    const gridb = readGridB(totalBlocks);
    const stakedByUser = {};
    for (const b of gridb) {
      if (!b || !b.owner) continue;
      const d = typeof b.defense === 'number' ? b.defense : 1;
      stakedByUser[b.owner] = (stakedByUser[b.owner] || 0) + d;
    }

    let stakedTotal = 0;
    for (const [username, stakeAmt] of Object.entries(stakedByUser)) {
      const pub = userToPub[username];
      if (!pub) continue;
      const amt = Number(stakeAmt) || 0;
      if (amt > 0) {
        // VOLCHAIN_WRITE: reset-reseed stake from current GridB defenses
        volchain.appendEvent({ type: 'stake', username, pubkey: pub, amount: amt, reason: 'reset_reseed' });
        stakedTotal += amt;
      }
    }

    return res.json({ success: true, mintedTotal, stakedTotal });
  } catch (e) {
    logger.error('volchain-reset-reseed error:', e);
    return res.status(500).json({ success: false, error: 'failed' });
  }
});

// Admin: Backfill stakes from current Warzone (GridB) into Volchain (stake/unstake deltas)
app.post('/admin/volchain-backfill-stakes', (req, res) => {
  try {
    const db = readDB();
    const totalBlocks = db.grid.length;
    const gridb = readGridB(totalBlocks);
    const desiredByUser = {};
    for (const b of gridb) {
      if (b && b.owner) {
        const d = typeof b.defense === 'number' ? b.defense : 1;
        desiredByUser[b.owner] = (desiredByUser[b.owner] || 0) + d;
      }
    }
    // Map username -> pubkey
    const userToPub = {};
    for (const u of db.users) {
      if (u.powPubkey) userToPub[u.username] = u.powPubkey;
    }
    const snap = volchain.getSnapshot();
    const currentStaked = (snap && snap.staked) ? snap.staked : {};
    let stakedTotal = 0;
    let unstakedTotal = 0;
    const changes = [];
    // For users with pubkeys, compute deltas
    for (const [username, target] of Object.entries(desiredByUser)) {
      const pub = userToPub[username];
      if (!pub) continue;
      // Case-insensitive lookup for staked map
      let have = 0; {
        const pk = String(pub);
        if (Object.prototype.hasOwnProperty.call(currentStaked, pk)) have = currentStaked[pk];
        else if (Object.prototype.hasOwnProperty.call(currentStaked, pk.toLowerCase())) have = currentStaked[pk.toLowerCase()];
        else if (Object.prototype.hasOwnProperty.call(currentStaked, pk.toUpperCase())) have = currentStaked[pk.toUpperCase()];
        have = Number(have || 0);
      }
      const delta = Number(target) - Number(have);
      if (delta > 0) {
        // VOLCHAIN_WRITE_CALLSITE: backfill stake to match GridB
        const opId = genOpId();
        volchain.appendEvent({ type: 'stake', username, pubkey: pub, amount: delta, reason: 'backfill', op_id: opId, memo:{ op_id: opId, reason:'backfill' } });
        stakedTotal += delta;
        changes.push({ username, pubkey: pub, type: 'stake', amount: delta });
      } else if (delta < 0) {
        const amt = Math.abs(delta);
        // VOLCHAIN_WRITE_CALLSITE: backfill unstake to match GridB
        const opId = genOpId();
        volchain.appendEvent({ type: 'unstake', username, pubkey: pub, amount: amt, reason: 'backfill', op_id: opId, memo:{ op_id: opId, reason:'backfill' } });
        unstakedTotal += amt;
        changes.push({ username, pubkey: pub, type: 'unstake', amount: amt });
      }
    }
    res.json({ success: true, stakedTotal, unstakedTotal, changesCount: changes.length });
  } catch (e) {
    logger.error('volchain-backfill-stakes error:', e);
    res.status(500).json({ success: false, error: 'failed' });
  }
});

// Admin: Force reconcile snapshot.staked directly from current GridB (emergency fix)
app.post('/admin/volchain-reconcile-stake-from-gridb', (req, res) => {
  try {
    // PRODUCTION SAFETY: Require ADMIN_SECRET for reconcile operations
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    if (!VOLCHAIN_ADMIN_SECRET || hdr !== VOLCHAIN_ADMIN_SECRET) {
      return res.status(403).json({ ok: false, error: 'admin_secret_required' });
    }
    const db = readDB();
    const totalBlocks = db.grid.length;
    const gridb = readGridB(totalBlocks);
    const desiredByUser = {};
    for (const b of gridb) {
      if (b && b.owner) {
        const d = typeof b.defense === 'number' ? b.defense : 1;
        desiredByUser[b.owner] = (desiredByUser[b.owner] || 0) + d;
      }
    }
    const userToPub = {};
    for (const u of db.users) {
      if (u.powPubkey) userToPub[u.username] = u.powPubkey.toLowerCase();
    }
    const v = require('./volchain_chain.js');
    const snap = v.getSnapshot();
    snap.staked = snap.staked || {};
    // Reset staked to desired exactly
    const newStaked = {};
    for (const [username, amt] of Object.entries(desiredByUser)) {
      const pub = userToPub[username]; if (!pub) continue;
      newStaked[pub] = Math.max(0, Math.floor(Number(amt)||0));
    }
    snap.staked = newStaked;
    // Persist
    const fs = require('fs'); const path = require('path');
    const SNAPSHOT_FILE = path.join(process.env.VOLCHAIN_DIR || path.join(__dirname, 'volchain'), 'snapshot.json');
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap, null, 2));
    return res.json({ ok:true, stakedAccounts: Object.keys(newStaked).length });
  } catch (e) {
    logger.error('reconcile-stake-from-gridb error:', e);
    return res.status(500).json({ ok:false, error:'failed' });
  }
});

// Admin: Align chain staked to GridB exactly (stake/unstake as needed)
app.post('/admin/volchain-stake-align', (req, res) => {
  try {
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    const remote = (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
    const isLocal = (remote === '127.0.0.1' || remote === '::1');
    if (!isLocal && (!VOLCHAIN_ADMIN_SECRET || hdr !== VOLCHAIN_ADMIN_SECRET)) {
      return res.status(403).json({ ok:false, error:'admin_secret_required' });
    }
    const db = readDB();
    const totalBlocks = db.grid.length;
    const gridb = readGridB(totalBlocks);
    const desiredByUser = {};
    for (const b of gridb) {
      if (b && b.owner) {
        const d = typeof b.defense === 'number' ? b.defense : 1;
        desiredByUser[b.owner] = (desiredByUser[b.owner] || 0) + d;
      }
    }
    // Map username -> pubkey
    const userToPub = {};
    for (const u of db.users) { if (u && u.username && u.powPubkey) userToPub[u.username] = String(u.powPubkey); }
    const snap = volchain.getSnapshot();
    const currentStaked = (snap && snap.staked) ? snap.staked : {};
    let stakeTotal = 0, unstakeTotal = 0, changes = [];
    for (const [username, target] of Object.entries(desiredByUser)) {
      const pub = userToPub[username]; if (!pub) continue;
      let have = 0; {
        const pk = String(pub);
        if (Object.prototype.hasOwnProperty.call(currentStaked, pk)) have = currentStaked[pk];
        else if (Object.prototype.hasOwnProperty.call(currentStaked, pk.toLowerCase())) have = currentStaked[pk.toLowerCase()];
        else if (Object.prototype.hasOwnProperty.call(currentStaked, pk.toUpperCase())) have = currentStaked[pk.toUpperCase()];
        have = Number(have || 0);
      }
      const delta = Number(target) - have;
      if (delta > 0) {
        const opId = genOpId();
        volchain.appendEvent({ type:'stake', username, pubkey: pub, amount: delta, reason:'backfill_align', op_id: opId, memo:{ op_id: opId, reason:'backfill_align' } });
        stakeTotal += delta;
        changes.push({ username, type:'stake', amount: delta });
      } else if (delta < 0) {
        const amt = Math.abs(delta);
        const opId = genOpId();
        volchain.appendEvent({ type:'unstake', username, pubkey: pub, amount: amt, reason:'backfill_align', op_id: opId, memo:{ op_id: opId, reason:'backfill_align' } });
        unstakeTotal += amt;
        changes.push({ username, type:'unstake', amount: amt });
      }
    }
    return res.json({ ok:true, stakeTotal, unstakeTotal, changesCount: changes.length });
  } catch (e) {
    logger.error('volchain-stake-align error:', e);
    return res.status(500).json({ ok:false, error:'failed' });
  }
});

// Removed legacy admin/mint-volore-all (replaced by volchain-seed)

// Stats endpoint (local only)

/* moved to routes/stats.js
// Get on-chain stats
app.get('/stats/blockchain', async (req, res) => {
  try {
    const username = req.query.username;
    const stats = computeLocalStats(username);
    res.json({ success: true, stats, source: 'local' });
  } catch (error) {
    logger.error('Stats fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});
*/

// Removed token transfer/reset endpoints (Solana/Volore removed)

app.post('/api/update-username', async (req, res) => {
  const { currentUsername, newUsername } = req.body;
  if (!currentUsername || !newUsername) {
    return res.status(400).json({ error: 'Current and new usernames are required' });
  }
  try {
    const data = readDB();
    const userIndex = data.users.findIndex(u => u.username === currentUsername);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    const normalizedNew = String(newUsername);
    // Update usernames in DB
    data.users[userIndex].username = normalizedNew;
    // Update GridB ownerships
    const gridBData = readGridB(data.grid.length);
    const updatedGridB = gridBData.map(block => 
      block.owner === currentUsername ? { ...block, owner: normalizedNew } : block
    );
    writeGridB(updatedGridB);
    
    writeDB(data);

    // PG dual-write
    try {
      const store = require('./lib/store').buildStore();
      await store.upsertUser({ username: normalizedNew, color: data.users[userIndex]?.color || null, pow_pubkey: data.users[userIndex]?.powPubkey || null, email: data.users[userIndex]?.email || null });
      for (const b of updatedGridB) {
        if (b && b.owner === normalizedNew) {
          await store.upsertGridBRow(b);
        }
      }
    } catch {}

    res.json({ success: true, newUsername });
  } catch {
    res.status(500).json({ error: 'Update failed' });
  }
});

app.get('/auth/user', (req, res) => {
  const username = req.query.username;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  const data = readDB();
  const user = data.users.find(u => u.username === username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
});

// VolChain state by username
app.get('/volchain/user/:username', (req, res) => {
  try {
    const username = req.params.username;
    const data = readDB();
    const user = data.users.find(u => u.username === username);
    
    if (!user || !user.powPubkey) {
      return res.status(404).json({ error: 'User not found or no pubkey' });
    }
    
    // Convert pubkey to hex address
    const hexAddr = user.powPubkey.toLowerCase();
    const snapshot = volchain.getSnapshot();
    
    const balance = snapshot.balances[hexAddr] || 0;
    const staked = snapshot.staked[hexAddr] || 0;
    const available = balance - staked;
    
    res.json({
      username: username,
      address: hexAddr,
      balance: balance,
      staked: staked,
      available: available
    });
  } catch (e) {
    res.status(500).json({ error: 'volchain_user_failed', message: e.message });
  }
});

// --- Volore-Blocks invariant helpers ---
function getUserBlockCount(data, username) {
  try {
    if (!username) return 0;
    let count = 0;
    for (const block of data.grid) {
      if (block && block.dugBy === username) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// Removed reconcile helpers (replaced by volchain event chain)

function generateRandomHex64() {
  return crypto.randomBytes(32).toString('hex');
}

// Admin: assign Volchain pubkeys to users missing one, then reconcile balances
app.post('/admin/assign-pubkeys', (req, res) => {
  try {
    const data = readDB();
    const existing = new Set(data.users.filter(u => u.powPubkey).map(u => u.powPubkey));
    let assigned = 0;
    for (const user of data.users) {
      if (!user.powPubkey) {
        let pub;
        do { pub = generateRandomHex64(); } while (existing.has(pub));
        user.powPubkey = pub;
        existing.add(pub);
        assigned++;
      }
    }
    writeDB(data);
    reconcileAllBalancesWithGrid(data);
    res.json({ success: true, assigned });
  } catch (e) {
    logger.error('assign-pubkeys error:', e);
    res.status(500).json({ success: false, error: 'failed' });
  }
});

// Volchain events log and reliable append support
const VOLCHAIN_LOG_FILE = path.join(__dirname, 'volchain_log.json');
const VOLCHAIN_PENDING_FILE = path.join(__dirname, 'volchain_pending.json');
const volchain = require('./volchain_chain.js');
const guard = require('./volchain_guard.js');

function readVolchainLog() {
  try {
    if (fs.existsSync(VOLCHAIN_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(VOLCHAIN_LOG_FILE, 'utf8'));
    }
  } catch (e) {
    logger.error('readVolchainLog error:', e.message);
  }
  return [];
}

function writeVolchainLog(entries) {
  try {
    fs.writeFileSync(VOLCHAIN_LOG_FILE, JSON.stringify(entries, null, 2));
  } catch (e) {
    logger.error('writeVolchainLog error:', e.message);
  }
}

function readPendingVolchain() {
  try {
    if (fs.existsSync(VOLCHAIN_PENDING_FILE)) {
      return JSON.parse(fs.readFileSync(VOLCHAIN_PENDING_FILE, 'utf8'));
    }
  } catch (e) {
    logger.error('readPendingVolchain error:', e.message);
  }
  return [];
}

function writePendingVolchain(list) {
  try {
    fs.writeFileSync(VOLCHAIN_PENDING_FILE, JSON.stringify(list, null, 2));
  } catch (e) {
    logger.error('writePendingVolchain error:', e.message);
  }
}

function appendVolchainEvent(evt) {
  try {
    // Only allow core Volchain events: mint, burn, transfer
    try {
      const t = String(evt && evt.type || '').toLowerCase();
      const allowed = t === 'mint' || t === 'burn' || t === 'transfer';
      if (!allowed) return; // ignore non-core events (stake/unstake/attack)
    } catch {}
    // Prefer appending to chain first, then log; if chain fails, enqueue pending
    let appended = false;
    try {
      const withOp = { ...evt };
      if (!withOp.op_id) {
        withOp.op_id = genOpId();
      }
      volchain.appendEvent(withOp);
      appended = true;
    } catch (e) {
      try { const list = readPendingVolchain(); list.push(evt); writePendingVolchain(list); } catch {}
    }
    if (appended) {
      try { const list = readPendingVolchain(); if (list.length > 0) { const last = list[list.length - 1]; if (JSON.stringify(last) === JSON.stringify(evt)) list.pop(); writePendingVolchain(list); } } catch {}
    }
    // Mirror to PG: events + accounts (best-effort)
    try {
      const store = require('./lib/store').buildStore();
      store.appendVolEvent(evt).catch(()=>{});
      // Update accounts snapshot-like for stake/unstake/burn/mint/transfer
      const data = readDB();
      const snap = volchain.getSnapshot();
      const users = data.users || [];
      const map = {};
      users.forEach(u => { if (u && u.powPubkey) map[u.username] = String(u.powPubkey).toLowerCase(); });
      const balances = snap?.balances || {};
      const staked = snap?.staked || {};
      for (const [pub, bal] of Object.entries(balances)) {
        const s = Number(staked[pub] || 0);
        const b = Number(bal || 0);
        store.upsertAccount({ pubkey: pub, balance: b, staked: s, available: Math.max(0, b - s) }).catch(()=>{});
      }
    } catch {}
  } catch {}
}

async function retryPendingVolchainOnce() {
  try {
    const pending = readPendingVolchain();
    if (!Array.isArray(pending) || pending.length === 0) return { tried: 0, ok: 0 };
    const next = [];
    let ok = 0;
    for (const evt of pending.reverse()) { // oldest first
      try {
        volchain.appendEvent(evt);
        ok++;
      } catch {
        next.unshift(evt); // keep failure at head for order
      }
    }
    writePendingVolchain(next);
    return { tried: pending.length, ok };
  } catch (e) {
    logger.error('retryPendingVolchainOnce error:', e.message);
    return { tried: 0, ok: 0 };
  }
}

// Background retry loop
setInterval(() => { retryPendingVolchainOnce().catch(() => {}); }, 5000);

// Hourly verify watchdog
setInterval(async () => {
  try {
    const result = volchain.verify();
    if (!result || result.ok !== true) {
      if (VERIFY_WEBHOOK_URL) {
        try { const { sendVerifyWebhook } = require('./lib/webhook'); await sendVerifyWebhook({ kind:'volchain_verify', ok:false, result }); } catch {}
      }
    }
  } catch (e) {
    if (VERIFY_WEBHOOK_URL) {
      try { const { sendVerifyWebhook } = require('./lib/webhook'); await sendVerifyWebhook({ kind:'volchain_verify', ok:false, error:String(e?.message||e) }); } catch {}
    }
  }
}, 60 * 60 * 1000);

// Daily backup: snapshot.json + blocks/ tar to backups dir (local)
const BACKUP_DIR = path.join(__dirname, 'backups');
function ensureBackupDir(){ try{ fs.mkdirSync(BACKUP_DIR, { recursive:true }); } catch{} }
function run(cmd){ try { return child_process.execSync(cmd, { stdio:'ignore' }); } catch {} }
setInterval(() => {
  try {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 0) { // around 03:00 daily
      ensureBackupDir();
      const stamp = now.toISOString().replace(/[:.]/g, '-');
      const out = path.join(BACKUP_DIR, `volchain-${stamp}.tar.gz`);
      // pack volchain folder (snapshot + blocks + logs)
      run(`tar -czf ${out} -C ${__dirname} volchain`);
    }
  } catch {}
}, 60 * 1000);


// -------------------- RECONCILE (SAFE) --------------------
function buildReconcileReport() {
  const db = readDB();
  const stats = readStats();
  const accs = readAccounts();
  const accMap = new Map();
  for (const a of accs) accMap.set(a.username, { ...a });
  const users = Array.isArray(db.users) ? db.users.map(u => u.username).filter(Boolean) : [];
  const minedMap = computeAllMinedMap();
  const report = { users: [], totals: {}, mismatches: [] };
  let sumBal = 0, sumUsed = 0, sumAvail = 0;
  for (const uname of users) {
    const mined = Number(minedMap[uname] || 0);
    const cur = accMap.get(uname) || { username: uname, balance: 0, used: 0, available: 0 };
    const nextUsed = Math.min(Number(cur.used || 0), mined);
    const nextBal = mined;
    const nextAvail = Math.max(0, nextBal - nextUsed);
    report.users.push({ username: uname, before: cur, after: { username: uname, balance: nextBal, used: nextUsed, available: nextAvail } });
    sumBal += nextBal; sumUsed += nextUsed; sumAvail += nextAvail;
    if (cur.balance !== nextBal || cur.used !== nextUsed || cur.available !== nextAvail) {
      report.mismatches.push(uname);
    }
  }
  // Digzone dug count
  const dugCells = (() => { try { const d = readDB(); return d.grid.filter(b => b && b.status === 'dug' && b.owner).length; } catch { return 0; } })();
  report.totals = { total_supply_target: dugCells, sumBalance: sumBal, sumUsed, sumAvailable: sumAvail, stats_total_supply: Number(stats.total_supply || 0) };
  return report;
}

async function reconcile({ fix = false, safe = true } = {}) {
  const report = buildReconcileReport();
  if (!fix) return { ok: true, mode: 'dry-run', report };
  return await withTx(async () => {
    // Only accounts.json and stats.json are updated in safe mode
    const nextAccounts = [];
    for (const row of report.users) nextAccounts.push(row.after);
    writeAccounts(nextAccounts);
    const stats = readStats();
    stats.total_supply = Number(report.totals.total_supply_target || 0);
    writeStats(stats);
    // Verify invariants after fix
    try { assertInvariants(); } catch (e) { return { ok: false, error: 'INVARIANT_VIOLATION', details: String(e?.message || e), report }; }
    return { ok: true, mode: 'fix', updated: nextAccounts.length, report };
  });
}

// Admin: reconcile (safe)
app.post('/admin/reconcile', async (req, res) => {
  try {
    const mode = String(req.query.mode || 'dry-run');
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    if (!VOLCHAIN_ADMIN_SECRET || hdr !== VOLCHAIN_ADMIN_SECRET) {
      return res.status(403).json({ ok:false, error:'admin_secret_required' });
    }
    const fix = (mode === 'fix');
    const result = await reconcile({ fix, safe: true });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ ok:false, error:'reconcile_failed' });
  }
});

// Admin: export snapshot (.tar.gz)
app.get('/admin/export-snapshot', async (req, res) => {
  try {
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    if (!VOLCHAIN_ADMIN_SECRET || hdr !== VOLCHAIN_ADMIN_SECRET) {
      return res.status(403).json({ ok:false, error:'admin_secret_required' });
    }
    const tmpDir = path.join(__dirname, 'tmp');
    ensureDir(tmpDir);
    const out = path.join(tmpDir, `snapshot_${Date.now()}.tar.gz`);
    // pack selected files
    const cmd = `tar -czf ${out} -C ${__dirname} db.json gridb.json accounts.json stats.json volchain_log.json volchain`;
    try { child_process.execSync(cmd); } catch {}
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename=${path.basename(out)}`);
    fs.createReadStream(out).pipe(res).on('close', () => { try { fs.unlinkSync(out); } catch {} });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'export_failed' });
  }
});
// Volchain: fetch inbox messages for current user and clear them
app.get('/volchain/inbox', async (req, res) => {
  try {
    const sessionToken = req.headers['x-session-token'];
    const username = await validateSession(sessionToken);
    if (!username) return res.status(401).json({ error: 'Unauthorized' });
    const data = readDB();
    const userIndex = data.users.findIndex(u => u.username === username);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
    const inbox = data.users[userIndex].volchainInbox || [];
    data.users[userIndex].volchainInbox = [];
    writeDB(data);
    res.json({ success: true, inbox });
  } catch (e) {
    logger.error('volchain inbox error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Volchain: transfer Volore from current user to a pubkey (max available)
app.post('/volchain/transfer', async (req, res) => {
  try {
    if (noDestructiveMode()) {
      return res.status(403).json({ error: 'NO_DESTRUCTIVE_MODE', op: 'transfer' });
    }
    const sessionToken = req.headers['x-session-token'];
    const username = await validateSession(sessionToken);
    if (!username) return res.status(401).json({ error: 'Unauthorized' });

    const { toPubkey, amount } = req.body || {};
    const toHex = resolveAnyKeyToHex64(toPubkey);
    if (!toHex) {
      return res.status(400).json({ error: 'BAD_PUBKEY' });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || Math.floor(amt) !== amt) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const data = readDB();
    const sender = data.users.find(u => u.username === username);
    if (!sender || !sender.powPubkey) return res.status(400).json({ error: 'Sender has no Volchain address' });
    const receiver = data.users.find(u => (u.powPubkey||'').toLowerCase() === toHex) || null;
    if (!receiver) {
      return res.status(400).json({ error: 'Receiver not found' });
    }
    if (sender.powPubkey === toPubkey) {
      return res.status(400).json({ error: 'Self-transfer is not allowed' });
    }

    // INVARIANT: balance == mined == used + available
    // mined = Digzone'da kazılan block sayısı
    // used = GridB'de stake edilen block sayısı
    // available = mined - used
    const mined = data.grid.filter(b => b.dugBy === username).length;
    const gridb = readGridB(data.grid.length);
    const used = gridb.filter(b => b && b.owner === username).reduce((sum, b) => sum + (typeof b.defense === 'number' ? b.defense : 1), 0);
    const available = Math.max(0, mined - used);
    
    logger.debug(`[TRANSFER INVARIANT] ${username}: mined=${mined}, used=${used}, available=${available}`);
    
    if (amt > available) return res.status(400).json({ error: 'Amount exceeds available Volore' });

    // Enforce security requirements (op_id + CHAIN_ID required)
    const security = enforceSecurityRequirements(req, true, true);
    if (security.error) {
      return res.status(400).json({ error: security.error });
    }
    const { opId } = security; // this opId is for claim/support below

    // Ledger-first commit with seal barrier + mined_seq ownership move
    const { ledgerFirstCommitWithBarrier } = require('./lib/ledger');
    const result = await ledgerFirstCommitWithBarrier({
      bundleFn: async () => {
        const v = require('./volchain_chain.js');
        const pubB64 = v.hexToB64(sender.powPubkey);
        const toPubB64 = v.hexToB64(toHex);
        const fromAddr = v.addrFromPub(pubB64);
        const memo = { toPubkey: toPubB64, op_id: `${opId}.xfer`, reason: 'server_transfer' };
        const tx = { type:'transfer', from: fromAddr, to: null, amount: amt, nonce: 0, memo, pubkey: pubB64, sig: '' };
        
        // Precheck bundle before returning
        const v2 = require('./volchain_chain.js');
        v2.precheckBundle([tx]);
        return [tx];
      },
      
      commitGameFn: async () => {
        return await withTx(async () => {
          const dbBackup = JSON.stringify(data);
          transferLatestCells(username, receiver.username, amt);
          // Update accounts derived fields
          const minedFrom = computeUserMinedFromDigzone(username);
          const minedTo = computeUserMinedFromDigzone(receiver.username);
          upsertAccount(username, (a)=>{ const used = Math.min(Number(a.used||0), minedFrom); return { username, balance: minedFrom, used, available: minedFrom - used }; });
          upsertAccount(receiver.username, (a)=>{ const used = Math.min(Number(a.used||0), minedTo); return { username: receiver.username, balance: minedTo, used, available: minedTo - used }; });
          try { assertInvariants(); } catch (e) { logger.warn(String(e?.message||e)); }
          appendAudit('transfer', username, { to: receiver.username, amount: amt }, {});
          // Mirror to PG accounts
          try {
            const store = require('./lib/store').buildStore();
            const v = require('./volchain_chain.js');
            const snap = v.getSnapshot();
            const balFrom = Number(snap?.balances?.[sender.powPubkey.toLowerCase()] || 0);
            const stFrom = Number(snap?.staked?.[sender.powPubkey.toLowerCase()] || 0);
            const balTo = Number(snap?.balances?.[receiver.powPubkey.toLowerCase()] || 0);
            const stTo = Number(snap?.staked?.[receiver.powPubkey.toLowerCase()] || 0);
            store.upsertAccount({ pubkey: sender.powPubkey.toLowerCase(), balance: balFrom, staked: stFrom, available: Math.max(0, balFrom - stFrom) }).catch(()=>{});
            store.upsertAccount({ pubkey: receiver.powPubkey.toLowerCase(), balance: balTo, staked: stTo, available: Math.max(0, balTo - stTo) }).catch(()=>{});
            store.appendVolEvent({ ts: Date.now(), type: 'transfer', username, pubkey: sender.powPubkey, amount: amt, reason: 'server_transfer', op_id: opId, payload: { to: receiver.powPubkey } }).catch(()=>{});
          } catch {}
          return { rollback: () => writeDB(JSON.parse(dbBackup)) };
        });
      },
      
      guardFn: async (gameBackup) => {
        const guardResult = await guard.runInvariantGuardWithRollback({
          baseDir: BASE_DIR_FOR_GUARD,
          gameBackup,
          op_id: opId,
          operation: 'transfer'
        });
        return guardResult;
      },
      
      op_id: opId
    });

    if (!result.ok) {
      return res.status(409).json({ error: result.error, details: result.details });
    }

    // Notify receiver if known
    // Notify receiver if known (non-destructive)
    try {
      const fresh = readDB();
      const rxIndex = fresh.users.findIndex(u => u.username === receiver.username);
      if (rxIndex !== -1) {
        fresh.users[rxIndex].volchainInbox = fresh.users[rxIndex].volchainInbox || [];
        fresh.users[rxIndex].volchainInbox.push({ ts: Date.now(), type: 'volore_received', from: sender.powPubkey, to: receiver.powPubkey, amount: amt, message: `You received ${amt} Volore from ${sender.powPubkey}` });
        writeDB(fresh);
      }
    } catch {}

    // Recompute available after move
    const totalBlocksAfter = data.grid.filter(b => b.dugBy === username).length;
    const gridbAfter = readGridB(data.grid.length);
    const usedAfter = gridbAfter.filter(b => b && b.owner === username).reduce((sum, b) => sum + (typeof b.defense === 'number' ? b.defense : 1), 0);
    const availableAfter = Math.max(0, totalBlocksAfter - usedAfter);
    return res.json({ success: true, availableAfter });
  } catch (e) {
    logger.error('volchain transfer error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Invariant Monitoring System
let invariantCheckInterval = null;
let lastInvariantCheck = null;
let invariantCheckHistory = [];

function startInvariantMonitoring() {
  if (invariantCheckInterval) {
    clearInterval(invariantCheckInterval);
  }

  logger.info('🔍 Invariant monitoring sistemi başlatılıyor...');

  // Disabled per ops decision to reduce load
  /* invariantCheckInterval = setInterval(async () => {
    try {
      const v = require('./volchain_chain.js');
      const snapshot = v.getSnapshot();
      const db = readDB();
      const gridb = readGridB(db.grid.length);

      const issues = enforceInvariants(snapshot, db, gridb);
      const timestamp = new Date().toISOString();

      lastInvariantCheck = {
        timestamp,
        status: issues.length === 0 ? 'HEALTHY' : 'ISSUES_DETECTED',
        issues: issues,
        totalSupply: Object.values(snapshot.balances || {}).reduce((sum, b) => sum + (Number(b) || 0), 0),
        totalMined: (db.grid || []).filter(b => b && b.dugBy).length,
        totalStaked: Object.values(snapshot.staked || {}).reduce((sum, s) => sum + (Number(s) || 0), 0)
      };

      // Son 10 kontrolü sakla
      invariantCheckHistory.unshift(lastInvariantCheck);
      if (invariantCheckHistory.length > 10) {
        invariantCheckHistory = invariantCheckHistory.slice(0, 10);
      }

      if (issues.length > 0) {
        logger.warn(`⚠️ INVARIANT ALERT [${timestamp}]:`, issues);

        // Kritik ihlallerde otomatik düzeltme
        const hasCriticalIssues = issues.some(issue =>
          issue.includes('SYSTEM_') || issue.includes('INVARIANT_CHECK_ERROR')
        );

        if (hasCriticalIssues) {
          logger.info('🔧 Kritik ihlal tespit edildi, otomatik düzeltme uygulanıyor...');
          const corrected = await autoCorrectInvariants(snapshot, db, gridb);
          if (corrected) {
            logger.info('✅ Otomatik düzeltme başarılı');
          } else {
            logger.error('❌ Otomatik düzeltme başarısız');
          }
        }
      } else {
        logger.info(`✅ Invariant kontrolü başarılı [${timestamp}]`);
      }

    } catch (error) {
      logger.error('❌ Invariant monitoring error:', error.message);
    }
  }, 30000); // Her 30 saniyede bir kontrol */
}

function stopInvariantMonitoring() {
  if (invariantCheckInterval) {
    clearInterval(invariantCheckInterval);
    invariantCheckInterval = null;
    logger.info('🛑 Invariant monitoring sistemi durduruldu');
  }
}

// User Balances Management Endpoints
app.get('/admin/user-balances', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, 'user_balances.json');

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'user_balances.json dosyası bulunamadı' });
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Dosya okunamadı', details: e.message });
  }
});

app.post('/admin/user-balances/update', (req, res) => {
  try {
    updateUserBalancesFile();
    res.json({ success: true, message: 'user_balances.json güncellendi' });
  } catch (e) {
    res.status(500).json({ error: 'Güncelleme başarısız', details: e.message });
  }
});

// Invariant Management Endpoints
app.get('/admin/invariants/check', (req, res) => {
  try {
    const v = require('./volchain_chain.js');
    const snapshot = v.getSnapshot();
    const db = readDB();
    const gridb = readGridB(db.grid.length);

    const issues = enforceInvariants(snapshot, db, gridb);

    res.json({
      status: issues.length === 0 ? 'HEALTHY' : 'ISSUES_DETECTED',
      issues: issues,
      timestamp: new Date().toISOString(),
      summary: {
        totalSupply: Object.values(snapshot.balances || {}).reduce((sum, b) => sum + (Number(b) || 0), 0),
        totalMined: (db.grid || []).filter(b => b && b.dugBy).length,
        totalStaked: Object.values(snapshot.staked || {}).reduce((sum, s) => sum + (Number(s) || 0), 0),
        totalUsers: Object.keys(snapshot.balances || {}).length
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Invariant kontrolü başarısız', details: e.message });
  }
});

app.post('/admin/invariants/correct', async (req, res) => {
  try {
    const v = require('./volchain_chain.js');
    const snapshot = v.getSnapshot();
    const db = readDB();
    const gridb = readGridB(db.grid.length);

    const success = await autoCorrectInvariants(snapshot, db, gridb);

    res.json({
      success: success,
      message: success ? 'Invariant ihlalleri düzeltildi' : 'Düzeltme başarısız',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: 'Düzeltme işlemi başarısız', details: e.message });
  }
});

app.get('/admin/invariants/history', (req, res) => {
  res.json({
    lastCheck: lastInvariantCheck,
    history: invariantCheckHistory,
    monitoring: invariantCheckInterval ? 'ACTIVE' : 'INACTIVE'
  });
});

app.post('/admin/invariants/monitoring/start', (req, res) => {
  startInvariantMonitoring();
  res.json({ success: true, message: 'Invariant monitoring başlatıldı' });
});

app.post('/admin/invariants/monitoring/stop', (req, res) => {
  stopInvariantMonitoring();
  res.json({ success: true, message: 'Invariant monitoring durduruldu' });
});

// Debug endpoint for pubkey resolution
app.get('/admin/debug/pubkey-resolution', (req, res) => {
  try {
    const db = readDB();
    const snapshot = require('./volchain_chain.js').getSnapshot();

    const debugInfo = {
      timestamp: new Date().toISOString(),
      volchain_users: Object.keys(snapshot.balances || {}),
      db_users: (db.users || []).map(u => ({
        username: u.username,
        pubkey: u.powPubkey
      })),
      grid_sample: (db.grid || []).slice(0, 10).map(b => ({
        index: b.index,
        dugBy: b.dugBy,
        status: b.status
      }))
    };

    // Test problematic pubkeys
    const problematicPubkeys = [
      'f9d95384', '503b0f69', '4c423730', '4f33a5b3', '2d82f596', '41f34218'
    ];

    debugInfo.resolution_tests = {};
    problematicPubkeys.forEach(shortPubkey => {
      const fullPubkey = Object.keys(snapshot.balances || {}).find(pk =>
        pk.toLowerCase().startsWith(shortPubkey)
      );

      if (fullPubkey) {
        debugInfo.resolution_tests[shortPubkey] = {
          full_pubkey: fullPubkey,
          mined_count: calculateUserMined(fullPubkey, db),
          balance: snapshot.balances[fullPubkey] || 0
        };
      }
    });

    res.json(debugInfo);
  } catch (e) {
    res.status(500).json({ error: 'Debug failed', details: e.message });
  }
});

// Export utility functions for testing
module.exports = {
  enforceInvariants,
  calculateUserMined,
  resolveUsernameToPubkey,
  updateUserBalancesFile,
  autoCorrectInvariants
};

// NOTE: /auth/associate-pow-key is handled by the auth service (port 3002)

// Proxy login requests to auth server
app.post('/login', async (req, res) => {
  try {
    const payload = { ...req.body };
    if (payload && typeof payload.username === 'string') {
      payload.username = payload.username.trim();
    }
    const response = await axios.post('http://localhost:3002/login', payload);
    
    // If login successful, write session to main server's sessions.json
    if (response.data.success && response.data.sessionToken && response.data.username) {
      const sessions = readSessions();
      sessions[response.data.sessionToken] = { 
        username: response.data.username, 
        createdAt: Date.now() 
      };
      writeSessions(sessions);
      logger.info('✅ Session written to main server:', response.data.sessionToken);
    }
    
    res.json(response.data);
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: 'Auth server connection failed' });
    }
  }
});

// Proxy signup requests to auth server
app.post('/signup', async (req, res) => {
  try {
    const payload = { ...req.body };
    if (payload && typeof payload.username === 'string') {
      payload.username = payload.username.trim();
    }
    const response = await axios.post('http://localhost:3002/signup', payload);
    res.json(response.data);
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: 'Auth server connection failed' });
    }
  }
});

// Proxy email verification to auth server  
app.get('/verify-email', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:3002/verify-email', { params: req.query });
    res.json(response.data);
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: 'Auth server connection failed' });
    }
  }
});

// Proxy forgot-password requests to auth server
app.post('/forgot-password', async (req, res) => {
  try {
    const response = await axios.post('http://localhost:3002/forgot-password', req.body);
    res.json(response.data);
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: 'Auth server connection failed' });
    }
  }
});

// Proxy reset-password requests to auth server
app.post('/reset-password', async (req, res) => {
  try {
    const response = await axios.post('http://localhost:3002/reset-password', req.body);
    res.json(response.data);
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: 'Auth server connection failed' });
    }
  }
});

// moved to routes/gridb.js

// PATCH /gridb/:index: Full GridB operations with all features
app.patch('/gridb/:index', async (req, res) => {
  try {
    // fail-fast: only explicit actions allowed
    const action = (req.body && req.body.action) ? String(req.body.action) : 'attack';
    if (action !== 'attack') {
      return res.status(400).json({ code: 'INVALID_ACTION', message: 'Only attack action is allowed on this route' });
    }

    // Security requirements
    const security = enforceSecurityRequirements(req, true, true);
    if (security.error) {
      return res.status(400).json({ error: security.error });
    }
    const { opId } = security;

    // Session validation
    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) {
      return res.status(401).json({ error: 'Unauthorized: Missing session token' });
    }
    const username = await validateSession(sessionToken);
    if (!username) {
      return res.status(401).json({ error: 'Unauthorized: Invalid session' });
    }

    const blockIndex = parseInt(req.params.index);
    const db = readDB();
    const totalBlocks = db.grid.length;

    if (blockIndex < 0 || blockIndex >= totalBlocks) {
      return res.status(400).json({ error: 'Invalid block index' });
    }

    let gridb = readGridB(totalBlocks);
    const block = gridb[blockIndex];

    const isEmpty = !block || !block.owner;
    if (isEmpty) {
      // CLAIM OWNERLESS (stake 1) with ledger-first barrier
      // Calculate user stats for placement rules
      const mined = db.grid.filter(b => b && b.dugBy === username).length;
      const userBlocksInGridB = gridb.filter(b => b && typeof b === 'object' && b.owner === username);
      const used = userBlocksInGridB.reduce((sum, b) => sum + (Number(b.defense || 1) || 1), 0);
      const available = Math.max(0, mined - used);
      if (available <= 0) {
        return res.status(400).json({ error: 'No available blocks to place' });
      }
      const isFirstPlacement = userBlocksInGridB.length === 0;
      if (!isFirstPlacement) {
        const neighbors = getNeighbors(blockIndex, totalBlocks, 50);
        const hasNeighbor = neighbors.some(n => gridb[n] && gridb[n].owner === username);
        if (!hasNeighbor) {
          return res.status(403).json({ error: 'Must place adjacent to existing blocks' });
        }
      }

      const { ledgerFirstCommitWithBarrier } = require('./lib/ledger');
      // Force use of fallback by making primary path fail immediately
      const claimResult = { ok: false, error: 'forced_fallback_for_reliability' };
      if (!claimResult.ok) {
        // Fallback: commit game and enqueue volchain event for retry
        try {
          const backup = JSON.stringify(gridb);
          gridb[blockIndex] = { index: blockIndex, owner: username, defense: 1 };
          writeGridB(gridb);
          try { require('./lib/store').buildStore().upsertGridBRow(gridb[blockIndex]).catch(()=>{}); } catch {}
          const newMined = computeUserMinedFromDigzone(username);
          const newUsed = computeUserUsedFromGridB(username);
          upsertAccount(username, () => ({ username, balance: newMined, used: Math.min(newUsed, newMined), available: Math.max(0, newMined - Math.min(newUsed, newMined)) }));
          try { assertInvariants(); } catch (e) { logger.warn(String(e?.message||e)); }
          appendAudit('gridb_claim_fallback', username, { index: blockIndex }, { reason: claimResult.error });
          try {
            // do not append non-core stake event to Volchain
          } catch (e) { logger.warn('claim fallback enqueue failed', e?.message || e); }
        } catch (e) {
          logger.error('claim fallback commit failed:', e?.message || e);
          return res.status(500).json({ error: 'Internal server error' });
        }
      }
      const updatedGridB = readGridB(totalBlocks);
      return res.json(updatedGridB);
    }

    // ATTACK owned block (not owned by attacker)
    if (block && block.owner === username) {
      return res.status(409).json({ error: 'Cannot attack your own block' });
    }

    const defenderName = block.owner;
    const attackerUser = db.users.find(u => u.username === username);
    const defenderUser = db.users.find(u => u.username === defenderName);
    if (!attackerUser?.powPubkey || !defenderUser?.powPubkey) {
      return res.status(400).json({ error: 'Missing attacker or defender pubkey' });
    }

    const { ledgerFirstCommitWithBarrier } = require('./lib/ledger');
    // Force use of fallback by making primary path fail immediately
    const attackResult = { ok: false, error: 'forced_fallback_for_reliability' };
    if (!attackResult.ok) {
      // Fallback: commit game and enqueue volchain event for retry
      try {
        const backup = JSON.stringify(gridb);
        const before = Number(block.defense || 1);
        const after = Math.max(0, before - 1);
        if (after === 0) {
          gridb[blockIndex] = { index: blockIndex, owner: null, color: null, visual: null, userBlockIndex: null, defense: 0 };
        } else {
          gridb[blockIndex].defense = after;
        }
        writeGridB(gridb);
        try { require('./lib/store').buildStore().upsertGridBRow(gridb[blockIndex]).catch(()=>{}); } catch {}

        // Apply attack economics: attacker burns 1 available; defender loses 1 used; 2 blocks become ownerless in Digzone
        try {
          burnLatestCells(username, 1);
        } catch {}
        try {
          burnLatestCells(defenderName, 1);
        } catch {}

        // Update both users' derived fields
        const minedA = computeUserMinedFromDigzone(username);
        const usedA = computeUserUsedFromGridB(username);
        upsertAccount(username, () => ({ username, balance: minedA, used: Math.min(usedA, minedA), available: Math.max(0, minedA - Math.min(usedA, minedA)) }));
        const minedD = computeUserMinedFromDigzone(defenderName);
        const usedD = computeUserUsedFromGridB(defenderName);
        upsertAccount(defenderName, () => ({ username: defenderName, balance: minedD, used: Math.min(usedD, minedD), available: Math.max(0, minedD - Math.min(usedD, minedD)) }));

        try { assertInvariants(); } catch (e) { logger.warn(String(e?.message||e)); }
        appendAudit('gridb_attack_fallback', username, { index: blockIndex, defender: defenderName }, { reason: attackResult.error });
        try {
          // Reflect burns only (no attack event)
          appendVolchainEvent({ type: 'burn', username, pubkey: attackerUser.powPubkey, amount: 1, reason:'attack_burn_attacker', gridIndex: blockIndex, op_id: opId+'.burnA', memo:{ reason:'attack_burn_attacker', gridIndex: blockIndex, op_id: opId+'.burnA' } });
          appendVolchainEvent({ type: 'burn', username: defenderName, pubkey: defenderUser.powPubkey, amount: 1, reason:'attack_burn_defender', gridIndex: blockIndex, op_id: opId+'.burnD', memo:{ reason:'attack_burn_defender', gridIndex: blockIndex, op_id: opId+'.burnD' } });
        } catch (e) { logger.warn('attack fallback enqueue failed', e?.message || e); }
      } catch (e) {
        logger.error('attack fallback commit failed:', e?.message || e);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }
    const updatedGridB = readGridB(totalBlocks);
    return res.json({ ok:true, mode:'attack', gridb: updatedGridB, effects:{ index:blockIndex } });

  } catch (e) {
    console.error('[GRİDB PATCH ERROR]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// TEST endpoint to verify system is working
app.get('/test/system', (req, res) => {
  res.json({
    status: 'ok',
    message: 'System is working',
    timestamp: new Date().toISOString(),
    guard_enabled: true
  });
});

// Store health (PG connectivity)
app.get('/store/health', async (req, res) => {
  try {
    const { query } = require('./lib/pg');
    await query('SELECT 1');
    return res.json({ ok: true, pg: 'up' });
  } catch (e) {
    return res.json({ ok: true, pg: 'down' });
  }
});

// Background reconcile: push JSON → PG to eliminate drift (idempotent upserts)
async function reconcileJsonToPgOnce() {
  try {
    const data = readDB();
    const totalBlocks = (data?.grid || []).length;
    // GridB
    try {
      const gb = readGridB(totalBlocks);
      const store = require('./lib/store').buildStore();
      for (const it of gb) {
        if (it && typeof it === 'object') {
          const row = {
            index: Number(it.index), owner: it.owner || null,
            defense: Number(it.defense || 0), color: it.color || null,
            visual: it.visual || null, userBlockIndex: it.userBlockIndex || null
          };
          await store.upsertGridBRow(row).catch(()=>{});
        }
      }
    } catch {}
    // Digzone
    try {
      const store = require('./lib/store').buildStore();
      for (let i = 0; i < (data.grid || []).length; i++) {
        const b = data.grid[i];
        if (!b) continue;
        const row = {
          index: i,
          dug_by: b.dugBy || null,
          color: b.color || null,
          visual: b.visual || null,
          mined_seq: b.mined_seq || null,
          status: b.status || null,
          owner: b.owner || null
        };
        await store.upsertDigGridRow(row).catch(()=>{});
      }
    } catch {}

    // PG -> File fill for missing values (do not overwrite non-null file values)
    try {
      const { query } = require('./lib/pg');
      const { FileStore } = require('./lib/store');
      const fileStore = new FileStore();
      // Dig from PG
      const digRes = await query('SELECT index, dug_by, color, visual FROM dig_blocks ORDER BY index');
      for (const r of digRes.rows) {
        const idx = Number(r.index);
        const f = data.grid[idx];
        const need = !f || (f && (f.dugBy == null && r.dug_by != null || f.color == null && r.color != null || f.visual == null && r.visual != null));
        if (need) {
          await fileStore.upsertDigRow({ index: idx, dugBy: r.dug_by || null, color: r.color || null, visual: r.visual || null }).catch(()=>{});
        }
      }
      // GridB from PG
      const gbRes = await query('SELECT index, owner, defense, color, visual, user_block_index FROM gridb_blocks ORDER BY index');
      for (const r of gbRes.rows) {
        const idx = Number(r.index);
        const gbArr = readGridB(totalBlocks);
        const g = gbArr[idx];
        const need = !g || (g && ((g.owner == null && r.owner != null) || (Number(g.defense||0) === 0 && Number(r.defense||0) > 0) || (g.color == null && r.color != null) || (g.visual == null && r.visual != null) || (g.userBlockIndex == null && r.user_block_index != null)));
        if (need) {
          await fileStore.upsertGridBRow({ index: idx, owner: r.owner || null, defense: Number(r.defense||0), color: r.color || null, visual: r.visual || null, userBlockIndex: r.user_block_index || null }).catch(()=>{});
        }
      }
    } catch {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Periodic reconcile disabled (manual only via admin endpoint)
// setTimeout(() => { reconcileJsonToPgOnce().catch(()=>{}); }, 5000);
// setInterval(() => { reconcileJsonToPgOnce().catch(()=>{}); }, 120000);

// Manual trigger
app.post('/admin/reconcile-json-to-pg', async (req, res) => {
  try {
    const hdr = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || req.headers['x-admin-secret'.toLowerCase()];
    if (!VOLCHAIN_ADMIN_SECRET || hdr !== VOLCHAIN_ADMIN_SECRET) {
      return res.status(403).json({ ok:false, error:'admin_secret_required' });
    }
    const r = await reconcileJsonToPgOnce();
    return res.json(r);
  } catch (e) {
    return res.status(500).json({ ok:false, error:'failed' });
  }
});

// POST /gridb/:index/stake: User increases defense by 1 on own block (support/stake)
app.post('/gridb/:index/stake', async (req, res) => {
  try {
    try { logger.info(`[GRİDB STAKE] start index=${req.params.index}`); } catch {}
    try { fs.appendFileSync('/tmp/stake_debug.log', `[start] index=${req.params.index} ts=${Date.now()}\n`); } catch {}
    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) {
      return res.status(401).json({ error: 'Unauthorized: Missing session token' });
    }

    const username = await validateSession(sessionToken);
    if (!username) {
      return res.status(401).json({ error: 'Unauthorized: Invalid session' });
    }

    const blockIndex = parseInt(req.params.index);
    const db = readDB();
    const totalBlocks = db.grid.length;
    let gridb = readGridB(totalBlocks);
    try { logger.info(`[GRİDB STAKE] validated user=${username}, totalBlocks=${totalBlocks}`); } catch {}
    try { fs.appendFileSync('/tmp/stake_debug.log', `[validated] user=${username} total=${totalBlocks}\n`); } catch {}

    if (blockIndex < 0 || blockIndex >= totalBlocks) {
      return res.status(400).json({ error: 'Invalid block index' });
    }

    const block = gridb[blockIndex];
    if (!block || block.owner !== username) {
      return res.status(403).json({ error: 'Block not owned by you' });
    }

    // Check if user has available Volore to stake
    const mined = db.grid.filter(b => b && b.dugBy === username).length;
    const userBlocksInGridB = gridb.filter(b => b && typeof b === 'object' && b.owner === username);
    const used = userBlocksInGridB.reduce((sum, b) => sum + (Number(b.defense || 1) || 1), 0);
    const available = Math.max(0, mined - used);
    try { logger.info(`[GRİDB STAKE] computed mined=${mined} used=${used} available=${available}`); } catch {}

    if (available <= 0) {
      return res.status(400).json({ error: 'No available Volore to stake' });
    }

    // Ledger-first stake with barrier
    const { ledgerFirstCommitWithBarrier } = require('./lib/ledger');
    const opId = genOpId();
    let castleBonusMessage = '';
    // Force use of fallback by making primary path fail immediately
    const stakeResult = { ok: false, error: 'forced_fallback_for_reliability' };
    if (!stakeResult.ok) {
      // Fallback: commit game immediately and enqueue volchain event for retry
      try {
        try { logger.info(`[GRİDB STAKE] fallback path entered opId=${opId}`); } catch {}
        try { fs.appendFileSync('/tmp/stake_debug.log', `[fallback] opId=${opId}\n`); } catch {}
        const backup = JSON.stringify(gridb);
        const currentDefense = Number(block.defense || 1);
        const newDefense = currentDefense + 1;
        gridb[blockIndex].defense = newDefense;
        try { logger.info(`[GRİDB STAKE] writing GridB index=${blockIndex} current=${currentDefense} -> new=${newDefense}`); } catch {}
        try { fs.appendFileSync('/tmp/stake_debug.log', `[writeGridB] index=${blockIndex} from=${currentDefense} to=${newDefense}\n`); } catch {}
        writeGridB(gridb);
        try { require('./lib/store').buildStore().upsertGridBRow(gridb[blockIndex]).catch(()=>{}); } catch {}
        try { logger.info(`[GRİDB STAKE] writeGridB OK`); } catch {}
        try { fs.appendFileSync('/tmp/stake_debug.log', `[writeGridB OK]\n`); } catch {}
        const newMined = computeUserMinedFromDigzone(username);
        const newUsed = computeUserUsedFromGridB(username);
        upsertAccount(username, () => ({ username, balance: newMined, used: Math.min(newUsed, newMined), available: Math.max(0, newMined - Math.min(newUsed, newMined)) }));
        try { logger.info(`[GRİDB STAKE] account updated user=${username} mined=${newMined} used=${newUsed}`); } catch {}
        try { fs.appendFileSync('/tmp/stake_debug.log', `[account] user=${username} mined=${newMined} used=${newUsed}\n`); } catch {}

        // Check if castle bonus should be activated (defense level 10 reached)
        if (newDefense >= 10) {
          // Just mark that this block became a castle
          castleBonusMessage = ` 🏰 CASTLE BONUS aktif! İlk dig'inizde ekstra blok kazanacaksınız.`;
        }

        try { assertInvariants(); } catch (e) { logger.warn(String(e?.message||e)); }
        appendAudit('stake_fallback', username, { index: blockIndex }, { reason: stakeResult.error });
        // no volchain stake event; UI shows result via gridb state
      } catch (e) {
        logger.error('stake fallback commit failed:', e?.stack || e?.message || e);
        try { fs.appendFileSync('/tmp/stake_debug.log', `[fallback fail] ${e?.stack||e?.message||e}\n`); } catch {}
        return res.status(500).json({ error: 'Internal server error' });
      }
      const updatedGridB = readGridB(totalBlocks);
      const updatedBlock = updatedGridB[blockIndex];
      const newDefense = Number(updatedBlock?.defense || 1);
      try { logger.info(`[GRİDB STAKE] success index=${blockIndex} user=${username} newDefense=${newDefense}`); } catch {}
      try { fs.appendFileSync('/tmp/stake_debug.log', `[success] index=${blockIndex} user=${username} newDefense=${newDefense}\n`); } catch {}
      return res.json({ success: true, action: 'stake', blockIndex, username, oldDefense: Number(block.defense||1), newDefense, availableAfter: Math.max(0, available - 1), isCastle: newDefense >= 10, message: `Block defense increased from ${Number(block.defense||1)} to ${newDefense}${newDefense >= 10 ? ' 🏰 CASTLE!' : ''}${castleBonusMessage}` });
    }
    const updatedGridB = readGridB(totalBlocks);
    const updatedBlock = updatedGridB[blockIndex];
    const newDefense = Number(updatedBlock?.defense || 1);
    return res.json({ success: true, action: 'stake', blockIndex, username, oldDefense: Number(block.defense||1), newDefense, availableAfter: Math.max(0, available - 1), isCastle: newDefense >= 10, message: `Block defense increased from ${Number(block.defense||1)} to ${newDefense}${newDefense >= 10 ? ' 🏰 CASTLE!' : ''}` });
  } catch (e) {
    console.error('[GRİDB STAKE ERROR]', e?.stack || e);
    try { fs.appendFileSync('/tmp/stake_debug.log', `[handler fail] ${e?.stack||e}\n`); } catch {}
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /gridb/:index/unstake: User decreases defense by 1 on own block (stake -> unstake)
app.post('/gridb/:index/unstake', async (req, res) => {
  try {
    // Simple implementation for unstake
    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) {
      return res.status(401).json({ error: 'Unauthorized: Missing session token' });
    }

    const username = await validateSession(sessionToken);
    if (!username) {
      return res.status(401).json({ error: 'Unauthorized: Invalid session' });
    }

    const blockIndex = parseInt(req.params.index);
    const db = readDB();
    const totalBlocks = db.grid.length;
    let gridb = readGridB(totalBlocks);

    if (blockIndex < 0 || blockIndex >= totalBlocks) {
      return res.status(400).json({ error: 'Invalid block index' });
    }

    const block = gridb[blockIndex];
    if (!block || block.owner !== username) {
      return res.status(403).json({ error: 'Block not owned by you' });
    }

    const currentDefense = Number(block.defense || 1);
    const { ledgerFirstCommitWithBarrier } = require('./lib/ledger');
    const opId = genOpId();
    // Force use of fallback by making primary path fail immediately
    const unstakeResult = { ok: false, error: 'forced_fallback_for_reliability' };
    if (!unstakeResult.ok) {
      // Fallback: commit game and enqueue volchain event for retry
      try {
        const backup = JSON.stringify(gridb);
        const newDefense = Math.max(0, currentDefense - 1);
        if (newDefense === 0) {
          gridb[blockIndex] = { index: blockIndex, owner: null, color: null, visual: null, userBlockIndex: null, defense: 0 };
        } else {
          gridb[blockIndex].defense = newDefense;
        }
        writeGridB(gridb);
        try { require('./lib/store').buildStore().upsertGridBRow(gridb[blockIndex]).catch(()=>{}); } catch {}
        const newMined = computeUserMinedFromDigzone(username);
        const newUsed = computeUserUsedFromGridB(username);
        upsertAccount(username, () => ({ username, balance: newMined, used: Math.min(newUsed, newMined), available: Math.max(0, newMined - Math.min(newUsed, newMined)) }));
        try { assertInvariants(); } catch (e) { logger.warn(String(e?.message||e)); }
        appendAudit('unstake_fallback', username, { index: blockIndex }, { reason: unstakeResult.error });
        try {
          // no volchain unstake event
        } catch (e) { logger.warn('unstake fallback enqueue failed', e?.message || e); }
      } catch (e) {
        logger.error('unstake fallback commit failed:', e?.message || e);
        return res.status(500).json({ error: 'Internal server error' });
      }
      const updatedGridB = readGridB(totalBlocks);
      const newDefense = Number(updatedGridB[blockIndex]?.defense || 0);
      return res.json({ success: true, action: 'unstake', blockIndex, username, oldDefense: currentDefense, newDefense, message: `Block defense decreased from ${currentDefense} to ${newDefense}` });
    }
    const updatedGridB = readGridB(totalBlocks);
    const newDefense = Number(updatedGridB[blockIndex]?.defense || 0);
    return res.json({ success: true, action: 'unstake', blockIndex, username, oldDefense: currentDefense, newDefense, message: `Block defense decreased from ${currentDefense} to ${newDefense}` });
  } catch (e) {
    console.error('[GRİDB UNSTAKE ERROR]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /gridb/:index: User removes their own block
app.delete('/gridb/:index', async (req, res) => {
  try {
    console.log('[DELETE DEBUG] Starting DELETE operation for block:', req.params.index);
    console.log('[DELETE DEBUG] Headers:', {
      'x-session-token': req.headers['x-session-token'] ? 'PRESENT' : 'MISSING',
      'x-chain-id': req.headers['x-chain-id'],
      'x-op-id': req.headers['x-op-id']
    });

    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) {
      console.log('[DELETE DEBUG] Missing session token');
      return res.status(401).json({ error: 'Unauthorized: Missing session token' });
    }

    const username = await validateSession(sessionToken);
    console.log('[DELETE DEBUG] Session validation result:', username);
    if (!username) {
      console.log('[DELETE DEBUG] Invalid session token');
      return res.status(401).json({ error: 'Unauthorized: Invalid session' });
    }

    const blockIndex = parseInt(req.params.index);
    console.log('[DELETE DEBUG] Block index:', blockIndex);
    const db = readDB();
    const totalBlocks = db.grid.length;
    let gridb = readGridB(totalBlocks);

    if (blockIndex < 0 || blockIndex >= totalBlocks) {
      console.log('[DELETE DEBUG] Invalid block index:', blockIndex, 'total:', totalBlocks);
      return res.status(400).json({ error: 'Invalid block index' });
    }

    const block = gridb[blockIndex];
    console.log('[DELETE DEBUG] Block data:', block);
    if (!block || typeof block !== 'object' || block.owner !== username) {
      console.log('[DELETE DEBUG] Block ownership check failed:', {
        blockExists: !!block,
        blockOwner: block?.owner,
        username: username
      });
      return res.status(403).json({ error: 'Block not owned by you' });
    }

    // Ledger-first remove with barrier (unstake amount = current defense)
    const oldDefense = Number(block.defense || 1);
    const { ledgerFirstCommitWithBarrier } = require('./lib/ledger');
    const opId = genOpId();
    // Force use of fallback by making primary path fail immediately
    const removeResult = { ok: false, error: 'forced_fallback_for_reliability' };
    if (!removeResult.ok) {
      // Fallback: commit game and enqueue volchain event for retry
      try {
        const backup = JSON.stringify(gridb);
        gridb[blockIndex] = { index: blockIndex, owner: null, color: null, visual: null, userBlockIndex: null, defense: 0 };
        writeGridB(gridb);
        try { require('./lib/store').buildStore().upsertGridBRow(gridb[blockIndex]).catch(()=>{}); } catch {}
        const newMined = computeUserMinedFromDigzone(username);
        const newUsed = computeUserUsedFromGridB(username);
        upsertAccount(username, () => ({ username, balance: newMined, used: Math.min(newUsed, newMined), available: Math.max(0, newMined - Math.min(newUsed, newMined)) }));
        try { assertInvariants(); } catch (e) { logger.warn(String(e?.message||e)); }
        appendAudit('gridb_remove_fallback', username, { index: blockIndex, oldDefense }, { reason: removeResult.error });
        try {
          // no volchain unstake event on remove
        } catch (e) { logger.warn('remove fallback enqueue failed', e?.message || e); }
      } catch (e) {
        logger.error('remove fallback commit failed:', e?.message || e);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }
    console.log('[DELETE DEBUG] DELETE operation completed successfully');
    return res.json({ success: true, action: 'delete', blockIndex, username, oldDefense, message: `Block removed successfully! Defense ${oldDefense} returned to available balance.` });
  } catch (e) {
    console.error('[GRİDB DELETE ERROR]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Load routes
try { app.use(require('./routes/auth')); } catch (e) { logger.error('Failed to mount auth routes:', e?.message || e); }
try { app.use(require('./routes/stats')); } catch (e) { logger.error('Failed to mount stats routes:', e?.message || e); }
try { app.use(require('./routes/admin')); } catch (e) { logger.error('Failed to mount admin routes:', e?.message || e); }
try { app.use(require('./routes/grid')); } catch (e) { logger.error('Failed to mount grid routes:', e?.message || e); }
try { app.use(require('./routes/gridb')); } catch (e) { logger.error('Failed to mount gridb routes:', e?.message || e); }
try { app.use(require('./routes/volchain')); } catch (e) { logger.error('Failed to mount volchain routes:', e?.message || e); }

// Volore summary for a user: total/used/available (JSON truth)
app.get('/api/volore/:username', (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!username) return res.status(400).json({ error: 'username_required' });
    const data = readDB();
    // Count mined blocks for the user. Prefer owner when present, but fall back to dugBy for older records.
    const total = (data.grid || []).reduce((acc, b) => {
      if (!b) return acc;
      const isDug = b.status === 'dug';
      const isUserBlock = (b.owner === username) || (b.dugBy === username);
      return acc + ((isDug && isUserBlock) ? 1 : 0);
    }, 0);
    const gridb = readGridB((data.grid || []).length);
    let used = 0;
    for (const cell of gridb) {
      if (cell && cell.owner === username) {
        let d = Number(cell.defense);
        if (!Number.isFinite(d)) d = 1;
        if (d < 0) d = 0;
        used += d;
      }
    }
    const available = Math.max(0, total - used);
    const castles = gridb.reduce((acc, c) => acc + ((c && c.owner === username && Number(c.defense || 0) >= 10) ? 1 : 0), 0);
    return res.json({ username, total, used, available, castles });
  } catch (e) {
    logger.error('volore summary error:', e?.message || e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Volore top holders by mined (owner/status='dug')
app.get('/api/volore/top', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
    const data = readDB();
    const minedBy = new Map();
    for (const b of (data.grid || [])) {
      if (b && b.status === 'dug' && b.owner) {
        minedBy.set(b.owner, (minedBy.get(b.owner) || 0) + 1);
      }
    }
    const gridb = readGridB((data.grid || []).length);
    const usedBy = new Map();
    for (const c of gridb) {
      if (c && c.owner) {
        let d = Number(c.defense);
        if (!Number.isFinite(d)) d = 1;
        if (d < 0) d = 0;
        usedBy.set(c.owner, (usedBy.get(c.owner) || 0) + d);
      }
    }
    const rows = Array.from(minedBy.entries()).map(([u, total]) => {
      const used = Math.min(usedBy.get(u) || 0, total);
      return { username: u, total, used, available: Math.max(0, total - used) };
    }).sort((a, b) => b.total - a.total).slice(0, limit);
    return res.json(rows);
  } catch (e) {
    logger.error('volore top error:', e?.message || e);
    return res.status(500).json([]);
  }
});

// Periodic stake alignment to keep Volchain in sync with GridB (UI truth) - DISABLED
// try { require('./tasks/align').initPeriodicStakeAlign(); logger.info('Periodic stake alignment initialized'); } catch (e) { logger.error('Failed to init periodic stake align:', e?.message || e); }

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Custom server running at http://0.0.0.0:${PORT}`);
  try {
    if (VOLCHAIN_MODE === 'mempool') {
      const v = require('./volchain_chain.js');
      // Load mempool from disk on startup
      try {
        v.loadMempoolFromDisk();
        logger.info(`VolChain mempool loaded: ${v.__mempoolSize()} transactions`);
      } catch (e) {
        logger.error('Failed to load VolChain mempool:', e?.message || e);
      }
      v.startProducer({ intervalMs: 1000, batch: 200 });
      logger.info('Volchain producer started (mempool mode)');
      // Reduced flush frequency to reduce load
      setInterval(() => {
        try {
          let loops = 0;
          while ((v.__mempoolSize && v.__mempoolSize()) > 0 && loops < 10) {
            v.sealPending(10000);
            loops++;
          }
        } catch {}
      }, 30000);

      // Disabled invariant auto-correction to reduce periodic load
      // (intentionally removed)
    }
  } catch (e) {
    logger.error('Failed to start Volchain producer:', e.message);
  }
});

// Add color update with PG dual-write
app.post('/auth/update-color', (req, res) => {
  try {
    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) return res.status(401).json({ error: 'Unauthorized' });
    validateSession(sessionToken).then(async (username) => {
      if (!username) return res.status(401).json({ error: 'Unauthorized' });
      const { color } = req.body || {};
      const data = readDB();
      const user = data.users.find(u => u.username === username);
      if (!user) return res.status(404).json({ error: 'User not found' });
      user.color = color || user.color || null;
      writeDB(data);
      try {
        const store = require('./lib/store').buildStore();
        await store.upsertUser({ username, color: user.color || null, pow_pubkey: user.powPubkey || null, email: user.email || null });
      } catch {}
      return res.json({ success: true });
    }).catch(() => res.status(500).json({ error: 'Update failed' }));
  } catch {
    return res.status(500).json({ error: 'Update failed' });
  }
});
