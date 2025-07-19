const express = require('express');
const fs = require('fs');
const cors = require('cors');
const { Connection, PublicKey, Keypair, clusterApiUrl, Transaction } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, createTransferInstruction } = require('@solana/spl-token');
const bcrypt = require('bcrypt');

// Session store (memory-based, cleared on process restart)
const sessions = {};
function generateSessionToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

const app = express();
const PORT = process.env.PORT || 3001;

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const THE_TOKEN_MINT = new PublicKey('7gryqXLucgivS9NHgnA22WFZqLG8jU317pBJYeWkGynH');

const secretKey = JSON.parse(fs.readFileSync('./id.json', 'utf8'));
const senderKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));

app.use(cors());
app.use(express.json());

const DB_FILE = './db.json';

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

const GRIDB_FILE = './gridb.json';
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
  if (!sessionToken || !sessions[sessionToken]) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing session token' });
  }
  const username = sessions[sessionToken].username;

  const index = parseInt(req.params.index);
  const { color, visual } = req.body;
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
  }
  if (user.dailyDigCount === undefined) user.dailyDigCount = 0;
  if (user.dailyDigCount >= 12) {
    return res.status(429).json({ error: 'Daily mining limit reached' });
  }
  user.dailyDigCount++;
  // --- SONU ---

  block.dugBy = username;
  block.color = color;
  block.visual = visual || null;
  writeDB(data);
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
        counts[key] = { count: 0, color: block.color || "#000" };
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

