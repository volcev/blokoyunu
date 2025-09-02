const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ed25519 = require('@noble/ed25519');
const { sha512 } = require('@noble/hashes/sha512');
const { bech32 } = require('bech32');

const DATA_DIR = process.env.VOLCHAIN_DIR ? String(process.env.VOLCHAIN_DIR) : path.join(__dirname, 'volchain');
const CHAIN_ID = 'volchain-main';
const DIGID_MODE = String(process.env.VOLCHAIN_DIGID_MODE || 'enforce'); // 'shadow' | 'enforce'
const MAX_TX_PER_BLOCK = Number(process.env.VOLCHAIN_MAX_TX_PER_BLOCK || 100);
const MAX_BLOCK_BYTES = Number(process.env.VOLCHAIN_MAX_BLOCK_BYTES || (256 * 1024));
const MAX_MEMPOOL_BYTES = Number(process.env.VOLCHAIN_MAX_MEMPOOL_BYTES || (8 * 1024 * 1024));
const LOG_FILE = path.join(DATA_DIR, 'chain.log'); // JSONL (one JSON per line)
const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot.json');
const BLOCKS_FILE = path.join(DATA_DIR, 'blocks.log'); // JSONL block headers
const MEMPOOL_FILE = path.join(DATA_DIR, 'mempool.jsonl'); // JSONL tx queue (crash-safe)
const BLOCKS_DIR = path.join(DATA_DIR, 'blocks'); // full blocks
const KEYS_DIR = path.join(__dirname, 'keys');
const VALIDATOR_KEY_FILE = path.join(KEYS_DIR, 'validator_key.json');

// -------------------- HELPERS / TYPES --------------------
// Tx shape: { type, from, to?, amount, nonce, memo?, pubkey, sig }

// Ensure noble-ed25519 has a sync SHA-512 provider in Node
try {
  if (ed25519 && ed25519.utils) ed25519.utils.sha512Sync = (msg) => sha512(msg);
  if (ed25519 && ed25519.etc) ed25519.etc.sha512Sync = (msg) => sha512(msg);
} catch {}
function isInt(n) {
  const v = Number(n);
  return Number.isFinite(v) && Math.floor(v) === v && v > 0;
}

function sortedObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  Object.keys(obj).sort().forEach(k => { out[k] = obj[k]; });
  return out;
}

function canonicalTx(tx) {
  const base = {
    chain_id: CHAIN_ID,
    type: tx?.type || null,
    from: tx?.from || null,
    to: (typeof tx?.to === 'undefined') ? null : tx?.to,
    amount: Number(tx?.amount || 0),
    nonce: Number(tx?.nonce || 0),
    memo: sortedObject(tx?.memo || null),
    pubkey: tx?.pubkey || null
  };
  return JSON.stringify(base);
}

function available(acc) {
  const balance = Number(acc?.balance || 0);
  const staked = Number(acc?.staked || 0);
  return balance - staked;
}

function extractDigId(evtOrTx) {
  try {
    const memo = evtOrTx?.memo || (evtOrTx && typeof evtOrTx === 'object' && evtOrTx.memo);
    if (memo && typeof memo.dig_id === 'string' && memo.dig_id.length > 0) return memo.dig_id;
    const reason = evtOrTx?.reason || (evtOrTx?.memo && evtOrTx.memo.reason);
    if (reason === 'dig' || reason === 'castle_bonus') {
      return null; // marker of dig, but no explicit id available
    }
  } catch {}
  return null;
}

function extractOpId(evtOrTx) {
  try {
    const memo = evtOrTx?.memo || (evtOrTx && typeof evtOrTx === 'object' && evtOrTx.memo);
    if (memo && typeof memo.op_id === 'string' && memo.op_id.length > 0) return memo.op_id;
  } catch {}
  return null;
}

// base64 <-> hex utils
function hexToBytes(hex) {
  const h = String(hex || '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(h) || h.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function bytesToB64(u8) { return Buffer.from(u8).toString('base64'); }
function b64ToHex(b64) {
  try { return Buffer.from(String(b64 || ''), 'base64').toString('hex'); } catch { return ''; }
}
function hexToB64(hex) {
  try { return Buffer.from(String(hex || ''), 'hex').toString('base64'); } catch { return ''; }
}
function addrFromPub(pubInput) {
  // pubInput can be base64 string or Uint8Array
  let u8;
  if (typeof pubInput === 'string') {
    try { u8 = Buffer.from(pubInput, 'base64'); } catch { u8 = Buffer.alloc(0); }
  } else { u8 = pubInput; }
  // Fallback: sha256 first 20 bytes (align with CLI)
  const h20 = crypto.createHash('sha256').update(u8).digest().subarray(0, 20);
  const words = bech32.toWords(h20);
  return bech32.encode('v1', words);
}

function listKnownAccountKeys(state) {
  const keys = new Set();
  if (state && state.accounts) for (const k of Object.keys(state.accounts)) keys.add(k);
  if (state && state.balances) for (const k of Object.keys(state.balances)) keys.add(k);
  if (state && state.staked) for (const k of Object.keys(state.staked)) keys.add(k);
  return Array.from(keys);
}

function resolveFromKey(tx, state) {
  try {
    const pkHex = resolveKeys(tx.pubkey);
    const computedAddr = addrFromPub(tx.pubkey);
    // Allow SYSTEM-origin ops to bypass from-address check
    if (tx.from && tx.from !== 'SYSTEM' && computedAddr !== tx.from) throw new Error('FROM_ADDRESS_MISMATCH');
    return pkHex;
  } catch (e) {
    throw new Error('BAD_PUBKEY');
  }
}

// Pubkey ve adres çözümleme (tek kapı)
// resolveKeys: bech32 v1 / base64(32 byte) / hex64 → kanonik 64-hex
function resolveKeys(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('BAD_PUBKEY');
  }

  // 1. Check if it's already hex64
  if (/^[0-9a-fA-F]{64}$/.test(input)) {
    return input.toLowerCase();
  }

  // 2. Check if it's base64(32 byte)
  try {
    const decoded = Buffer.from(input, 'base64');
    if (decoded.length === 32) {
      return decoded.toString('hex');
    }
  } catch {}

  // 3. Check if it's bech32 v1
  try {
    const decoded = bech32.decode(input);
    if (decoded.prefix === 'v1' && decoded.words.length === 32) {
      const bytes = bech32.fromWords(decoded.words);
      if (bytes.length === 20) {
        // Convert 20-byte hash back to 32-byte pubkey format
        // Note: This is a simplified conversion - in practice you'd need the original pubkey
        return Buffer.from(bytes).toString('hex').padStart(64, '0');
      }
    }
  } catch {}

  throw new Error('BAD_PUBKEY');
}

function resolveToKey(tx, state) {
  // Preferred: explicit toPubkey
  const explicit = tx.toPubkey || (tx.memo && tx.memo.toPubkey);
  if (explicit) {
    try {
      return resolveKeys(explicit);
    } catch (e) {
      throw new Error('BAD_TO_PUBKEY');
    }
  }
  // Fallback: map existing accounts by address
  const keys = listKnownAccountKeys(state);
  for (const hex of keys) {
    const u8 = hexToBytes(hex);
    const addr = addrFromPub(u8);
    if (addr === tx.to) return hex;
  }
  throw new Error('TO_RESOLVE_FAILED');
}

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ lastId: 0, lastHash: null, balances: {}, lastBlockId: 0, lastBlockHash: null, height: 0 }, null, 2));
  }
  if (!fs.existsSync(BLOCKS_FILE)) fs.writeFileSync(BLOCKS_FILE, '');
  if (!fs.existsSync(MEMPOOL_FILE)) fs.writeFileSync(MEMPOOL_FILE, '');
  if (!fs.existsSync(BLOCKS_DIR)) fs.mkdirSync(BLOCKS_DIR, { recursive: true });
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });
}

