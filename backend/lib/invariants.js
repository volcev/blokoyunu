const fs = require('fs');
const path = require('path');
const { readDB, writeDB } = require('./db');
const { readGridB } = require('./gridb');
const { readAccounts, writeAccounts, readStats, writeStats } = (() => {
  // Inline lightweight accessors from server context
  const ACCOUNTS_FILE = path.join(__dirname, '..', 'accounts.json');
  const STATS_FILE = path.join(__dirname, '..', 'stats.json');
  function readJsonSafe(filePath, fallback){ try { return JSON.parse(fs.readFileSync(filePath,'utf8')); } catch { return fallback; } }
  return {
    readAccounts: () => readJsonSafe(ACCOUNTS_FILE, []),
    writeAccounts: (arr) => fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(arr, null, 2)),
    readStats: () => readJsonSafe(STATS_FILE, { next_mined_seq: 1, total_supply: 0 }),
    writeStats: (obj) => fs.writeFileSync(STATS_FILE, JSON.stringify(obj, null, 2)),
  };
})();

function resolveUsernameToPubkey(username, users) {
  if (!users) return null;
  const normalizedUsername = String(username).toLowerCase();
  const user = users.find(u => u && u.username && String(u.username).toLowerCase() === normalizedUsername);
  if (user && user.powPubkey && /^[0-9a-fA-F]{64}$/.test(String(user.powPubkey))) return String(user.powPubkey).toLowerCase();
  return null;
}

function calculateUserMined(pubkey, db) {
  if (!db.grid || !Array.isArray(db.grid)) return 0;
  let minedCount = 0;
  const targetPubkey = String(pubkey).toLowerCase();
  for (const block of db.grid) {
    if (block && block.dugBy) {
      const resolvedPubkey = resolveUsernameToPubkey(block.dugBy, db.users);
      if (resolvedPubkey && String(resolvedPubkey).toLowerCase() === targetPubkey) minedCount++;
    }
  }
  return minedCount;
}

function enforceInvariants(snapshot, db, gridb) {
  const issues = [];
  try {
    const totalSupply = Object.values(snapshot.balances || {}).reduce((sum, b) => sum + (Number(b) || 0), 0);
    const totalMined = (db.grid || []).filter(b => b && b.dugBy).length;
    const totalStaked = Object.values(snapshot.staked || {}).reduce((sum, s) => sum + (Number(s) || 0), 0);
    const totalAvailable = totalSupply - totalStaked;
    if (totalSupply !== totalMined) issues.push(`SYSTEM_SUPPLY_MINED: ${totalSupply} ≠ ${totalMined}`);
    for (const [pubkey, balance] of Object.entries(snapshot.balances || {})) {
      const staked = Number(snapshot.staked[pubkey] || 0);
      const available = Number(balance) - staked;
      const mined = calculateUserMined(pubkey, db);
      if (Number(balance) !== mined) issues.push(`USER_BALANCE_MINED:${pubkey.slice(0,8)}: ${balance} ≠ ${mined}`);
      if (Number(balance) !== staked + available) issues.push(`USER_BALANCE_CALC:${pubkey.slice(0,8)}: ${balance} ≠ ${staked} + ${available}`);
    }
    const totalUsed = Object.values(snapshot.staked || {}).reduce((sum, s) => sum + (Number(s) || 0), 0);
    const totalUserBalances = Object.values(snapshot.balances || {}).reduce((sum, b) => sum + (Number(b) || 0), 0);
    if (totalUserBalances !== totalUsed + totalAvailable) issues.push(`SYSTEM_TOTAL_CALC: ${totalUserBalances} ≠ ${totalUsed} + ${totalAvailable}`);
  } catch (error) {
    issues.push(`INVARIANT_CHECK_ERROR: ${error.message}`);
  }
  return issues;
}

