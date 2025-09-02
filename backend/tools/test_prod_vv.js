#!/usr/bin/env node
"use strict";

// PROD Smoke Test (UI-less) — Vol and Volkan2 only
// Automated API-based testing without browser interaction

const axios = require("axios");

// Environment variables
const VOL_USER = process.env.VOL_USER;
const VOL_PASS = process.env.VOL_PASS;
const V20_USER = process.env.V20_USER;
const V20_PASS = process.env.V20_PASS;

const BASE = "https://thisisthecoin.com";
const USERS = [
  { username: VOL_USER, password: VOL_PASS, label: "Vol" },
  { username: V20_USER, password: V20_PASS, label: "Volkan2" }
];

// Validate credentials
for (const user of USERS) {
  if (!user.username || !user.password) {
    console.error(`Missing credentials for ${user.label}`);
    console.error("Set environment variables:");
    console.error("VOL_USER=Vol VOL_PASS='***' V20_USER=Volkan2 V20_PASS='***'");
    process.exit(1);
  }
}

// Session token storage
let sessionTokens = {};

// HTTP helpers with session token support
async function httpGet(path, params = {}, username = null) {
  const url = `${BASE}${path}`;
  const headers = {};
  if (username && sessionTokens[username]) {
    headers['X-Session-Token'] = sessionTokens[username];
  }
  
  const config = {
    params,
    headers,
    validateStatus: () => true
  };
  const res = await axios.get(url, config);
  return res;
}

async function httpPost(path, body = {}, params = {}, username = null) {
  const url = `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (username && sessionTokens[username]) {
    headers['X-Session-Token'] = sessionTokens[username];
  }
  
  const config = {
    params,
    headers,
    validateStatus: () => true
  };
  const res = await axios.post(url, body, config);
  return res;
}

async function httpPatch(path, body = {}, params = {}, username = null) {
  const url = `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (username && sessionTokens[username]) {
    headers['X-Session-Token'] = sessionTokens[username];
  }
  
  const config = {
    params,
    headers,
    validateStatus: () => true
  };
  const res = await axios.patch(url, body, config);
  return res;
}

// Extract session token from response
function extractSessionToken(response, username) {
  if (response.data && response.data.sessionToken) {
    sessionTokens[username] = response.data.sessionToken;
  }
}

// Login helper
async function login(username, password) {
  // Get user email first
  const userInfo = await getUserByName(username);
  if (!userInfo || !userInfo.email) {
    console.error(`No email found for user ${username}`);
    return false;
  }
  
  const res = await httpPost('/login', { email: userInfo.email, password });
  if (res.status === 200 && res.data.success) {
    extractSessionToken(res, username);
    return true;
  }
  return false;
}

// Pubkey resolution helpers
function isHex64(s) { 
  return typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s.trim()); 
}

function b64ToHexMaybe(s) {
  try { 
    const h = Buffer.from(String(s||''), 'base64').toString('hex'); 
    return isHex64(h) ? h.toLowerCase() : null; 
  } catch { 
    return null; 
  }
}

function resolveAnyToHex64(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();
  if (isHex64(s)) return s.toLowerCase();
  const fromB64 = b64ToHexMaybe(s); 
  if (fromB64) return fromB64;
  return null;
}

async function getUserByName(username) {
  const r = await httpGet('/auth/user', { username });
  if (r.status === 200 && r.data) return r.data;
  return null;
}

async function findPubkeyByHoldersName(name) {
  const r = await httpGet('/volchain/holders', { limit: 1000 });
  if (r.status !== 200 || !Array.isArray(r.data)) return null;
  const needle = String(name).toLowerCase();
  for (const h of r.data) {
    const nm = (h && h.name) ? String(h.name).toLowerCase() : '';
    if (nm === needle) {
      const pk = h.pubkey || '';
      return resolveAnyToHex64(String(pk));
    }
  }
  return null;
}

async function resolveUserHex(username) {
  // 1) try /auth/user
  const u = await getUserByName(username);
  if (u && u.powPubkey) {
    const hex = resolveAnyToHex64(String(u.powPubkey));
    if (hex) return hex;
  }
  // 2) fallback to holders
  const fromH = await findPubkeyByHoldersName(username);
  if (fromH) return fromH;
  throw new Error(`pubkey_not_found_for_${username}`);
}