function getValidatorKeypair() {
  ensureDirs();
  try {
    if (fs.existsSync(VALIDATOR_KEY_FILE)) {
      const obj = JSON.parse(fs.readFileSync(VALIDATOR_KEY_FILE, 'utf8'));
      if (obj && obj.publicKey && obj.secretKey) return obj;
    }
  } catch {}
  // generate one-time key
  const sk = crypto.randomBytes(32);
  // For validator id, we can just record a static marker; publicKey computation is optional for now
  const pubMarker = 'LOCAL';
  const sec = Buffer.from(sk).toString('base64');
  const obj = { publicKey: pubMarker, secretKey: sec };
  fs.writeFileSync(VALIDATOR_KEY_FILE, JSON.stringify(obj, null, 2));
  return obj;
}

function getValidatorPubKey() {
  const kp = getValidatorKeypair();
  return kp.publicKey;
}

async function verifyTxSignature(tx) {
  try {
    if (tx.from === 'SYSTEM') {
      // TODO: SYSTEM tx signature check can be added later
      return true;
    }
    const pubHex = Buffer.from(String(tx.pubkey || ''), 'base64');
    const sig = Buffer.from(String(tx.sig || ''), 'base64');
    if (pubHex.length !== 32 || sig.length !== 64) return false;
    const msg = Buffer.from(canonicalTx(tx));
    return await ed25519.verify(sig, msg, pubHex);
  } catch {
    return false;
  }
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function readSnapshot() {
  ensureDirs();
  try { return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')); } catch { return { lastId: 0, lastHash: null, balances: {} }; }
}

function writeSnapshot(snap) {
  // VOLCHAIN_WRITE: snapshot write (strict)
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap, null, 2));
}

function appendLine(obj) {
  // VOLCHAIN_WRITE: append event line to chain.log (strict)
  fs.appendFileSync(LOG_FILE, JSON.stringify(obj) + '\n');
}

// -------------------- MEMPOOL & TX MODEL --------------------
/** In-memory mempool (array of validated txs waiting to be sealed) */
let mempool = [];

// Barrier metrics
let barrierWaitTotalMs = 0;
let barrierTimeoutsTotal = 0;