app.post('/reset-tokens', async (req, res) => {
  const { username, walletAddress, blockCount } = req.body;
  if (!walletAddress || !blockCount || blockCount <= 0) {
    return res.status(400).json({ error: 'Invalid wallet address or block count' });
  }
  const data = readDB();
  const user = data.users.find(user => user.username === username);
  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }
  try {
    const receiverPubkey = new PublicKey(walletAddress);
    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(connection, senderKeypair, THE_TOKEN_MINT, senderKeypair.publicKey);
    const receiverTokenAccount = await getOrCreateAssociatedTokenAccount(connection, senderKeypair, THE_TOKEN_MINT, receiverPubkey);
    const transaction = new Transaction().add(
      createTransferInstruction(
        senderTokenAccount.address,
        receiverTokenAccount.address,
        senderKeypair.publicKey,
        blockCount * 1000000000
      )
    );
    const signature = await connection.sendTransaction(transaction, [senderKeypair]);
    await connection.confirmTransaction(signature, 'confirmed');
    
    // Reset the blocks mined by the user
    data.grid.forEach(block => {
      if (block.dugBy === username) {
        block.dugBy = null;
        block.color = null;
        block.visual = null;
      }
    });

    user.sentTokens = (user.sentTokens || 0) + blockCount;
    writeDB(data);
    res.json({ success: true, sentTokens: user.sentTokens, rewardSignature: signature });
  } catch (error) {
    console.error('Reward transfer error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/transfer-token', async (req, res) => {
  const { receiverAddress, amount } = req.body;
  try {
    const receiverPubkey = new PublicKey(receiverAddress);
    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(connection, senderKeypair, THE_TOKEN_MINT, senderKeypair.publicKey);
    const receiverTokenAccount = await getOrCreateAssociatedTokenAccount(connection, senderKeypair, THE_TOKEN_MINT, receiverPubkey);
    const transaction = new Transaction().add(
      createTransferInstruction(
        senderTokenAccount.address,
        receiverTokenAccount.address,
        senderKeypair.publicKey,
        Math.floor(amount * 1000000000)
      )
    );
    const signature = await connection.sendTransaction(transaction, [senderKeypair]);
    await connection.confirmTransaction(signature, 'confirmed');
    res.json({ success: true, signature });
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/update-username', async (req, res) => {
  const { currentUsername, newUsername } = req.body;
  if (!currentUsername || !newUsername) {
    return res.status(400).json({ error: 'Current and new usernames are required' });
  }
  if (newUsername.length < 3) {
    return res.status(400).json({ error: 'New username must be at least 3 characters long' });
  }
  try {
    const data = readDB();
    const userIndex = data.users.findIndex(user => user.username === currentUsername);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    const usernameExists = data.users.some(user => user.username === newUsername);
    if (usernameExists) {
      return res.status(400).json({ error: 'This username is already taken' });
    }
    data.users[userIndex].username = newUsername;
    data.grid = data.grid.map(block => {
      if (block.dugBy === currentUsername) {
        return { ...block, dugBy: newUsername };
      }
      return block;
    });
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

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const data = readDB();
  const user = data.users.find(user => user.email === email);

  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  if (!user.isVerified) {
    return res.status(400).json({ error: 'Email not verified' });
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    return res.status(400).json({ error: 'Invalid password' });
  }

  // Session token generate and store
  const sessionToken = generateSessionToken();
  sessions[sessionToken] = { username: user.username, createdAt: Date.now() };

  res.json({ success: true, username: user.username, color: user.color, walletAddress: user.walletAddress, sentTokens: user.sentTokens, sessionToken });
});

// GET /gridb: Return the current state of GridB
app.get('/gridb', (req, res) => {
  const totalBlocks = readDB().grid.length;
  const gridb = readGridB(totalBlocks);
  res.json(gridb);
});

// PATCH /gridb/:index: User adds the next of their own blocks
app.patch('/gridb/:index', (req, res) => {
  const sessionToken = req.headers['x-session-token'];
  if (!sessionToken || !sessions[sessionToken]) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing session token' });
  }
  const username = sessions[sessionToken].username;
  const blockIndex = parseInt(req.params.index);
  const totalBlocks = readDB().grid.length;
  let gridb = readGridB(totalBlocks);
  if (blockIndex < 0 || blockIndex >= totalBlocks) {
    return res.status(400).json({ error: 'Invalid block index' });
  }
  if (gridb[blockIndex].owner) {
    return res.status(409).json({ error: 'Block already filled' });
  }
  // Find the user's own blocks
  const userBlocks = readDB().grid.filter(b => b.dugBy === username).sort((a, b) => a.index - b.index);
  // Find the blocks the user has already added to gridb
  const usedUserBlockIndexes = gridb.filter(b => b.owner === username).map(b => b.userBlockIndex);
  const nextUserBlock = userBlocks.find(b => !usedUserBlockIndexes.includes(b.index));
  if (!nextUserBlock) {
    return res.status(400).json({ error: 'No more user blocks to add' });
  }
  gridb[blockIndex] = {
    index: blockIndex,
    owner: username,
    color: nextUserBlock.color || '#ccc',
    visual: nextUserBlock.visual || '⛏',
    userBlockIndex: nextUserBlock.index
  };
  writeGridB(gridb);
  res.json(gridb);
});

// DELETE /gridb/:index: User removes their own block
app.delete('/gridb/:index', (req, res) => {
  const sessionToken = req.headers['x-session-token'];
  if (!sessionToken || !sessions[sessionToken]) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing session token' });
  }
  const username = sessions[sessionToken].username;
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

// POST /update-block-color: Kullanıcı kendi bloğunun rengini günceller
app.post('/update-block-color', async (req, res) => {
  const { index, username, color } = req.body;
  if (!color || typeof color !== 'string') {
    return res.status(400).json({ error: 'Please provide a color' });
  }
  const data = readDB();
  const block = data.grid[index];
  if (!block || block.dugBy !== username) {
    return res.status(403).json({ error: 'This block does not belong to you' });
  }
  block.color = color;
  writeDB(data);
  // GridB'de de bu userBlockIndex'e sahip blokların rengi güncellenir
  const totalBlocks = data.grid.length;
  let gridb = readGridB(totalBlocks);
  gridb = gridb.map(b => b && b.userBlockIndex === index ? { ...b, color } : b);
  writeGridB(gridb);
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Custom server running at http://0.0.0.0:${PORT}`);
});