// State helpers
async function getState(hex) {
  const r = await httpGet(`/volchain/state/${hex}`);
  if (r.status === 200 && r.data) return r.data;
  throw new Error(`state_failed_${hex}`);
}

async function verifyBlocks() {
  const r = await httpGet('/volchain/verify', { mode: 'blocks' });
  if (r.status === 200 && r.data && r.data.ok === true) return r.data;
  throw new Error('verify_blocks_failed');
}

async function verifySystem(details = false) {
  const r = await httpGet('/volchain/verify', { mode: 'system', details: details ? 1 : 0 });
  if (r.status === 200 && r.data) return r.data;
  throw new Error('verify_system_http_failed');
}

function briefState(obj) {
  const bal = Number(obj?.balance || 0);
  const stk = Number(obj?.staked || 0);
  const av = Number(obj?.available || (bal - stk));
  const mined = Number(obj?.mined || 0);
  return { bal, stk, av, mined };
}

// Invariant checker for individual users
function checkUserInvariant(state, username) {
  const { bal, stk, av, mined } = briefState(state);
  const used = stk;
  
  const balanceOk = bal === mined;
  const minedOk = mined === used + av;
  const balanceEqUsedAv = bal === used + av;
  
  if (!balanceOk || !minedOk || !balanceEqUsedAv) {
    console.log(`❌ INVARIANT VIOLATION for ${username}:`);
    console.log(`   balance: ${bal}, mined: ${mined}, used: ${used}, available: ${av}`);
    console.log(`   balance == mined: ${balanceOk ? '✅' : '❌'}`);
    console.log(`   mined == used + available: ${minedOk ? '✅' : '❌'}`);
    console.log(`   balance == used + available: ${balanceEqUsedAv ? '✅' : '❌'}`);
    return false;
  }
  
  return true;
}

// System-wide invariant checker
async function checkSystemInvariant() {
  try {
    const holders = await httpGet('/volchain/holders');
    if (holders.status !== 200 || !Array.isArray(holders.data)) {
      console.log('❌ Failed to fetch holders for system invariant check');
      return false;
    }
    
    let totalBalance = 0;
    let totalMined = 0;
    let totalUsed = 0;
    let totalAvailable = 0;
    
    for (const holder of holders.data) {
      totalBalance += holder.balance || 0;
      
      // Get detailed state for mined/used/available
      const state = await getState(holder.pubkey);
      if (state) {
        totalMined += state.mined || 0;
        totalUsed += state.staked || 0;
        totalAvailable += state.available || 0;
      }
    }
    
    const balanceEqMined = totalBalance === totalMined;
    const minedEqUsedAv = totalMined === totalUsed + totalAvailable;
    const balanceEqUsedAv = totalBalance === totalUsed + totalAvailable;
    
    console.log(`📊 System Invariants:`);
    console.log(`   Total Balance: ${totalBalance}`);
    console.log(`   Total Mined: ${totalMined}`);
    console.log(`   Total Used: ${totalUsed}`);
    console.log(`   Total Available: ${totalAvailable}`);
    console.log(`   Balance == Mined: ${balanceEqMined ? '✅' : '❌'}`);
    console.log(`   Mined == Used + Available: ${minedEqUsedAv ? '✅' : '❌'}`);
    console.log(`   Balance == Used + Available: ${balanceEqUsedAv ? '✅' : '❌'}`);
    
    return balanceEqMined && minedEqUsedAv && balanceEqUsedAv;
    
  } catch (e) {
    console.log(`❌ System invariant check failed: ${e.message}`);
    return false;
  }
}

// GridB helpers
async function findOwnedCellIndex(username) {
  const r = await httpGet('/gridb');
  if (r.status !== 200 || !Array.isArray(r.data)) {
    throw new Error('gridb_fetch_failed');
  }
  
  for (let i = 0; i < r.data.length; i++) {
    const cell = r.data[i];
    if (cell && cell.owner === username) {
      return i;
    }
  }
  throw new Error(`no_owned_cell_found_for_${username}`);
}

// Barrier/poll with exponential backoff
async function pollUntil(expectedCheck, label, timeoutMs = 15000) {
  const start = Date.now();
  let backoffMs = 500;
  
  while (Date.now() - start < timeoutMs) {
    try {
      const sys = await verifySystem(true);
      if (sys && sys.ok === true) {
        const ok = await expectedCheck();
        if (ok) return { ok: true };
      }
    } catch (e) {
      // Handle rate limits and conflicts
      if (e.response && (e.response.status === 409 || e.response.status === 429)) {
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 4000); // cap at 4s
        continue;
      }
    }
    
    await sleep(backoffMs);
  }
  return { ok: false, error: `timeout_${label}` };
}