async function autoCorrectInvariants(snapshot, db, gridb) {
  try {
    // 1) Recompute per-user mined counts strictly from Digzone grid using current user->pubkey associations
    const minedCounts = {};
    for (const block of (db.grid || [])) {
      if (block && block.dugBy) {
        const pubkey = resolveUsernameToPubkey(block.dugBy, db.users);
        if (pubkey) minedCounts[pubkey] = (minedCounts[pubkey] || 0) + 1;
      }
    }

    // 2) Build a corrected snapshot: balances = minedCounts; clamp staked <= balance; recalc supply
    const correctedSnapshot = JSON.parse(JSON.stringify(snapshot || {}));
    correctedSnapshot.balances = {};
    correctedSnapshot.staked = correctedSnapshot.staked || {};
    correctedSnapshot.accounts = correctedSnapshot.accounts || {};

    for (const [pk, mined] of Object.entries(minedCounts)) {
      const bal = Math.max(0, Math.floor(Number(mined) || 0));
      correctedSnapshot.balances[pk] = bal;
      const st = Math.max(0, Math.floor(Number(correctedSnapshot.staked[pk] || 0)));
      if (st > bal) correctedSnapshot.staked[pk] = bal; // clamp used to balance
      // ensure account object exists
      if (!correctedSnapshot.accounts[pk]) correctedSnapshot.accounts[pk] = { nonce: 0 };
    }

    // Remove any staked entries for users no longer having balance
    for (const pk of Object.keys(correctedSnapshot.staked)) {
      if (!Object.prototype.hasOwnProperty.call(correctedSnapshot.balances, pk)) {
        // If there is stake but no balance, zero it out (can't have used > 0 with mined = 0)
        correctedSnapshot.staked[pk] = 0;
      }
    }

    // Recompute supply as sum of balances
    try {
      const supply = Object.values(correctedSnapshot.balances).reduce((sum, v) => sum + (Number(v) || 0), 0);
      correctedSnapshot.supply = supply;
    } catch {}

    // 3) Persist corrected snapshot atomically
    try {
      const dataDir = process.env.VOLCHAIN_DIR || path.join(__dirname, '..', 'volchain');
      const SNAPSHOT_FILE = path.join(dataDir, 'snapshot.json');
      const tmp = SNAPSHOT_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(correctedSnapshot, null, 2));
      fs.renameSync(tmp, SNAPSHOT_FILE);
    } catch {}

    // 4) Optionally maintain auxiliary human-readable accounts file
    try {
      const accounts = readAccounts();
      for (const [pubkey, balance] of Object.entries(correctedSnapshot.balances)) {
        const staked = Number(correctedSnapshot.staked[pubkey] || 0);
        const mined = Number(balance);
        const available = Math.max(0, mined - staked);
        let account = accounts.find(a => a.username && resolveUsernameToPubkey(a.username, db.users) === pubkey);
        if (!account) {
          const username = (db.users || []).find(u => u && u.powPubkey === pubkey)?.username;
          if (username) { account = { username, balance: mined, used: staked, available }; accounts.push(account); }
        } else {
          account.balance = mined;
          account.used = Math.min(staked, mined);
          account.available = mined - account.used;
        }
      }
      writeAccounts(accounts);
    } catch {}

    // 5) Final verification on corrected snapshot object
    const finalCheck = enforceInvariants(correctedSnapshot, db, gridb);
    return finalCheck.length === 0;
  } catch (error) {
    return false;
  }
}

function updateUserBalancesFile() {
  try {
    const filePath = path.join(__dirname, '..', 'user_balances.json');
    const volchain = require('../volchain_chain.js');
    const holders = JSON.parse(require('child_process').execSync('curl -s http://localhost:3001/volchain/holders', { encoding: 'utf8' }));
    let totalBalance = 0, totalStaked = 0, totalAvailable = 0, activeStakers = 0;
    const users = holders.map(user => {
      try {
        const stateData = JSON.parse(require('child_process').execSync(`curl -s http://localhost:3001/volchain/state/${user.pubkey}`, { encoding: 'utf8' }));
        totalBalance += stateData.balance || 0;
        totalStaked += stateData.staked || 0;
        totalAvailable += stateData.available || 0;
        if ((stateData.staked || 0) > 0) activeStakers++;
        return { name: user.name, pubkey: user.pubkey, balance: stateData.balance || 0, staked: stateData.staked || 0, available: stateData.available || 0, stake_ratio: stateData.balance > 0 ? (stateData.staked || 0) / stateData.balance : 0, balance_ratio: 0 };
      } catch { return null; }
    }).filter(Boolean);
    users.forEach(user => { user.balance_ratio = totalBalance > 0 ? user.balance / totalBalance : 0; });
    const userBalancesData = { timestamp: new Date().toISOString(), source: 'volchain_sot_auto', total_users: users.length, total_balance: totalBalance, total_staked: totalStaked, total_available: totalAvailable, active_stakers: activeStakers, users };
    const tempFile = filePath + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(userBalancesData, null, 2));
    fs.renameSync(tempFile, filePath);
  } catch {}
}

module.exports = { enforceInvariants, autoCorrectInvariants, calculateUserMined, resolveUsernameToPubkey, updateUserBalancesFile };


