const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
// Removed Solana/Anchor dependencies
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { readSessions, writeSessions } = require('./auth.js');

const app = express();
const PORT = 3001;

// Session management (now persistent via auth.js)
const DB_FILE = path.join(__dirname, 'db.json');

// Helper function to validate session via auth server
async function validateSession(sessionToken) {
  try {
    const response = await axios.post('http://localhost:3002/validate-session', { sessionToken });
    if (response.data && response.data.valid) {
      return response.data.username;
    }
    return null;
  } catch (error) {
    console.error('[validateSession] Axios request failed:', error.message);
    return null;
  }
}



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

// Compute stats locally (Solana removed)
function computeLocalStats(username = null) {
  const data = readDB();
  const totalBlocks = data.grid.length;
  const minedBlocks = data.grid.filter(b => b.dugBy).length;

  const playerCounts = {};
  data.grid.forEach(block => {
    if (block.dugBy) {
      playerCounts[block.dugBy] = (playerCounts[block.dugBy] || 0) + 1;
    }
  });

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
    if (user && user.lastDigDate === today) {
      remainingMines = Math.max(0, 12 - (user.dailyDigCount || 0));
    }
    currentUserStats = {
      username,
      totalBlocks: playerCounts[username] || 0,
      remainingMines,
      color: user ? user.color : '#888'
    };
  }

  return {
    totalBlocks,
    minedBlocks,
    emptyBlocks: totalBlocks - minedBlocks,
    topMiners,
    currentUser: currentUserStats,
    totalBlocksMined: minedBlocks,
    gridExpansions: Math.floor(totalBlocks / 100) - 1
  };
}