function readJSONLines(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split(/\n+/).filter(Boolean);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function appendJSONLine(file, obj) {
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, JSON.stringify(obj) + '\n');
    fs.fsyncSync(fd);
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

function getFileSize(pathStr) {
  try { const st = fs.statSync(pathStr); return Number(st.size || 0); } catch { return 0; }
}

function loadMempoolFromDisk() {
  ensureDirs();
  const txs = readJSONLines(MEMPOOL_FILE);
  mempool = txs;
}

function rewriteMempoolFile() {
  const fd = fs.openSync(MEMPOOL_FILE, 'w');
  try {
    for (const tx of mempool) {
      fs.writeSync(fd, JSON.stringify(tx) + '\n');
    }
    fs.fsyncSync(fd);
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

// Translate legacy event shape to tx shape
function translateEventToTx(evt) {
  // Common fields are moved to memo
  const memo = {};
  if (evt.reason) memo.reason = evt.reason;
  if (typeof evt.gridIndex === 'number') memo.gridIndex = evt.gridIndex;
  if (evt.username) memo.username = evt.username;
  if (evt.dig_id) memo.dig_id = evt.dig_id;
  if (evt.op_id) memo.op_id = evt.op_id;
  try { if (evt.memo && typeof evt.memo.op_id === 'string' && !memo.op_id) memo.op_id = evt.memo.op_id; } catch {}
  const now = Date.now();
  if (evt.type === 'transfer') {
    return {
      type: 'transfer',
      from: evt.from,
      to: evt.to,
      amount: Number(evt.amount) || 0,
      pubkey: evt.from,
      nonce: 0,
      memo,
      sig: null,
      ts: now
    };
  }
  if (evt.type === 'mint') {
    // Ensure destination can be resolved by prevalidator: provide toPubkey (base64)
    let toPubB64 = null;
    try {
      if (evt && typeof evt.pubkey === 'string') {
        if (/^[0-9a-fA-F]{64}$/.test(evt.pubkey)) {
          toPubB64 = hexToB64(evt.pubkey);
        } else {
          // Assume already base64
          toPubB64 = evt.pubkey;
        }
      }
    } catch {}
    if (toPubB64) {
      try { memo.toPubkey = memo.toPubkey || toPubB64; } catch {}
    }
    return {
      type: 'mint',
      from: 'SYSTEM',
      pubkey: evt.pubkey,
      amount: Number(evt.amount) || 0,
      to: null,
      toPubkey: toPubB64 || null,
      nonce: 0,
      memo,
      sig: null,
      ts: now
    };
  }
  if (evt.type === 'burn') {
    // Ensure proper from address (bech32) and base64 pubkey
    let pubB64 = null;
    try {
      if (evt && typeof evt.pubkey === 'string') {
        if (/^[0-9a-fA-F]{64}$/.test(evt.pubkey)) pubB64 = hexToB64(evt.pubkey);
        else pubB64 = evt.pubkey; // assume already base64
      }
    } catch {}
    const fromAddr = pubB64 ? addrFromPub(pubB64) : null;
    return {
      type: 'burn',
      from: fromAddr,
      pubkey: pubB64 || evt.pubkey,
      amount: Number(evt.amount) || 0,
      nonce: 0,
      memo,
      sig: null,
      ts: now
    };
  }
  if (evt.type === 'attack') {
    // Attack event: attacker vs defender, encoded using toPubkey in memo
    let attackerB64 = null;
    let defenderB64 = null;
    try {
      if (evt && typeof evt.attackerPubkey === 'string') {
        attackerB64 = /^[0-9a-fA-F]{64}$/.test(evt.attackerPubkey) ? hexToB64(evt.attackerPubkey) : evt.attackerPubkey;
      }
      if (evt && typeof evt.defenderPubkey === 'string') {
        defenderB64 = /^[0-9a-fA-F]{64}$/.test(evt.defenderPubkey) ? hexToB64(evt.defenderPubkey) : evt.defenderPubkey;
      }
    } catch {}
    const fromAddr = attackerB64 ? addrFromPub(attackerB64) : null;
    if (defenderB64) {
      try { memo.toPubkey = memo.toPubkey || defenderB64; } catch {}
    }
    if (!memo.reason) memo.reason = 'warzone_attack';
    return {
      type: 'attack',
      from: fromAddr,
      to: null,
      amount: 1,
      nonce: 0,
      memo,
      pubkey: attackerB64 || null,
      sig: null,
      ts: now
    };
  }
  if (evt.type === 'stake' || evt.type === 'unstake') {
    // Server-managed stake/unstake: force SYSTEM origin to bypass all validation
    const reason = (evt && evt.reason) || (memo && memo.reason) || null;
    let pubB64 = null;
    try {
      if (evt && typeof evt.pubkey === 'string') {
        if (/^[0-9a-fA-F]{64}$/.test(evt.pubkey)) pubB64 = hexToB64(evt.pubkey);
        else pubB64 = evt.pubkey; // assume already base64
      }
    } catch {}
    return {
      type: evt.type,
      from: 'SYSTEM',
      pubkey: pubB64 || evt.pubkey,
      amount: Number(evt.amount) || 0,
      nonce: 0,
      memo,
      sig: null,
      ts: now
    };
  }
  return { type: String(evt.type || ''), from: 'SYSTEM', amount: 0, pubkey: evt.pubkey || null, nonce: 0, memo, sig: null, ts: now };
}

function getAccountState(snap, pk) {
  if (!snap.accounts) snap.accounts = {};
  if (!snap.accounts[pk]) snap.accounts[pk] = { nonce: 0 };
  return snap.accounts[pk];
}

function prevalidateTxUsingState(snap, tx) {
  // Server-managed stake/unstake: bypass ALL prevalidation
  try {
    const t = String(tx?.type || '');
    if (t === 'stake' || t === 'unstake') {
      return true;
    }
  } catch {}
  // amount must be positive integer
  const amt = Number(tx.amount);
  if (!Number.isFinite(amt) || amt <= 0 || Math.floor(amt) !== amt) throw new Error('invalid_amount');
  // memo size limit (JSON-encoded)
  try {
    const m = (typeof tx.memo !== 'undefined' && tx.memo !== null) ? JSON.stringify(tx.memo) : '';
    if (m && Buffer.byteLength(m) > 256) throw new Error('memo_too_large');
  } catch (e) { if (e && e.message === 'memo_too_large') throw e; }
  // op_id idempotency (required for all non-exempt ops)
  try {
    const opId = tx?.memo?.op_id || null;
    const reason = tx?.memo?.reason || null;
    const exemptReasons = new Set(['seed', 'seed_backfill', 'reset_reseed']);
    const exempt = exemptReasons.has(reason);
    if (!exempt) {
      if (!opId || typeof opId !== 'string' || opId.length === 0) throw new Error('missing_op_id');
      if (!snap.usedOpIds) snap.usedOpIds = {};
      if (snap.usedOpIds[opId]) throw new Error('duplicate_op_id');
    }
  } catch (e) {
    if (e && (e.message === 'missing_op_id' || e.message === 'duplicate_op_id')) throw e;
  }
  // dig_id policy (mint only; seeds/backfills/castle_bonus exempt)
  try {
    const digId = tx?.memo?.dig_id || null;
    const reason = tx?.memo?.reason || null;
    const isMint = (tx?.type === 'mint');
    const exempt = (!isMint) || (reason === 'seed' || reason === 'seed_backfill' || reason === 'reset_reseed' || reason === 'castle_bonus');
    if (!exempt) {
      if (!digId) {
        if (DIGID_MODE === 'enforce') throw new Error('DIG_ID_REQUIRED');
        else console.warn('[dig_id shadow] missing dig_id on mint');
      }
    }
    if (digId) {
      if (!snap.usedDigIds) snap.usedDigIds = {};
      if (snap.usedDigIds[digId]) {
        if (DIGID_MODE === 'enforce') throw new Error('DIG_ID_DUPLICATE');
        else console.warn('[dig_id shadow] duplicate dig_id detected:', digId);
      }
    }
  } catch (e) {
    if (e && (e.message === 'DIG_ID_REQUIRED' || e.message === 'DIG_ID_DUPLICATE')) throw e;
  }
  // nonce check (skip for SYSTEM, server-side reasons, and stake/unstake types)
  const reason = tx?.memo?.reason || null;
  const reasonAllowed = (
    reason === 'support' ||
    reason === 'claim_ownerless' ||
    reason === 'warzone_attack_cost' ||
    reason === 'warzone_defense_loss' ||
    reason === 'warzone_attack' ||
    reason === 'manual_unstake' ||
    reason === 'remove_block' ||
    reason === 'backfill' ||
    reason === 'reset_reseed' ||
    reason === 'server_transfer'
  );
  try { console.log('[PRECHECK NONCE] type=%s reason=%s from=%s', tx?.type, reason, tx?.from); } catch {}
  if (tx.from && tx.from !== 'SYSTEM' && !(reasonAllowed || tx.type === 'stake' || tx.type === 'unstake' || Number(tx.nonce||0) === 0)) {
    const fromKey = resolveFromKey(tx, snap);
    const acc = getAccountState(snap, fromKey);
    const expected = Number(acc.nonce || 0) + 1;
    if (Number(tx.nonce || 0) !== expected) throw new Error('invalid_nonce');
  }
  const balances = snap.balances || {};
  const staked = snap.staked || {};
  const balanceOf = (pk) => Number(balances[pk] || 0);
  const stakedOf = (pk) => Number(staked[pk] || 0);
  if (tx.type === 'transfer') {
    const fromKey = resolveFromKey(tx, snap);
    const avail = balanceOf(fromKey) - stakedOf(fromKey);
    if (amt > avail) throw new Error('insufficient_available');
    // also ensure destination can be resolved now
    resolveToKey(tx, snap);
  }
  if (tx.type === 'burn') {
    // Allow server-side burn without from nonce (attack/defense loss)
    const pk = (tx.from === 'SYSTEM' && tx.pubkey && /^[A-Za-z0-9+/=]+$/.test(String(tx.pubkey)))
      ? b64ToHex(tx.pubkey)
      : resolveFromKey(tx, snap);
    const avail = balanceOf(pk) - stakedOf(pk);
    if (amt > avail) throw new Error('insufficient_available');
  }
  if (tx.type === 'stake') {
    const pk = resolveFromKey(tx, snap);
    const avail = balanceOf(pk) - stakedOf(pk);
    if (amt > avail) throw new Error('insufficient_available');
  }
  if (tx.type === 'mint') {
    // Ensure destination resolves via toPubkey or address mapping
    resolveToKey({ to: tx.to, toPubkey: tx.toPubkey, memo: tx.memo }, snap);
  }
  return true;
}

function applyTx(snap, tx) {
  const normInt = (n) => Math.max(0, Math.floor(Number(n) || 0));
  const inc = (obj, k, v) => { obj[k] = normInt((obj[k] || 0) + v); };
  const balances = snap.balances || (snap.balances = {});
  const staked = snap.staked || (snap.staked = {});
  if (tx.from && tx.from !== 'SYSTEM') getAccountState(snap, tx.from).nonce = (getAccountState(snap, tx.from).nonce || 0) + 1;
  const amt = normInt(tx.amount);
  if (tx.type === 'mint') {
    inc(balances, tx.pubkey, amt);
  } else if (tx.type === 'burn') {
    inc(balances, tx.pubkey, -amt);
  } else if (tx.type === 'transfer') {
    inc(balances, tx.from, -amt);
    inc(balances, tx.to, amt);
  } else if (tx.type === 'stake') {
    inc(staked, tx.pubkey, amt);
  } else if (tx.type === 'unstake') {
    inc(staked, tx.pubkey, -amt);
  }
  // Record dig_id used
  const digId = tx?.memo?.dig_id;
  if (digId) {
    if (!snap.usedDigIds) snap.usedDigIds = {};
    snap.usedDigIds[digId] = true;
  }
}

// -------------------- STATE MACHINE (STRONG RULES) --------------------
function getBalanceMap(state) { return state.balances || (state.balances = {}); }
function getStakedMap(state) { return state.staked || (state.staked = {}); }
function getAccountsMap(state) { return state.accounts || (state.accounts = {}); }
function getNonce(state, pk) { const a = getAccountsMap(state)[pk] || (getAccountsMap(state)[pk] = { nonce: 0 }); return Number(a.nonce || 0); }
function setNonce(state, pk, n) { const a = getAccountsMap(state)[pk] || (getAccountsMap(state)[pk] = { nonce: 0 }); a.nonce = Number(n) || 0; }
function bal(state, pk) { return Number(getBalanceMap(state)[pk] || 0); }
function stk(state, pk) { return Number(getStakedMap(state)[pk] || 0); }
function setBal(state, pk, v) { getBalanceMap(state)[pk] = Math.max(0, Math.floor(Number(v) || 0)); }
function setStk(state, pk, v) { getStakedMap(state)[pk] = Math.max(0, Math.floor(Number(v) || 0)); }
function sumBalances(state) { return Object.values(getBalanceMap(state)).reduce((a, b) => a + Number(b || 0), 0); }

function ensureAccount(state, pkHex) {
  if (!state.accounts) state.accounts = {};
  if (!state.accounts[pkHex]) state.accounts[pkHex] = { nonce: 0 };
  if (!state.balances) state.balances = {};
  if (!state.staked) state.staked = {};
  if (typeof state.balances[pkHex] !== 'number') state.balances[pkHex] = 0;
  if (typeof state.staked[pkHex] !== 'number') state.staked[pkHex] = 0;
  return pkHex;
}

function applyTxToSnapshot(state, tx) {
  if (!state.usedDigIds) state.usedDigIds = {};
  if (typeof state.supply !== 'number') state.supply = sumBalances(state);
  const amount = Number(tx.amount);
  if (!Number.isFinite(amount) || amount <= 0 || Math.floor(amount) !== amount) throw new Error('invalid_amount');

  // Nonce rule (skip SYSTEM or server-origin reasons)
  let fromKeyHex = null;
  if (tx.from && tx.from !== 'SYSTEM') {
    const reason = tx?.memo?.reason || null;
    const reasonAllowed = (
      reason === 'support' ||
      reason === 'claim_ownerless' ||
      reason === 'warzone_attack_cost' ||
      reason === 'warzone_defense_loss' ||
      reason === 'warzone_attack' ||
      reason === 'manual_unstake' ||
      reason === 'remove_block' ||
      reason === 'backfill' ||
      reason === 'reset_reseed' ||
      reason === 'server_transfer'
    );
    fromKeyHex = resolveFromKey(tx, state);
    ensureAccount(state, fromKeyHex);
    if (!(reasonAllowed || tx.type === 'stake' || tx.type === 'unstake')) {
      const expected = getNonce(state, fromKeyHex) + 1;
      if (Number(tx.nonce || 0) !== expected) throw new Error('invalid_nonce');
    }
  }

  const did = tx?.memo?.dig_id || null;
  if (did) {
    if (state.usedDigIds[did]) throw new Error('duplicate_dig_id');
  }
  const opCheck = tx?.memo?.op_id || null;
  if (opCheck) {
    if (!state.usedOpIds) state.usedOpIds = {};
    if (state.usedOpIds[opCheck]) throw new Error('duplicate_op_id');
  }

  if (tx.type === 'mint') {
    const toKey = resolveToKey({ to: tx.to, toPubkey: tx.toPubkey, memo: tx.memo }, state);
    ensureAccount(state, toKey);
    setBal(state, toKey, bal(state, toKey) + amount);
    state.supply = Number(state.supply || 0) + amount;
  } else if (tx.type === 'burn') {
    const pk = resolveFromKey(tx, state);
    ensureAccount(state, pk);
    const avail = bal(state, pk) - stk(state, pk);
    if (amount > avail) throw new Error('insufficient_available');
    setBal(state, pk, bal(state, pk) - amount);
    state.supply = Number(state.supply || 0) - amount;
  } else if (tx.type === 'transfer') {
    const from = resolveFromKey(tx, state);
    const to = resolveToKey(tx, state);
    ensureAccount(state, from); ensureAccount(state, to);
    const avail = bal(state, from) - stk(state, from);
    if (amount > avail) throw new Error('insufficient_available');
    setBal(state, from, bal(state, from) - amount);
    setBal(state, to, bal(state, to) + amount);
  } else if (tx.type === 'stake') {
    const pk = resolveFromKey(tx, state);
    ensureAccount(state, pk);
    const avail = bal(state, pk) - stk(state, pk);
    if (amount > avail) throw new Error('insufficient_available');
    setStk(state, pk, stk(state, pk) + amount);
  } else if (tx.type === 'unstake') {
    const pk = resolveFromKey(tx, state);
    ensureAccount(state, pk);
    if (amount > stk(state, pk)) throw new Error('insufficient_stake');
    setStk(state, pk, stk(state, pk) - amount);
  } else if (tx.type === 'attack') {
    // INVARIANT: attack: attacker -1 (burn, available -1), defender -1 (burn, used -1). Supply -2
    const attacker = resolveFromKey(tx, state);
    const defender = resolveToKey(tx, state);
    ensureAccount(state, attacker);
    ensureAccount(state, defender);
    
    // Attacker loses 1 block (burn, available -1)
    const attackerAvail = bal(state, attacker) - stk(state, attacker);
    if (attackerAvail < 1) throw new Error('attacker_insufficient_available');
    setBal(state, attacker, bal(state, attacker) - 1);
    
    // Defender loses 1 block (burn, used -1)
    if (stk(state, defender) < 1) throw new Error('defender_insufficient_stake');
    setStk(state, defender, stk(state, defender) - 1);
    
    // Supply decreases by 2
    state.supply = Number(state.supply || 0) - 2;
  }

  // Mark dig_id used after successful application
  if (did) state.usedDigIds[did] = true;
  // Mark op_id used after successful application
  const opMark = tx?.memo?.op_id || null;
  if (opMark) {
    if (!state.usedOpIds) state.usedOpIds = {};
    state.usedOpIds[opMark] = true;
  }

  // Increment nonce for non-SYSTEM senders
  if (fromKeyHex && tx.from !== 'SYSTEM') setNonce(state, fromKeyHex, getNonce(state, fromKeyHex) + 1);
}

function applyBlock(state, txs) {
  for (const tx of txs) {
    applyTxToSnapshot(state, tx);
  }
  
  // INVARIANT GUARD: verify all invariants after applying transactions
  const guardResult = invariantGuard(state);
  if (!guardResult.ok) {
    throw new Error(`invariant_violation: ${guardResult.error}`);
  }
}

// Invariant Guard: verify all system invariants
function invariantGuard(state) {
  try {
    const balances = state.balances || {};
    const staked = state.staked || {};
    const keys = Object.keys(balances);
    
    // Per-user invariants: balance == mined == used + available
    for (const key of keys) {
      const balance = Number(balances[key] || 0);
      const stakedAmount = Number(staked[key] || 0);
      const available = Math.max(0, balance - stakedAmount);
      
      // balance == used + available (staked + available)
      if (balance !== stakedAmount + available) {
        return {
          ok: false,
          error: `user_invariant_violation: ${key}`,
          details: {
            user: key,
            balance,
            staked: stakedAmount,
            available,
            expected: stakedAmount + available
          }
        };
      }
    }
    
    // System-wide invariants: Σ(balance) == Σ(mined) == Σ(used) + Σ(available)
    const totalBalance = sumBalances(state);
    const totalStaked = Object.values(staked).reduce((sum, val) => sum + Number(val || 0), 0);
    const totalAvailable = totalBalance - totalStaked;
    
    if (totalBalance !== totalStaked + totalAvailable) {
      return {
        ok: false,
        error: 'system_invariant_violation',
        details: {
          totalBalance,
          totalStaked,
          totalAvailable,
          expected: totalStaked + totalAvailable
        }
      };
    }
    
    // Supply invariant: supply == Σ(balance)
    if (Number(state.supply || 0) !== totalBalance) {
      return {
        ok: false,
        error: 'supply_invariant_violation',
        details: {
          supply: state.supply,
          totalBalance,
          expected: totalBalance
        }
      };
    }
    
    return { ok: true };
    
  } catch (e) {
    return {
      ok: false,
      error: `guard_error: ${e.message}`,
      details: { exception: e.message }
    };
  }
}

function deepClone(obj) {
  try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
}

function precheckBundle(txs) {
  ensureDirs();
  const base = readSnapshot();
  const sim = deepClone(base);
  for (const tx of (txs || [])) {
    prevalidateTxUsingState(sim, tx);
    applyTxToSnapshot(sim, tx);
  }
  const total = sumBalances(sim);
  if (Number(sim.supply || 0) !== total) throw new Error('supply_invariant_violation');
  return { ok: true };
}

function enqueueTx(tx) {
  ensureDirs();
  // Load snapshot to validate
  const snap = readSnapshot();
  prevalidateTxUsingState(snap, tx);
  // Enforce mempool file size cap
  try {
    const approx = Buffer.byteLength(JSON.stringify(tx) + '\n');
    const cur = getFileSize(MEMPOOL_FILE);
    if (cur + approx > MAX_MEMPOOL_BYTES) {
      throw new Error('mempool_full');
    }
  } catch (e) {
    if (String(e?.message) === 'mempool_full') throw e;
  }
  // Push to RAM and disk
  mempool.push(tx);
  appendJSONLine(MEMPOOL_FILE, tx);
  return true;
}

function drainTx(max = 100) {
  const n = Math.max(0, Math.min(Number(max) || 0, mempool.length));
  const batch = mempool.splice(0, n);
  rewriteMempoolFile();
  return batch;
}

// -------------------- BLOCK PRODUCER --------------------
let producerTimer = null;
let __lastProducedTime = 0;
let __producerStartTime = 0;

function computeTxsHash(txs) {
  try {
    return sha256(JSON.stringify(txs.map(t => ({ type: t.type, from: t.from, to: t.to, amount: t.amount, pubkey: t.pubkey, nonce: t.nonce, memo: t.memo, ts: t.ts }))));
  } catch { return sha256(String(Math.random())); }
}

function writeBlockFiles(header, fullBlock) {
  appendJSONLine(BLOCKS_FILE, header);
  const fname = String(header.height).padStart(8, '0') + '.json';
  const fpath = path.join(BLOCKS_DIR, fname);
  fs.writeFileSync(fpath, JSON.stringify(fullBlock, null, 2));
}

function produceOneBlock(maxBatch = 100) {
  if (mempool.length === 0) return null;
  const snapshotBefore = readSnapshot();
  const batch = drainTx(Math.min(Number(MAX_TX_PER_BLOCK) || 1, maxBatch));
  if (batch.length === 0) return null;
  try {
    // Verify signatures and collect valid txs
    const verified = [];
    let bytesUsed = 0;
    for (const tx of batch) {
      if (tx.from === 'SYSTEM') { verified.push(tx); continue; }
      // Allow server-origin reasons to bypass signature verification
      const reason = tx?.memo?.reason || null;
      const reasonAllowed = (
        reason === 'support' ||
        reason === 'claim_ownerless' ||
        reason === 'warzone_attack_cost' ||
        reason === 'warzone_defense_loss' ||
        reason === 'warzone_attack' ||
        reason === 'manual_unstake' ||
        reason === 'remove_block' ||
        reason === 'backfill' ||
        reason === 'backfill_align' ||
        reason === 'reset_reseed' ||
        reason === 'server_transfer' ||
        reason === 'dig' ||
        reason === 'castle_bonus' ||
        reason === 'attack_burn_attacker' ||
        reason === 'attack_burn_defender'
      );
      let ok = false;
      if (reasonAllowed) {
        ok = true;
      } else {
        ok = typeof verifyTxSignature === 'function' ? (/* sync wrapper */ () => { try { return ed25519.sync.verify(Buffer.from(String(tx.sig||''),'base64'), Buffer.from(canonicalTx(tx)), Buffer.from(String(tx.pubkey||''),'base64')); } catch { return false; } })() : true;
      }
      if (!ok) continue;
      // Enforce per-block limits: count and bytes
      const tbytes = Buffer.byteLength(JSON.stringify(tx));
      if (verified.length >= (Number(MAX_TX_PER_BLOCK) || 1)) break;
      if (bytesUsed + tbytes > (Number(MAX_BLOCK_BYTES) || (256*1024))) break;
      verified.push(tx);
      bytesUsed += tbytes;
    }
    if (verified.length === 0) return null;

    // Apply block to snapshot
    const snap = snapshotBefore;
    applyBlock(snap, verified);

    // Build header
    const nowTs = Date.now();
    const ts = (__lastProducedTime && nowTs <= __lastProducedTime) ? (__lastProducedTime + 1) : nowTs;
    __lastProducedTime = ts;
    const height = (snap.height || 0) + 1;
    const prev = snap.lastBlockHash || null;
    const txsHash = computeTxsHash(verified);
    const header = { height, prev_hash: prev, hash: sha256(String(prev || '') + String(height) + String(ts) + txsHash), time: ts, txsHash, validator: getValidatorPubKey(), signature: null, count: verified.length };
    const fullBlock = { ...header, txs: verified };

    // Update snapshot head pointers
    snap.lastBlockId = (snap.lastBlockId || 0) + verified.length;
    snap.lastBlockHash = header.hash;
    snap.height = height;
    snap.lastBlockTime = ts;

    // Legacy chain.log lines for compatibility (one per tx)
    let nextId = (snapshotBefore.lastId || 0) + 1;
    for (const tx of verified) {
      const evt = txToLegacyEvent(tx, snap);
      const bodyHash = sha256(JSON.stringify({ id: nextId, ts: tx.ts, type: evt.type, payload: { ...evt, ts: tx.ts } }));
      const hash = sha256((snap.lastHash || '') + bodyHash);
      const chainedLine = { id: nextId, prev_hash: snap.lastHash, hash, ts: tx.ts, ...evt };
      appendLine(chainedLine);
      snap.lastId = nextId;
      snap.lastHash = hash;
      nextId++;
    }

    // Persist snapshot and block
    writeSnapshot(snap);
    writeBlockFiles(header, fullBlock);
    return header;
  } catch (e) {
    // Rollback: prepend batch back to mempool
    mempool = batch.concat(mempool);
    rewriteMempoolFile();
    return null;
  }
}

function txToLegacyEvent(tx, state) {
  // Ensure legacy log uses hex pubkeys/addresses consistently
  const ensureHex = (val) => {
    if (!val) return val;
    if (typeof val === 'string' && /^[0-9a-fA-F]{64}$/.test(val)) return val.toLowerCase();
    // if it's base64 pubkey, convert to hex
    try { const hex = b64ToHex(val); if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return hex.toLowerCase(); } catch {}
    return val;
  };
  const base = { ts: tx.ts };
  if (tx.type === 'transfer') return { ...base, type: 'transfer', from: ensureHex(tx.from), to: ensureHex(tx.to), amount: tx.amount };
  if (tx.type === 'mint') {
    // Some mints use memo.toPubkey (base64) with empty tx.pubkey → resolve and emit in legacy event
    const key = (tx && tx.pubkey) ? tx.pubkey : (tx && tx.memo && tx.memo.toPubkey ? tx.memo.toPubkey : null);
    return { ...base, type: 'mint', pubkey: ensureHex(key), amount: tx.amount, reason: tx?.memo?.reason };
  }
  if (tx.type === 'burn') return { ...base, type: 'burn', pubkey: ensureHex(tx.pubkey), amount: tx.amount, reason: tx?.memo?.reason };
  if (tx.type === 'stake') return { ...base, type: 'stake', pubkey: ensureHex(tx.pubkey), amount: tx.amount, reason: tx?.memo?.reason };
  if (tx.type === 'unstake') return { ...base, type: 'unstake', pubkey: ensureHex(tx.pubkey), amount: tx.amount, reason: tx?.memo?.reason };
  if (tx.type === 'attack') return { ...base, type: 'attack', from: ensureHex(tx.from), to: ensureHex(tx?.memo?.toPubkey || null), amount: 1, reason: tx?.memo?.reason };
  return { ...base, type: tx.type };
}

function startProducer(optsOrInterval = { intervalMs: 2000, batch: 100 }, maybeBatch) {
  if (producerTimer) return;
  loadMempoolFromDisk();
  let intervalMs = 2000;
  let batch = 100;
  if (typeof optsOrInterval === 'object') {
    intervalMs = Number(optsOrInterval.intervalMs || 2000);
    batch = Number(optsOrInterval.batch || 100);
  } else {
    intervalMs = Number(optsOrInterval || 2000);
    batch = Number(maybeBatch || 100);
  }
  __producerStartTime = Date.now();
  producerTimer = setInterval(() => {
    try {
      if (mempool.length === 0) return;
      produceOneBlock(batch);
    } catch {}
  }, intervalMs);
}

function getProducerUptimeMs() {
  if (!__producerStartTime) return 0;
  const now = Date.now();
  return Math.max(0, now - __producerStartTime);
}

function normalizeInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

function applyDelta(snap, evt) {
  // Track balances by pubkey strictly
  if (!snap) return;
  if (!snap.balances) snap.balances = {};
  if (!snap.staked) snap.staked = {};
  const inc = (pk, amt) => {
    if (!pk) return;
    const before = normalizeInt(snap.balances[pk] || 0);
    const after = Math.max(0, before + normalizeInt(amt));
    snap.balances[pk] = after;
  };
  const dec = (pk, amt) => inc(pk, -normalizeInt(amt));

  const incStake = (pk, amt) => {
    if (!pk) return;
    const before = normalizeInt(snap.staked[pk] || 0);
    const after = Math.max(0, before + normalizeInt(amt));
    snap.staked[pk] = after;
  };
  const decStake = (pk, amt) => incStake(pk, -normalizeInt(amt));

  if (evt.type === 'mint') {
    inc(evt.pubkey, evt.amount || 0);
  } else if (evt.type === 'burn') {
    dec(evt.pubkey, evt.amount || 0);
  } else if (evt.type === 'transfer') {
    dec(evt.from, evt.amount || 0);
    inc(evt.to, evt.amount || 0);
  } else if (evt.type === 'stake') {
    incStake(evt.pubkey, evt.amount || 0);
  } else if (evt.type === 'unstake') {
    decStake(evt.pubkey, evt.amount || 0);
  }
}

function appendEvent(evt) {
  // evt: { type, ts?, ...payload }
  ensureDirs();
  // Translate and enqueue to mempool; legacy callers continue to work
  const tx = translateEventToTx(evt);
  enqueueTx(tx);
  return { ok: true };
}

function getTopHolders(limit = 10) {
  ensureDirs();
  const snap = readSnapshot(); // VOLCHAIN_READ
  const entries = Object.entries(snap.balances || {});
  return entries
    .map(([pubkey, balance]) => ({ pubkey, balance: normalizeInt(balance) }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, Math.max(0, limit));
}

function getSnapshot() {
  ensureDirs();
  return readSnapshot(); // VOLCHAIN_READ
}

function getHead() {
  const snap = getSnapshot();
  return { height: snap?.height || 0, appHash: snap?.lastBlockHash || null, time: snap?.lastBlockTime || null };
}

function getState(addr) {
  try {
    const snap = getSnapshot();
    const balances = snap?.balances || {};
    const staked = snap?.staked || {};
    const accounts = snap?.accounts || {};
    
    // Resolve addr (bech32) to hex if needed; we stored only hex keys in maps
    let key = null;
    // If addr looks like v1_... try to match against known keys by derived address
    if (typeof addr === 'string' && addr.startsWith('v1')) {
      const keys = listKnownAccountKeys(snap);
      for (const k of keys) {
        const u8 = hexToBytes(k);
        const a = addrFromPub(u8);
        if (a === addr) { key = k; break; }
      }
    } else if (typeof addr === 'string' && /^[0-9a-fA-F]{64}$/.test(addr)) {
      // Accept either lower or upper case hex keys
      const lower = addr.toLowerCase();
      const upper = addr.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(balances, lower) || Object.prototype.hasOwnProperty.call(staked, lower) || Object.prototype.hasOwnProperty.call(accounts, lower)) {
        key = lower;
      } else if (Object.prototype.hasOwnProperty.call(balances, upper) || Object.prototype.hasOwnProperty.call(staked, upper) || Object.prototype.hasOwnProperty.call(accounts, upper)) {
        key = upper;
      } else {
        key = lower;
      }
    }
    
    const bal = Number(balances[key] || 0);
    const stk = Number(staked[key] || 0);
    
    // INVARIANT: balance == mined == used + available
    // mined = Digzone'da kazılan block sayısı (balance)
    // used = GridB'de stake edilen block sayısı (staked)
    // available = mined - used
    const mined = bal; // balance = mined (invariant)
    const used = stk;  // staked = used (invariant)
    const avail = Math.max(0, mined - used); // available = mined - used (invariant)
    
    const nonce = Number((accounts[key] && accounts[key].nonce) || 0);
    
    return { 
      balance: bal, 
      staked: stk, 
      available: avail, 
      mined: mined,  // Add mined field
      nonce 
    };
  } catch {
    return { balance: 0, staked: 0, available: 0, mined: 0, nonce: 0 };
  }
}

function verifyByReplay() {
  // Dual-source verification: accept match against either sealed blocks or legacy chain.log
  ensureDirs();
  const snap = readSnapshot();

  const compareBalances = (calc) => {
    const snapBalances = snap?.balances || {};
    const keys = new Set([...Object.keys(snapBalances), ...Object.keys(calc || {})]);
    for (const k of keys) {
      const a = Number(snapBalances[k] || 0);
      const b = Number((calc || {})[k] || 0);
      if (a !== b) return { match: false, account: k, snapshot: a, computed: b };
    }
    return { match: true };
  };
  const compareBalancesSubset = (calc) => {
    const snapBalances = snap?.balances || {};
    const keys = Object.keys(calc || {});
    for (const k of keys) {
      const a = Number(snapBalances[k] || 0);
      const b = Number((calc || {})[k] || 0);
      if (a !== b) return { match: false, account: k, snapshot: a, computed: b };
    }
    return { match: true };
  };

  // 1) Try sealed blocks
  let blocksResult = null;
  try {
    const files = fs.readdirSync(BLOCKS_DIR).filter(f => /\.json$/.test(f)).sort();
    if (files.length > 0) {
      const reco = { balances: {}, staked: {}, accounts: {}, usedDigIds: {}, supply: 0 };
      for (const f of files) {
        try {
          const full = JSON.parse(fs.readFileSync(path.join(BLOCKS_DIR, f), 'utf8'));
          const txs = Array.isArray(full?.txs) ? full.txs : [];
          for (const tx of txs) applyTxToSnapshot(reco, tx);
        } catch {}
      }
      // For blocks, accept subset match (pre-chain balances may exist in snapshot)
      const cmp = compareBalancesSubset(reco.balances);
      if (cmp.match) return { ok: true, mode: 'blocks', height: snap.height || 0, accounts: Object.keys(snap?.balances||{}).length };
      blocksResult = cmp; // store first mismatch for reporting if needed
    }
  } catch {}

  // 2) Try legacy chain.log
  try {
    let prevHash = null;
    let lastId = 0;
    let lastHash = null;
    const recomputed = { balances: {} };
    let raw;
    try { raw = fs.readFileSync(LOG_FILE, 'utf8'); } catch { raw = ''; }
    const lines = raw.split(/\n+/).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      let evt;
      try { evt = JSON.parse(lines[i]); } catch { return { ok: false, error: 'parse_error', at: i+1 }; }
      const { id, hash, prev_hash, ...rest } = evt;
      const ts = rest.ts;
      const type = rest.type;
      const payload = rest;
      try {
        if (type === 'mint' || type === 'burn' || type === 'stake' || type === 'unstake') {
          if (payload.pubkey && /^[A-Za-z0-9+/=]+$/.test(payload.pubkey) && !( /^[0-9a-fA-F]{64}$/.test(payload.pubkey) )) {
            const hex = b64ToHex(payload.pubkey);
            if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) payload.pubkey = hex.toLowerCase();
          }
        }
        if (type === 'transfer') {
          const fix = (v) => {
            if (typeof v === 'string' && /^[0-9a-fA-F]{64}$/.test(v)) return v.toLowerCase();
            try { const h = b64ToHex(v); if (h && /^[0-9a-fA-F]{64}$/.test(h)) return h.toLowerCase(); } catch {}
            return v;
          };
          payload.from = fix(payload.from);
          payload.to = fix(payload.to);
        }
      } catch {}
      const bodyHash = sha256(JSON.stringify({ id, ts, type, payload }));
      const expectedHash = sha256((prevHash || '') + bodyHash);
      if (hash !== expectedHash) return { ok: false, error: 'hash_mismatch', id };
      if ((prev_hash || null) !== (prevHash || null)) return { ok: false, error: 'prev_hash_mismatch', id };
      applyDelta(recomputed, { ...evt, ...payload });
      prevHash = hash;
      lastId = id;
      lastHash = hash;
    }
    const cmp = compareBalances(recomputed.balances);
    if (cmp.match) return { ok: true, mode: 'legacy', lastId, lastHash, accounts: Object.keys(snap?.balances||{}).length };
    // If neither matched, report the blocks mismatch if available, else the legacy mismatch
    if (blocksResult && blocksResult.account) return { ok: false, error:'balance_mismatch', account: blocksResult.account, snapshot: blocksResult.snapshot, computed: blocksResult.computed, mode:'blocks' };
    return { ok: false, error:'balance_mismatch', account: cmp.account, snapshot: cmp.snapshot, computed: cmp.computed, mode:'legacy' };
  } catch {
    // If legacy fails, and we had a blocks mismatch, report it
    if (blocksResult && blocksResult.account) return { ok: false, error:'balance_mismatch', account: blocksResult.account, snapshot: blocksResult.snapshot, computed: blocksResult.computed, mode:'blocks' };
    return { ok: false, error:'verify_failed' };
  }
}

module.exports = {
  appendEvent, // legacy API → enqueueTx(translateEventToTx)
  enqueueTx,
  drainTx,
  startProducer,
  translateEventToTx,
  canonicalTx,
  extractDigId,
  extractOpId,
  getTopHolders,
  getSnapshot,
  getHead,
  getState,
  verifyTxSignature,
  b64ToHex,
  hexToB64,
  addrFromPub,
  resolveKeys,
  __mempoolSize: () => mempool.length,
  __producerUptimeMs: () => getProducerUptimeMs(),
  precheckBundle,
  appendBundle,
  waitUntilSealed,
  waitUntilApplied,
  getBarrierMetrics: () => ({ 
    volchain_barrier_wait_ms_total: barrierWaitTotalMs,
    volchain_barrier_timeouts_total: barrierTimeoutsTotal 
  }),
  getRecentEvents: function(limit = 100) {
    ensureDirs();
    try {
      const raw = fs.readFileSync(LOG_FILE, 'utf8');
      const lines = raw.split(/\n+/).filter(Boolean);
      const tail = lines.slice(-Math.max(1, Math.min(1000, limit))).reverse();
      const events = [];
      for (const ln of tail) {
        try { events.push(JSON.parse(ln)); } catch {}
      }
      return events;
    } catch {
      return [];
    }
  },
  getEvents: function(limit = 100, beforeId) {
    ensureDirs();
    try {
      const raw = fs.readFileSync(LOG_FILE, 'utf8');
      const lines = raw.split(/\n+/).filter(Boolean);
      const out = [];
      const max = Math.max(1, Math.min(1000, limit));
      const cursor = Number.isFinite(beforeId) ? Number(beforeId) : Infinity;
      // iterate from tail (newest first)
      for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
        try {
          const evt = JSON.parse(lines[i]);
          if (Number.isFinite(cursor) && typeof evt.id === 'number' && !(evt.id < cursor)) {
            continue;
          }
          out.push(evt);
        } catch {}
      }
      // Determine nextCursor: if there are more older lines beyond what we returned
      let nextCursor = null;
      if (out.length > 0) {
        const oldestId = out[out.length - 1].id;
        // Are there any lines with id < oldestId?
        let hasMore = false;
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const evt = JSON.parse(lines[i]);
            if (typeof evt.id === 'number' && evt.id < oldestId) { hasMore = true; break; }
          } catch {}
        }
        if (hasMore) nextCursor = oldestId;
      }
      return { events: out, nextCursor };
    } catch {
      return { events: [], nextCursor: null };
    }
  }
  , sealPending: function(maxEventsPerBlock = 1000) {
    // Seal current mempool immediately into a block
    return produceOneBlock(maxEventsPerBlock) || null;
  }
  , getBlocks: function(limit = 50, beforeHeight) {
    ensureDirs();
    try {
      const raw = fs.readFileSync(BLOCKS_FILE, 'utf8');
      const lines = raw.split(/\n+/).filter(Boolean);
      const out = [];
      const max = Math.max(1, Math.min(1000, limit));
      const cursor = Number.isFinite(beforeHeight) ? Number(beforeHeight) : Infinity;
      for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
        try {
          const b = JSON.parse(lines[i]);
          if (Number.isFinite(cursor) && typeof b.height === 'number' && !(b.height < cursor)) continue;
          out.push(b);
        } catch {}
      }
      let nextCursor = null;
      if (out.length > 0) {
        const oldestH = out[out.length - 1].height;
        for (let i = lines.length - 1; i >= 0; i--) {
          try { const b = JSON.parse(lines[i]); if (typeof b.height === 'number' && b.height < oldestH) { nextCursor = oldestH; break; } } catch {}
        }
      }
      return { blocks: out, nextCursor };
    } catch {
      return { blocks: [], nextCursor: null };
    }
  }
  , verify: verifyByReplay
  , computeBlocksState: function(){
    // Compute state strictly by replaying sealed blocks
    try {
      ensureDirs();
      const files = fs.readdirSync(BLOCKS_DIR).filter(f => /\.json$/.test(f)).sort();
      const st = { balances: {}, staked: {}, accounts: {}, usedDigIds: {}, supply: 0 };
      for (const f of files) {
        try {
          const full = JSON.parse(fs.readFileSync(path.join(BLOCKS_DIR, f), 'utf8'));
          const txs = Array.isArray(full?.txs) ? full.txs : [];
          for (const tx of txs) applyTxToSnapshot(st, tx);
        } catch {}
      }
      return st;
    } catch {
      return { balances: {}, staked: {}, accounts: {}, usedDigIds: {}, supply: 0 };
    }
  }
  , enqueueSeedBackfillTxs: function(){
    // Enqueue mint/burn txs to reconcile snapshot with blocks-derived state
    ensureDirs();
    const snap = readSnapshot();
    const calc = this.computeBlocksState();
    const snapBalances = snap?.balances || {};
    const calcBalances = calc?.balances || {};
    // Determine SYSTEM nonce
    const sysNonce = ((snap.accounts && snap.accounts['SYSTEM'] && snap.accounts['SYSTEM'].nonce) || 0);
    let nextSysNonce = sysNonce;
    let enq = 0;
    const now = Date.now();
    const keys = new Set([...Object.keys(snapBalances), ...Object.keys(calcBalances)]);
    for (const k of keys) {
      const s = Number(snapBalances[k] || 0);
      const c = Number(calcBalances[k] || 0);
      const delta = s - c;
      if (delta > 0) {
        // Mint delta to k via SYSTEM with toPubkey in memo (base64)
        const toPubB64 = hexToB64(k);
        const tx = { type:'mint', from:'SYSTEM', to:null, amount: delta, nonce: (++nextSysNonce), memo:{ reason:'seed_backfill', toPubkey: toPubB64 }, pubkey:'', sig:'', ts: now };
        enqueueTx(tx);
        enq++;
      } else if (delta < 0) {
        // Optional: burn excess from k
        const amt = Math.abs(delta);
        const tx = { type:'burn', from: null, to: null, amount: amt, nonce: 0, memo:{ reason:'seed_backfill' }, pubkey: k, sig:'', ts: now };
        enqueueTx(tx);
        enq++;
      }
    }
    return { ok: true, enqueued: enq };
  },

};