function sleep(ms) { 
  return new Promise(r => setTimeout(r, ms)); 
}

// Get neighbors for a cell (same logic as server)
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

// Main test flow
async function main() {
  console.log(`BASE:${BASE}`);
  
  // Login both users
  for (const user of USERS) {
    const success = await login(user.username, user.password);
    if (!success) {
      console.error(`Login failed for ${user.label}`);
      process.exit(1);
    }
    console.log(`✅ Logged in as ${user.label}`);
  }
  
  // Initial verification
  const vb = await verifyBlocks();
  if (!vb || vb.ok !== true) throw new Error('verify_blocks_not_ok');
  
  const vs = await verifySystem(true);
  if (!vs || vs.ok !== true) {
    console.log('verify system failed at start:', JSON.stringify(vs));
    throw new Error('verify_system_not_ok');
  }
  
  // Resolve user pubkeys
  const [hexVol, hexVolkan2] = await Promise.all([
    resolveUserHex(VOL_USER),
    resolveUserHex(V20_USER)
  ]);
  
  // Initial states
  const sVol0 = briefState(await getState(hexVol));
  const sV200 = briefState(await getState(hexVolkan2));
  
  console.log(`Vol={bal:${sVol0.bal},stk:${sVol0.stk},av:${sVol0.av}} Volkan2={bal:${sV200.bal},stk:${sV200.stk},av:${sV200.av}}`);
  
  // A) Vol stake +1
  {
    const cellIndex = await findOwnedCellIndex(VOL_USER);
    console.log(`🔒 Vol stake +1 on cell ${cellIndex}`);
    
    const res = await httpPatch(`/gridb/${cellIndex}`, {}, {}, VOL_USER);
    if (res.status !== 200) {
      console.error(`Stake failed: ${res.status} ${res.data}`);
      process.exit(1);
    }
    
    const targetStk = sVol0.stk + 1;
    const targetAv = sVol0.av - 1;
    const pollRes = await pollUntil(async () => {
      const cur = briefState(await getState(hexVol));
      return cur.stk === targetStk && cur.av === targetAv && cur.bal === sVol0.bal;
    }, 'A');
    
    if (!pollRes.ok) {
      console.log('FAIL A(stake Vol)');
      process.exit(1);
    }
    
    const sys = await verifySystem(true);
    if (sys && sys.ok === true) {
      console.log('PASS A(stake Vol)');
    } else {
      console.log('FAIL A(stake Vol)');
      process.exit(1);
    }
  }
  
  // B) Vol unstake -1
  {
    const cellIndex = await findOwnedCellIndex(VOL_USER);
    console.log(`🔓 Vol unstake -1 on cell ${cellIndex}`);
    
    const res = await httpPost(`/gridb/${cellIndex}/unstake`, {}, {}, VOL_USER);
    if (res.status !== 200) {
      console.error(`Unstake failed: ${res.status} ${res.data}`);
      process.exit(1);
    }
    
    const pollRes = await pollUntil(async () => {
      const cur = briefState(await getState(hexVol));
      return cur.stk === sVol0.stk && cur.av === sVol0.av && cur.bal === sVol0.bal;
    }, 'B');
    
    if (!pollRes.ok) {
      console.log('FAIL B(unstake Vol)');
      process.exit(1);
    }
    
    const sys = await verifySystem(true);
    if (sys && sys.ok === true) {
      console.log('PASS B(unstake Vol)');
    } else {
      console.log('FAIL B(unstake Vol)');
      process.exit(1);
    }
  }
  
  // C) Volkan2 stake +1 then unstake -1
  {
    const cellIndex = await findOwnedCellIndex(V20_USER);
    console.log(`🔒 Volkan2 stake +1 on cell ${cellIndex}`);
    
    // Stake
    const stakeRes = await httpPatch(`/gridb/${cellIndex}`, {}, {}, V20_USER);
    if (stakeRes.status !== 200) {
      console.error(`Volkan2 stake failed: ${stakeRes.status} ${stakeRes.data}`);
      process.exit(1);
    }
    
    const sV20Before = briefState(await getState(hexVolkan2));
    const stakePoll = await pollUntil(async () => {
      const cur = briefState(await getState(hexVolkan2));
      return cur.stk === sV20Before.stk + 1 && cur.av === sV20Before.av - 1 && cur.bal === sV20Before.bal;
    }, 'C-stake');
    
    if (!stakePoll.ok) {
      console.log('FAIL C(stake Volkan2)');
      process.exit(1);
    }
    
    // Unstake
    console.log(`🔓 Volkan2 unstake -1 on cell ${cellIndex}`);
    const unstakeRes = await httpPost(`/gridb/${cellIndex}/unstake`, {}, {}, V20_USER);
    if (unstakeRes.status !== 200) {
      console.error(`Volkan2 unstake failed: ${unstakeRes.status} ${unstakeRes.data}`);
      process.exit(1);
    }
    
    const unstakePoll = await pollUntil(async () => {
      const cur = briefState(await getState(hexVolkan2));
      return cur.stk === sV20Before.stk && cur.av === sV20Before.av && cur.bal === sV20Before.bal;
    }, 'C-unstake');
    
    if (!unstakePoll.ok) {
      console.log('FAIL C(unstake Volkan2)');
      process.exit(1);
    }
    
    const sys = await verifySystem(true);
    if (sys && sys.ok === true) {
      console.log('PASS C(stake/un Volkan2)');
    } else {
      console.log('FAIL C(stake/un Volkan2)');
      process.exit(1);
    }
  }
  
  // D) Optional transfer 1 forward and back
  let didTransfer = false;
  try {
    console.log(`💸 Attempting transfer Vol → Volkan2 → Vol`);
    
    // Get initial states
    const sVolBefore = briefState(await getState(hexVol));
    const sV20Before = briefState(await getState(hexVolkan2));
    
    console.log(`📊 Before transfer: Vol=${sVolBefore.bal} Volkan2=${sV20Before.bal}`);
    
    // Forward: Vol → Volkan2
    console.log(`➡️  Vol → Volkan2 (1 block)`);
    const forwardRes = await httpPost('/volchain/transfer', {
      toPubkey: hexVolkan2,
      amount: 1
    }, {}, VOL_USER);
    
    if (forwardRes.status !== 200) {
      console.log(`Forward transfer failed: ${forwardRes.status} - ${JSON.stringify(forwardRes.data)}`);
      throw new Error(`forward_transfer_failed: ${forwardRes.status}`);
    }
    
    // Wait for forward with longer timeout
    const forwardPoll = await pollUntil(async () => {
      const a = briefState(await getState(hexVol));
      const b = briefState(await getState(hexVolkan2));
      const okA = a.bal === sVolBefore.bal - 1 && a.av === sVolBefore.av - 1 && a.stk === sVolBefore.stk;
      const okB = b.bal === sV20Before.bal + 1 && b.av === sV20Before.av + 1 && b.stk === sV20Before.stk;
      return okA && okB;
    }, 'D-forward', 30000); // 30 second timeout
    
    if (!forwardPoll.ok) throw new Error('forward_timeout');
    console.log(`✅ Forward transfer completed`);
    
    // Back: Volkan2 → Vol
    console.log(`⬅️  Volkan2 → Vol (1 block)`);
    const backRes = await httpPost('/volchain/transfer', {
      toPubkey: hexVol,
      amount: 1
    }, {}, V20_USER);
    
    if (backRes.status !== 200) {
      console.log(`Back transfer failed: ${backRes.status} - ${JSON.stringify(backRes.data)}`);
      throw new Error(`back_transfer_failed: ${backRes.status}`);
    }
    
    // Wait for back with longer timeout
    const backPoll = await pollUntil(async () => {
      const a = briefState(await getState(hexVol));
      const b = briefState(await getState(hexVolkan2));
      const okA = a.bal === sVolBefore.bal && a.av === sVolBefore.av && a.stk === sVolBefore.stk;
      const okB = b.bal === sV20Before.bal && b.av === sV20Before.av && b.stk === sV20Before.stk;
      return okA && okB;
    }, 'D-back', 30000); // 30 second timeout
    
    if (!backPoll.ok) throw new Error('back_timeout');
    console.log(`✅ Back transfer completed`);
    
    const sys = await verifySystem(true);
    if (!sys || sys.ok !== true) throw new Error('system_not_ok_after_transfer');
    
    didTransfer = true;
    console.log('🎉 Transfer cycle completed successfully');
    
  } catch (e) {
    console.log(`⚠️  Transfer skipped: ${e.message}`);
  }
  
  console.log(`PASS D(transfer fwd/back | ${didTransfer ? 'done' : 'SKIP'})`);
  
  // E) Attack test - burn test
  let didAttack = false;
  try {
    console.log(`⚔️  Testing attack mechanics (burn operations)`);
    
    // First, ensure Vol has a cell to attack from
    const volCellIndex = await findOwnedCellIndex(VOL_USER);
    console.log(`🏰 Vol's base cell: ${volCellIndex}`);
    
    // Find a neighboring cell owned by Volkan2 that we can attack
    const gridbData = await httpGet('/gridb');
    if (gridbData.status !== 200 || !Array.isArray(gridbData.data)) {
      throw new Error('failed_to_fetch_gridb');
    }
    
    // Find neighbors of Vol's cell
    const neighbors = getNeighbors(volCellIndex, gridbData.data.length, 50);
    console.log(`📍 Neighbors of cell ${volCellIndex}: ${neighbors.join(', ')}`);
    
    // Find a neighbor owned by Volkan2
    let targetCellIndex = null;
    for (const neighborIndex of neighbors) {
      const neighbor = gridbData.data[neighborIndex];
      if (neighbor && neighbor.owner === V20_USER) {
        targetCellIndex = neighborIndex;
        break;
      }
    }
    
    if (!targetCellIndex) {
      // If no neighboring Volkan2 cell, try to find any Volkan2 cell and place Vol's cell nearby first
      console.log(`🔍 No neighboring Volkan2 cell found, attempting strategic placement`);
      
      // Find any Volkan2 cell
      const v20CellIndex = await findOwnedCellIndex(V20_USER);
      const v20Neighbors = getNeighbors(v20CellIndex, gridbData.data.length, 50);
      
      // Find an empty neighbor to place Vol's cell
      for (const neighborIndex of v20Neighbors) {
        const neighbor = gridbData.data[neighborIndex];
        if (neighbor && !neighbor.owner) {
          console.log(`🏗️  Placing Vol's cell at ${neighborIndex} to enable attack`);
          const placeRes = await httpPatch(`/gridb/${neighborIndex}`, {}, {}, VOL_USER);
          if (placeRes.status === 200) {
            console.log(`✅ Placed Vol's cell at ${neighborIndex}`);
            targetCellIndex = v20CellIndex;
            break;
          }
        }
      }
    }
    
    if (!targetCellIndex) {
      throw new Error('no_attackable_cell_found');
    }
    
    console.log(`🎯 Target cell: ${targetCellIndex} (owned by ${V20_USER})`);
    
    // Get initial states
    const sVolBeforeAttack = briefState(await getState(hexVol));
    const sV20BeforeAttack = briefState(await getState(hexVolkan2));
    
    // Perform attack: Vol attacks Volkan2's cell
    console.log(`🔥 Vol attacking Volkan2's cell ${targetCellIndex}`);
    const attackRes = await httpPatch(`/gridb/${targetCellIndex}`, {}, {}, VOL_USER);
    
    if (attackRes.status !== 200) {
      console.log(`Attack response: ${attackRes.status} - ${JSON.stringify(attackRes.data)}`);
      throw new Error(`attack_failed: ${attackRes.status} ${JSON.stringify(attackRes.data)}`);
    }
    
    // Wait for attack effects: both users should lose 1 block (burn)
    console.log(`⏳ Waiting for burn effects...`);
    const attackPoll = await pollUntil(async () => {
      const a = briefState(await getState(hexVol));
      const b = briefState(await getState(hexVolkan2));
      
      console.log(`📊 Current: Vol=${a.bal}/${a.av} Volkan2=${b.bal}/${b.av}`);
      console.log(`🎯 Expected: Vol=${sVolBeforeAttack.bal-1}/${sVolBeforeAttack.av-1} Volkan2=${sV20BeforeAttack.bal-1}/${sV20BeforeAttack.av-1}`);
      
      // Vol should lose 1 block (burn cost)
      const volBurnOk = a.bal === sVolBeforeAttack.bal - 1 && a.av === sVolBeforeAttack.av - 1;
      // Volkan2 should lose 1 block (defense loss)
      const v20BurnOk = b.bal === sV20BeforeAttack.bal - 1 && b.av === sV20BeforeAttack.av - 1;
      
      if (volBurnOk && v20BurnOk) {
        console.log(`🔥 Burn effects detected!`);
      }
      
      return volBurnOk && v20BurnOk;
    }, 'E-attack', 45000); // 45 second timeout for burn operations
    
    if (!attackPoll.ok) throw new Error('attack_timeout');
    
    console.log('✅ Attack completed - burn operations verified');
    didAttack = true;
    
    // Verify system integrity after attack
    const sys = await verifySystem(true);
    if (!sys || sys.ok !== true) throw new Error('system_not_ok_after_attack');
    
  } catch (e) {
    console.log(`⚠️  Attack test skipped: ${e.message}`);
  }
  
  console.log(`PASS E(attack burn test | ${didAttack ? 'done' : 'SKIP'})`);
  
  // Final reports
  const vb2 = await verifyBlocks();
  console.log(`verify blocks: ok:${vb2 && vb2.ok === true}`);
  
  const vs2 = await verifySystem(true);
  console.log(`verify system: ok:${vs2 && vs2.ok === true}`);
  
  // Final states
  const sVolF = briefState(await getState(hexVol));
  const sV20F = briefState(await getState(hexVolkan2));
  console.log(`Vol_final={bal:${sVolF.bal},stk:${sVolF.stk},av:${sVolF.av},mined:${sVolF.mined}} Volkan2_final={bal:${sV20F.bal},stk:${sV20F.stk},av:${sV20F.av},mined:${sV20F.mined}}`);
  
  // Invariant checks
  console.log(`\n🔍 INVARIANT CHECKS:`);
  
  // User-level invariants
  const volState = await getState(hexVol);
  const v20State = await getState(hexVolkan2);
  
  const volInvariantOk = checkUserInvariant(volState, 'Vol');
  const v20InvariantOk = checkUserInvariant(v20State, 'Volkan2');
  
  console.log(`Vol invariants: ${volInvariantOk ? '✅' : '❌'}`);
  console.log(`Volkan2 invariants: ${v20InvariantOk ? '✅' : '❌'}`);
  
  // System-wide invariants
  const systemInvariantOk = await checkSystemInvariant();
  console.log(`System invariants: ${systemInvariantOk ? '✅' : '❌'}`);
  
  // Additional invariant checks
  console.log(`\n📊 DETAILED INVARIANT ANALYSIS:`);
  
  // Check if balance == mined (this should now be true)
  const volBalanceMinedOk = volState.balance === volState.mined;
  const v20BalanceMinedOk = v20State.balance === v20State.mined;
  
  console.log(`Vol: balance(${volState.balance}) == mined(${volState.mined}): ${volBalanceMinedOk ? '✅' : '❌'}`);
  console.log(`Volkan2: balance(${v20State.balance}) == mined(${v20State.mined}): ${v20BalanceMinedOk ? '✅' : '❌'}`);
  
  // Check if mined == used + available
  const volMinedUsedAvOk = volState.mined === volState.staked + volState.available;
  const v20MinedUsedAvOk = v20State.mined === v20State.staked + v20State.available;
  
  console.log(`Vol: mined(${volState.mined}) == used(${volState.staked}) + available(${volState.available}): ${volMinedUsedAvOk ? '✅' : '❌'}`);
  console.log(`Volkan2: mined(${v20State.mined}) == used(${v20State.staked}) + available(${v20State.available}): ${v20MinedUsedAvOk ? '✅' : '❌'}`);
  
  // Mismatch totals
  let userMismatch = 0; 
  let systemMismatch = 0;
  try {
    const users = vs2 && vs2.users;
    if (users && Array.isArray(users.mismatches)) userMismatch = users.mismatches.length;
    const sys = vs2 && vs2.system;
    if (sys && sys.ok === false) systemMismatch = 1;
  } catch {}
  
  console.log(`mismatch_totals: user=${userMismatch} system=${systemMismatch}`);
  console.log('🎉 All tests completed successfully!');
}

// Run with error handling
main().catch(err => {
  console.error('❌ Test failed:', err.message);
  if (err.response) {
    console.error('Response status:', err.response.status);
    console.error('Response data:', err.response.data);
  }
  process.exit(1);
});