app.use(cors());
app.use(express.json());

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (error) {
    return { grid: [], users: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const GRIDB_FILE = path.join(__dirname, 'gridb.json');
function readGridB(totalBlocks) {
  try {
    const arr = JSON.parse(fs.readFileSync(GRIDB_FILE, 'utf8'));
    // If the file has fewer blocks, add the remaining as empty
    if (arr.length < totalBlocks) {
      for (let i = arr.length; i < totalBlocks; i++) {
        arr.push({ index: i, owner: null, color: null, visual: null, userBlockIndex: null });
      }
      fs.writeFileSync(GRIDB_FILE, JSON.stringify(arr, null, 2));
    }
    return arr;
  } catch (e) {
    // If the file does not exist or is corrupted, create from scratch
    const arr = Array.from({ length: readDB().grid.length }, (_, i) => ({ index: i, owner: null, color: null, visual: null, userBlockIndex: null }));
    fs.writeFileSync(GRIDB_FILE, JSON.stringify(arr, null, 2));
    return arr;
  }
}
function writeGridB(arr) {
  fs.writeFileSync(GRIDB_FILE, JSON.stringify(arr, null, 2));
}

app.get('/grid', (req, res) => {
  const data = readDB();
  res.json(data.grid);
});

app.patch('/grid/:index', async (req, res) => {
  const sessionToken = req.headers['x-session-token'];
  if (!sessionToken) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing session token' });
  }
  const username = await validateSession(sessionToken);
  if (!username) {
    return res.status(401).json({ error: 'Unauthorized: Invalid session token' });
  }

  const index = parseInt(req.params.index);
  const { visual } = req.body;
  const data = readDB();
  const block = data.grid[index];
  if (!block) {
    return res.status(404).json({ error: 'Block not found' });
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
  if (user.lastDigDate !== today) {
    user.lastDigDate = today;
    user.dailyDigCount = 0;
    
    // --- CASTLE BONUS: Auto-mining for 10-defense blocks ---
    try {
      const gridb = readGridB(data.grid.length);
      const castleCount = gridb.filter(b => 
        b.owner === username && b.defense >= 10
      ).length;
      
      // Auto-mine blocks equal to castle count
      for (let i = 0; i < castleCount; i++) {
        const emptyBlock = data.grid.find(b => !b.dugBy);
        if (emptyBlock) {
          emptyBlock.dugBy = username;
        }
      }
      
      if (castleCount > 0) {
        console.log(`🏰 Castle bonus: ${username} auto-mined ${castleCount} blocks`);
        // Also mint Volore on Volchain for castle auto-mined blocks
        try {
          const userRecord = data.users.find(u => u.username === username);
          if (userRecord && userRecord.powPubkey) {
            // Reconcile instead of incremental add
            reconcileUserBalanceWithGrid(data, username);
            appendVolchainEvent({ type: 'mint', reason: 'castle_bonus', username, pubkey: userRecord.powPubkey, amount: castleCount });
          }
        } catch (e) {
          console.log('Castle bonus mint error:', e.message);
        }
      }
    } catch (error) {
      console.log('Castle bonus error:', error.message);
    }
    // --- END CASTLE BONUS ---
  }
  if (user.dailyDigCount === undefined) user.dailyDigCount = 0;
  if (user.dailyDigCount >= 12) {
    return res.status(429).json({ error: 'Daily mining limit reached' });
  }
  user.dailyDigCount++;
  // --- SONU ---

  block.dugBy = username;
  block.visual = visual || null;
  writeDB(data);

  // Mint 1 Volore coin on Volchain for this successful dig (increment balance by 1)
  try {
    // Reconcile after dig: balance = total dug blocks
    reconcileUserBalanceWithGrid(data, username);
    const userRecord = data.users.find(u => u.username === username);
    if (userRecord && userRecord.powPubkey) {
      appendVolchainEvent({ type: 'mint', reason: 'dig', username, pubkey: userRecord.powPubkey, amount: 1, gridIndex: index });
    }
  } catch (e) {
    console.error('volchain mint error:', e.message);
  }

  // On-chain stats removed

  res.json({ success: true });
});

app.post('/expand', (req, res) => {
  const data = readDB();
  const currentLength = data.grid.length;
  const newBlocks = [];
  for (let i = 0; i < 100; i++) {
    newBlocks.push({ index: currentLength + i, dugBy: null, color: null, visual: null });
  }
  data.grid = data.grid.concat(newBlocks);
  writeDB(data);
  res.json({ added: 100, total: data.grid.length });
});

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

// Volchain stats: Volore balances and top holders
app.get('/stats/volchain', (req, res) => {
  try {
    const username = req.query.username;
    const grid = computeLocalStats(username || null);
    const db = readDB();
    // Enforce invariant on-the-fly before reporting
    reconcileAllBalancesWithGrid(db);
    const accounts = readAccounts();

    // Map powPubkey -> user (for labeling)
    const pubToUser = {};
    for (const u of db.users) {
      if (u.powPubkey) pubToUser[u.powPubkey] = u;
    }

    // Aggregate totals and prepare holders
    let totalSupply = 0;
    const holders = Object.entries(accounts).map(([pubkey, info]) => {
      const balance = (info && typeof info.balance === 'number') ? info.balance : 0;
      totalSupply += balance;
      const user = pubToUser[pubkey];
      return {
        pubkey,
        balance,
        name: user ? user.username : pubkey.slice(0, 8),
        color: user && user.color ? user.color : '#888'
      };
    }).sort((a, b) => b.balance - a.balance);

    // Current user info
    let currentUser = null;
    if (username) {
      const user = db.users.find(u => u.username === username);
      const pubkey = user && user.powPubkey ? user.powPubkey : null;
      const balance = pubkey && accounts[pubkey] && typeof accounts[pubkey].balance === 'number' ? accounts[pubkey].balance : 0;
      currentUser = { pubkey, balance };
    }

    res.json({
      success: true,
      source: 'local',
      grid,
      volchain: {
        totalSupply,
        topHolders: holders.slice(0, 3),
        currentUser
      }
    });
  } catch (e) {
    console.error('stats/volchain error:', e);
    res.status(500).json({ success: false, error: 'Failed to fetch volchain stats' });
  }
});

// Volchain events endpoint
app.get('/volchain/events', (req, res) => {
  try {
    const events = readVolchainLog();
    res.json(events);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read volchain events' });
  }
});

// Admin: credit all users' Volchain balances to their total mined blocks
app.post('/admin/mint-volore-all', (req, res) => {
  try {
    const data = readDB();
    const accounts = readAccounts();
    const minedByUser = {};
    for (const block of data.grid) {
      if (block.dugBy) minedByUser[block.dugBy] = (minedByUser[block.dugBy] || 0) + 1;
    }
    let updated = 0;
    for (const user of data.users) {
      if (!user.powPubkey) continue;
      const target = minedByUser[user.username] || 0;
      const current = accounts[user.powPubkey]?.balance || 0;
      if (current < target) {
        accounts[user.powPubkey] = { ...(accounts[user.powPubkey] || {}), balance: target };
        updated++;
      }
    }
    writeAccounts(accounts);
    res.json({ success: true, updated });
  } catch (e) {
    console.error('mint-volore-all error:', e);
    res.status(500).json({ error: 'failed' });
  }
});

// Stats endpoint (local only)

// Get on-chain stats
app.get('/stats/blockchain', async (req, res) => {
  try {
    const username = req.query.username;
    const stats = computeLocalStats(username);
    res.json({ success: true, stats, source: 'local' });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Removed token transfer/reset endpoints (Solana/THET removed)

app.post('/api/update-username', async (req, res) => {
  const { currentUsername, newUsername } = req.body;
  if (!currentUsername || !newUsername) {
    return res.status(400).json({ error: 'Current and new usernames are required' });
  }
  if (String(newUsername).trim().length < 3) {
    return res.status(400).json({ error: 'New username must be at least 3 characters long' });
  }
  try {
    const data = readDB();
    const userIndex = data.users.findIndex(user => user.username === currentUsername);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    const normalizedNew = String(newUsername || '').trim();
    const usernameExists = data.users.some(user => 
      user.username.toLowerCase() === normalizedNew.toLowerCase() && user.username !== currentUsername
    );
    if (usernameExists) {
      return res.status(400).json({ error: 'This username is already taken (case-insensitive)' });
    }
    data.users[userIndex].username = normalizedNew;
    data.grid = data.grid.map(block => {
      if (block.dugBy === currentUsername) {
        return { ...block, dugBy: normalizedNew };
      }
      return block;
    });

    // GridB'deki owner alanlarını da güncelle (Warzone)
    const totalBlocks = data.grid.length;
    const gridBData = readGridB(totalBlocks);
    const updatedGridB = gridBData.map(block => 
      block.owner === currentUsername ? { ...block, owner: normalizedNew } : block
    );
    writeGridB(updatedGridB);

    writeDB(data);
    res.json({ success: true, newUsername });
  } catch (error) {
    console.error('Username update error:', error);
    res.status(500).json({ error: 'Username update failed' });
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

const ACCOUNTS_FILE = '/home/volcev/pow-node/data/accounts.json';

function readAccounts() {
  try {
    console.log(`[readAccounts] Reading from: ${ACCOUNTS_FILE}`);
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    }
  } catch (error) {
    console.error(`Error reading ${ACCOUNTS_FILE}:`, error);
  }
  return {};
}

function writeAccounts(data) {
  try {
    console.log(`[writeAccounts] Writing to: ${ACCOUNTS_FILE}`);
    const dataDir = path.dirname(ACCOUNTS_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing to ${ACCOUNTS_FILE}:`, error);
  }
}

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

function reconcileUserBalanceWithGrid(data, username) {
  try {
    if (!username) return;
    const user = data.users.find(u => u.username === username);
    if (!user || !user.powPubkey) return;
    const targetBalance = getUserBlockCount(data, username);
    const accounts = readAccounts();
    accounts[user.powPubkey] = { ...(accounts[user.powPubkey] || {}), balance: targetBalance };
    writeAccounts(accounts);
  } catch (e) {
    console.log('reconcileUserBalanceWithGrid error:', e.message);
  }
}

function reconcileAllBalancesWithGrid(data) {
  try {
    const accounts = readAccounts();
    for (const user of data.users) {
      if (!user.powPubkey) continue;
      const targetBalance = getUserBlockCount(data, user.username);
      accounts[user.powPubkey] = { ...(accounts[user.powPubkey] || {}), balance: targetBalance };
    }
    writeAccounts(accounts);
  } catch (e) {
    console.log('reconcileAllBalancesWithGrid error:', e.message);
  }
}

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
    console.error('assign-pubkeys error:', e);
    res.status(500).json({ success: false, error: 'failed' });
  }
});

// Volchain events log
const VOLCHAIN_LOG_FILE = path.join(__dirname, 'volchain_log.json');

function readVolchainLog() {
  try {
    if (fs.existsSync(VOLCHAIN_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(VOLCHAIN_LOG_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('readVolchainLog error:', e.message);
  }
  return [];
}

function writeVolchainLog(entries) {
  try {
    fs.writeFileSync(VOLCHAIN_LOG_FILE, JSON.stringify(entries, null, 2));
  } catch (e) {
    console.error('writeVolchainLog error:', e.message);
  }
}

function appendVolchainEvent(evt) {
  try {
    const entries = readVolchainLog();
    entries.unshift({ ts: Date.now(), ...evt });
    const trimmed = entries.slice(0, 1000);
    writeVolchainLog(trimmed);
  } catch (e) {
    console.error('appendVolchainEvent error:', e.message);
  }
}


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
    console.error('volchain inbox error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Volchain: transfer Volore from current user to a pubkey (max available)
app.post('/volchain/transfer', async (req, res) => {
  try {
    const sessionToken = req.headers['x-session-token'];
    const username = await validateSession(sessionToken);
    if (!username) return res.status(401).json({ error: 'Unauthorized' });

    const { toPubkey, amount } = req.body || {};
    if (!toPubkey || typeof toPubkey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(toPubkey)) {
      return res.status(400).json({ error: 'Invalid destination pubkey' });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || Math.floor(amt) !== amt) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const data = readDB();
    const sender = data.users.find(u => u.username === username);
    if (!sender || !sender.powPubkey) return res.status(400).json({ error: 'Sender has no Volchain address' });
    const receiver = data.users.find(u => u.powPubkey === toPubkey) || null;
    if (!receiver) {
      return res.status(400).json({ error: 'Receiver not found' });
    }
    if (sender.powPubkey === toPubkey) {
      return res.status(400).json({ error: 'Self-transfer is not allowed' });
    }

    // Compute available: total mined blocks - total defense used in gridb
    const totalBlocks = data.grid.filter(b => b.dugBy === username).length;
    const gridb = readGridB(data.grid.length);
    const used = gridb.filter(b => b && b.owner === username).reduce((sum, b) => sum + (typeof b.defense === 'number' ? b.defense : 1), 0);
    const available = Math.max(0, totalBlocks - used);
    if (amt > available) return res.status(400).json({ error: 'Amount exceeds available Volore' });

    // Move Digzone blocks: last mined blocks from sender to receiver
    let remaining = amt;
    for (let i = data.grid.length - 1; i >= 0 && remaining > 0; i--) {
      if (data.grid[i].dugBy === username) {
        data.grid[i].dugBy = receiver.username;
        if ('visual' in data.grid[i]) data.grid[i].visual = null;
        remaining--;
      }
    }
    writeDB(data);
    // Reconcile both balances strictly to grid
    reconcileUserBalanceWithGrid(data, sender.username);
    reconcileUserBalanceWithGrid(data, receiver.username);
    appendVolchainEvent({ type: 'transfer', fromUser: sender.username, from: sender.powPubkey, to: toPubkey, amount: amt });

    // Notify receiver if known
    const rxIndex = data.users.findIndex(u => u.username === receiver.username);
    if (rxIndex !== -1) {
      data.users[rxIndex].volchainInbox = data.users[rxIndex].volchainInbox || [];
      data.users[rxIndex].volchainInbox.push({
        ts: Date.now(),
        type: 'volore_received',
        from: sender.powPubkey,
        to: receiver.powPubkey,
        amount: amt,
        message: `You received ${amt} Volore from ${sender.powPubkey}`
      });
      writeDB(data);
    }

    // Recompute available after move
    const totalBlocksAfter = data.grid.filter(b => b.dugBy === username).length;
    const gridbAfter = readGridB(data.grid.length);
    const usedAfter = gridbAfter.filter(b => b && b.owner === username).reduce((sum, b) => sum + (typeof b.defense === 'number' ? b.defense : 1), 0);
    const availableAfter = Math.max(0, totalBlocksAfter - usedAfter);
    return res.json({ success: true, availableAfter });
  } catch (e) {
    console.error('volchain transfer error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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
      console.log('✅ Session written to main server:', response.data.sessionToken);
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

// GET /gridb: Return the current state of GridB
app.get('/gridb', (req, res) => {
  const totalBlocks = readDB().grid.length;
  const gridb = readGridB(totalBlocks);
  res.json(gridb);
});

// PATCH /gridb/:index: User adds the next of their own blocks
app.patch('/gridb/:index', async (req, res) => {
  try {
    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing session token' });
    }
    const username = await validateSession(sessionToken);
    if (!username) {
      return res.status(401).json({ error: 'Unauthorized: Invalid session token' });
    }
    const blockIndex = parseInt(req.params.index);
    const db = readDB();
    const totalBlocks = db.grid.length;
    let gridb = readGridB(totalBlocks);
    if (blockIndex < 0 || blockIndex >= totalBlocks) {
      return res.status(400).json({ error: 'Invalid block index' });
    }
    if (!gridb[blockIndex]) {
      return res.status(400).json({ error: 'Block not found' });
    }

    // User stock control (mined blocks count - total defense used in gridb)
    const userBlocks = db.grid.filter(b => b.dugBy === username);
    const userBlocksInGridB = gridb.filter(b => b.owner === username);
    const totalDefenseUsed = userBlocksInGridB.reduce((sum, b) => sum + (b.defense || 1), 0);
    const userStock = userBlocks.length - totalDefenseUsed;

    // If user has no blocks in gridb, they can place first block anywhere
    const userHasNoBlocksInGridB = userBlocksInGridB.length === 0;
    const emptyBlocks = gridb.filter(b => !b.owner);
    const isFirstPlacement = userHasNoBlocksInGridB;

    const block = gridb[blockIndex];
    // Clicking empty block or claiming ownerless block
    if (!block.owner) {
      if (userStock <= 0 && !isFirstPlacement) {
        return res.status(400).json({ error: 'No stock left to place a block' });
      }
      
      // ✨ NEW: Neighbor validation for empty block placement (except first placement)
      if (!isFirstPlacement) {
        const neighbors = getNeighbors(blockIndex, totalBlocks, 50);
        const hasNeighbor = neighbors.some(n => gridb[n] && gridb[n].owner === username);
        if (!hasNeighbor) {
          return res.status(403).json({ error: 'You must place blocks adjacent to your existing blocks' });
        }
      }
      
      // No additional cost for claiming - already paid during attack
      
      gridb[blockIndex] = { index: blockIndex, owner: username, defense: 1 };
      writeGridB(gridb);
      return res.json(gridb);
    }

    // Clicking own block (increase defense)
    if (block.owner === username) {
      // Stock required to increase defense too
      if (userStock <= 0) {
        return res.status(400).json({ error: 'No stock left to increase defense' });
      }
      
      // Defense increase is just redistribution - no block loss from GridA
      gridb[blockIndex].defense = (typeof gridb[blockIndex].defense === 'number' ? gridb[blockIndex].defense : 1) + 1;

      writeGridB(gridb);
      return res.json(gridb);
    }

    // Clicking someone else's block
    // Neighbor check: user must have at least one neighboring block
    const neighbors = getNeighbors(blockIndex, totalBlocks, 50);
    const hasNeighbor = neighbors.some(n => gridb[n] && gridb[n].owner === username);
    if (!hasNeighbor && !isFirstPlacement) {
      return res.status(403).json({ error: 'You must have a neighboring block to attack' });
    }
    
    // Attack mechanics
    const currentDefense = typeof gridb[blockIndex].defense === 'number' ? gridb[blockIndex].defense : 1;
    
    // ⚡ CASTLE PROTECTION: Castle attacks forbidden on first placement
    if (isFirstPlacement && currentDefense >= 10) {
      return res.status(403).json({ error: 'Cannot attack castles on first placement. Attack a neighboring block first.' });
    }
    const prevOwner = gridb[blockIndex].owner;
    
    // Each attack costs attacker 1 block
          const attackerBlocks = db.grid
        .map((b, i) => ({ ...b, _idx: i }))
        .filter(b => b.dugBy === username)
        .sort((a, b) => b.index - a.index); // Start from highest index
    
    if (attackerBlocks.length > 0) {
      const toDelete = attackerBlocks[0];
      db.grid[toDelete._idx].dugBy = null;
      if ('visual' in db.grid[toDelete._idx]) db.grid[toDelete._idx].visual = null;
      // Reconcile attacker balance with grid and log burn event
      try {
        const attacker = db.users.find(u => u.username === username);
        if (attacker && attacker.powPubkey) {
          reconcileUserBalanceWithGrid(db, username);
          appendVolchainEvent({ type: 'burn', reason: 'warzone_attack_cost', username, pubkey: attacker.powPubkey, amount: 1 });
        }
      } catch (e) {
        console.log('Warzone burn (attacker) error:', e.message);
      }
    }
    
    // Each attack costs defender 1 block too
    if (prevOwner && prevOwner !== username) {
      const defenderBlocks = db.grid
        .map((b, i) => ({ ...b, _idx: i }))
        .filter(b => b.dugBy === prevOwner)
        .sort((a, b) => b.index - a.index); // Start from highest index
      
      if (defenderBlocks.length > 0) {
        const toDelete = defenderBlocks[0];
        db.grid[toDelete._idx].dugBy = null;
        if ('visual' in db.grid[toDelete._idx]) db.grid[toDelete._idx].visual = null;
        // Reconcile defender balance with grid and log burn event
        try {
          const defender = db.users.find(u => u.username === prevOwner);
          if (defender && defender.powPubkey) {
            reconcileUserBalanceWithGrid(db, prevOwner);
            appendVolchainEvent({ type: 'burn', reason: 'warzone_defense_loss', username: prevOwner, pubkey: defender.powPubkey, amount: 1 });
          }
        } catch (e) {
          console.log('Warzone burn (defender) error:', e.message);
        }
      }
    }
    
    writeDB(db); // Save attack cost
    
    // Defense azalt
    gridb[blockIndex].defense = currentDefense - 1;
    
    if (gridb[blockIndex].defense <= 0) {
      // Block becomes ownerless
      gridb[blockIndex].owner = null;
      gridb[blockIndex].defense = 0;
    }
    writeGridB(gridb);
    res.json(gridb);
  } catch (e) {
    console.error('PATCH /gridb/:index error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /gridb/:index: User removes their own block
app.delete('/gridb/:index', async (req, res) => {
  const sessionToken = req.headers['x-session-token'];
  if (!sessionToken) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing session token' });
  }
  const username = await validateSession(sessionToken);
  if (!username) {
    return res.status(401).json({ error: 'Unauthorized: Invalid session token' });
  }
  const blockIndex = parseInt(req.params.index);
  const totalBlocks = readDB().grid.length;
  let gridb = readGridB(totalBlocks);
  if (blockIndex < 0 || blockIndex >= totalBlocks) {
    return res.status(400).json({ error: 'Invalid block index' });
  }
  if (!gridb[blockIndex].owner || gridb[blockIndex].owner !== username) {
    return res.status(403).json({ error: 'You can only remove your own block' });
  }
  gridb[blockIndex] = { index: blockIndex, owner: null, color: null, visual: null, userBlockIndex: null };
  writeGridB(gridb);
  res.json(gridb);
});

    // POST /update-block-color: User updates their block's color
// This endpoint removed

// POST /api/contact: Handle contact form submissions
app.post('/api/contact', async (req, res) => {
  const { name, email, message, username } = req.body;
  
  // Check if user is authenticated by session token
  const sessionToken = req.headers.authorization?.replace('Bearer ', '');
  if (!sessionToken) {
    return res.status(401).json({ error: 'Authentication required. Please log in to send a message.' });
  }
  
  // Validate session
  const isValidSession = await validateSession(sessionToken);
  if (!isValidSession) {
    return res.status(401).json({ error: 'Invalid session. Please log in again.' });
  }
  
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  try {
    const contactData = {
      id: Date.now(), // Simple ID based on timestamp
      timestamp: new Date().toISOString(),
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
      username: username || 'Anonymous',
      ip: req.ip,
      status: 'new' // new, read, resolved
    };
    
    // Save to contacts.json file
    const contactsFile = path.join(__dirname, 'contacts.json');
    let contacts = [];
    
    try {
      if (fs.existsSync(contactsFile)) {
        const data = fs.readFileSync(contactsFile, 'utf8');
        contacts = JSON.parse(data);
      }
    } catch (err) {
      console.log('Creating new contacts.json file');
    }
    
    contacts.unshift(contactData); // Add to beginning (newest first)
    
    // Keep only last 1000 messages to prevent file getting too large
    if (contacts.length > 1000) {
      contacts = contacts.slice(0, 1000);
    }
    
    fs.writeFileSync(contactsFile, JSON.stringify(contacts, null, 2));
    
    console.log('📧 New contact message saved:', {
      id: contactData.id,
      from: contactData.name,
      email: contactData.email,
      timestamp: contactData.timestamp
    });
    
    res.json({ 
      success: true, 
      message: 'Your message has been received. We will get back to you soon!' 
    });
    
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ error: 'Failed to process your message. Please try again.' });
  }
});

// GET /api/admin/contacts: View all contact messages (admin only)
app.get('/api/admin/contacts', async (req, res) => {
  try {
    // Check if user is authenticated by session token
    const sessionToken = req.headers.authorization?.replace('Bearer ', '');
    if (!sessionToken) {
      return res.status(401).json({ error: 'Authentication required. Admin access only.' });
    }
    
    // Validate session
    const isValidSession = await validateSession(sessionToken);
    if (!isValidSession) {
      return res.status(401).json({ error: 'Invalid session. Please log in again.' });
    }
    
    const contactsFile = path.join(__dirname, 'contacts.json');
    
    if (!fs.existsSync(contactsFile)) {
      return res.json([]);
    }
    
    const data = fs.readFileSync(contactsFile, 'utf8');
    const contacts = JSON.parse(data);
    
    res.json(contacts);
  } catch (error) {
    console.error('Error reading contacts:', error);
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Custom server running at http://0.0.0.0:${PORT}`);
});