function appendBundle(txList) {
  // Append a bundle of txs to mempool and return tracking info for waitUntilSealed/Applied
  ensureDirs();
  const beforeId = readSnapshot().lastId || 0;
  const ids = [];
  const bundleSize = (txList || []).length;
  
  for (const tx of (txList || [])) {
    enqueueTx(tx);
    // Track tx by op_id for sealing verification
    const opId = tx?.memo?.op_id || null;
    if (opId) ids.push(opId);
  }
  
  return { ids, lastIdBefore: beforeId, bundleSize };
}

async function waitUntilSealed({ ids, timeoutMs = null, pollMs = null }) {
  // Use ENV configs with fallbacks
  timeoutMs = timeoutMs || Number(process.env.VOLCHAIN_BARRIER_TIMEOUT_MS || 12000);
  pollMs = pollMs || Number(process.env.VOLCHAIN_BARRIER_POLL_MS || 50);
  // Wait until all txs with given op_ids are sealed into blocks
  const startTime = Date.now();
  let loops = 0;
  
  // If no IDs to wait for, return immediately
  if (!ids || ids.length === 0) {
    return { ok: true, wait_ms: 0, loops: 0, timed_out: false };
  }
  
  while (Date.now() - startTime < timeoutMs) {
    loops++;
    
    // Force seal pending in test/sandbox mode
    if (String(process.env.VOLCHAIN_SANDBOX||'') === '1') {
      try { produceOneBlock(1000); } catch {}
    }
    
    const snap = readSnapshot();
    const usedOpIds = snap.usedOpIds || {};
    const allSealed = ids.every(opId => usedOpIds[opId]);
    
    if (allSealed) {
      const waitMs = Date.now() - startTime;
      barrierWaitTotalMs += waitMs;
      return { ok: true, wait_ms: waitMs, loops, timed_out: false };
    }
    
    // Async sleep
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  
  const waitMs = Date.now() - startTime;
  barrierWaitTotalMs += waitMs;
  barrierTimeoutsTotal++;
  return { ok: false, wait_ms: waitMs, loops, timed_out: true };
}

async function waitUntilApplied({ bundleSize, timeoutMs = null, pollMs = null }) {
  // Use ENV configs with fallbacks  
  timeoutMs = timeoutMs || Number(process.env.VOLCHAIN_BARRIER_TIMEOUT_MS || 12000);
  pollMs = pollMs || Number(process.env.VOLCHAIN_BARRIER_POLL_MS || 50);
  // Wait until mempool is smaller (bundle processed) and snapshot updated
  const startTime = Date.now();
  let loops = 0;
  let sealTriggered = false;
  const initialMempoolSize = mempool.length;
  const expectedFinalSize = Math.max(0, initialMempoolSize - bundleSize);
  
  while (Date.now() - startTime < timeoutMs) {
    loops++;
    
    const currentMempoolSize = mempool.length;
    
    // Bundle is considered applied when mempool shrinks appropriately
    if (currentMempoolSize <= expectedFinalSize) {
      const waitMs = Date.now() - startTime;
      barrierWaitTotalMs += waitMs;
      return { ok: true, wait_ms: waitMs, loops, timed_out: false };
    }
    
    // Trigger seal once at halfway timeout if still waiting
    if (!sealTriggered && (Date.now() - startTime) > (timeoutMs / 2)) {
      sealTriggered = true;
      if (String(process.env.VOLCHAIN_SANDBOX||'') === '1') {
        try { produceOneBlock(1000); } catch {}
      }
    }
    
    // Async sleep
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  
  const waitMs = Date.now() - startTime;
  barrierWaitTotalMs += waitMs;
  barrierTimeoutsTotal++;
  return { ok: false, wait_ms: waitMs, loops, timed_out: true, 
           mempoolSize: mempool.length, expectedSize: expectedFinalSize };
}


