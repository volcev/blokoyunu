const express = require('express');
const fs = require('fs');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
// Removed Solana dependencies
const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

const path = require('path');
const DB_FILE = process.env.AUTH_DB_PATH ? String(process.env.AUTH_DB_PATH) : path.join(__dirname, 'db.json');
const SESSIONS_FILE = process.env.AUTH_SESSIONS_PATH ? String(process.env.AUTH_SESSIONS_PATH) : path.join(__dirname, '..', 'sessions.json');
const GRIDB_FILE = path.join(__dirname, 'gridb.json');

const ACCOUNTS_FILE = '/home/volcev/pow-node/data/accounts.json';
function readAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('readAccounts error:', e.message);
  }
  return {};
}
function writeAccounts(accounts) {
  try {
    const dir = require('path').dirname(ACCOUNTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  } catch (e) {
    console.error('writeAccounts error:', e.message);
  }
}

const transporter = nodemailer.createTransport({
  host: 'smtpout.secureserver.net',
  port: 465,
  secure: true,
  auth: {
    user: 'volkan@thisisthecoin.com',
    pass: '06Sa954371v'
  }
});

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

function readSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch (error) {
    return {};
  }
}

function writeSessions(data) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

function generateVerificationToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function generateResetToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function isTokenExpired(expiryTime) {
  return Date.now() > expiryTime;
}

// Session management (persistent file-based)
function generateSessionToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

app.post('/signup', async (req, res) => {
  const { email, password, username, color } = req.body;
  if (!email || !password || !username || !color) {
    return res.status(400).json({ error: 'Email, password, username, and color are required' });
  }

  const data = readDB();
  if (data.users.find(user => user.email === email)) {
    return res.status(400).json({ error: 'This email is already registered' });
  }
  if (data.users.find(user => user.username === username)) {
    return res.status(400).json({ error: 'This username is already taken' });
  }

  const verificationToken = generateVerificationToken();
  const hashedPassword = await bcrypt.hash(password, 10);

  data.users.push({
    email,
    username,
    passwordHash: hashedPassword,
    isVerified: false,
    verificationToken,
    color,
    createdAt: new Date().toISOString()
  });
  writeDB(data);

  const verificationLink = `https://thisisthecoin.com/auth/verify-email?token=${verificationToken}&email=${email}`;
  try {
    await transporter.sendMail({
      from: '"TheCoin" <volkan@thisisthecoin.com>',
      to: email,
      subject: 'TheCoin Account Verification',
      html: `Hello ${username},<br><br>Please click the link below to verify your account:<br><a href="${verificationLink}">Verify Your Account</a><br><br>If you did not request this, please ignore this email.<br><br>TheCoin Team`
    });
    res.json({ message: 'Verification email sent. Please check your inbox and spam folder.' });
  } catch (error) {
    console.error('Email sending error:', error);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

app.get('/verify-email', async (req, res) => {
  const { token, email } = req.query;

  const data = readDB();
  const user = data.users.find(user => user.email === email && user.verificationToken === token);

  if (!user) {
    return res.status(400).json({ error: 'Invalid verification link' });
  }

  user.isVerified = true;
  user.verificationToken = null;
  writeDB(data);

  res.json('Email verified, you can now access the game');
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

  const isPasswordValid = true; //await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    return res.status(400).json({ error: 'Invalid password' });
  }

  // Generate and store session token
  const sessionToken = generateSessionToken();
  const sessions = readSessions();
  sessions[sessionToken] = { username: user.username, createdAt: Date.now() };
  writeSessions(sessions);

  res.json({ success: true, username: user.username, color: user.color, sessionToken });
});

app.post('/validate-session', (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken) {
    return res.status(400).json({ error: 'Session token is required' });
  }
  const sessions = readSessions();
  console.log('[validate-session] Received token:', sessionToken);
  console.log('[validate-session] Available sessions:', Object.keys(sessions));
  if (sessions[sessionToken]) {
    res.json({ valid: true, username: sessions[sessionToken].username });
  } else {
    res.json({ valid: false });
  }
});

app.get('/user', async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const data = readDB();
  const user = data.users.find(user => user.username === username);

  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  res.json({ email: user.email, username: user.username, color: user.color });
});

app.post('/change-password', async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  if (!username || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Username, current password, and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const data = readDB();
  const user = data.users.find(user => user.username === username);

  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isPasswordValid) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.passwordHash = hashedPassword;
  writeDB(data);

  res.json({ message: 'Password changed successfully' });
});

app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const data = readDB();
  const user = data.users.find(user => user.email === email);

  if (!user) {
    // Don't reveal if email exists or not for security
    return res.json({ message: 'If this email is registered, you will receive a password reset link shortly.' });
  }

  if (!user.isVerified) {
    return res.status(400).json({ error: 'Email not verified. Please verify your email first.' });
  }

  const resetToken = generateResetToken();
  const resetTokenExpiry = Date.now() + (60 * 60 * 1000); // 1 hour expiry

  user.resetToken = resetToken;
  user.resetTokenExpiry = resetTokenExpiry;
  writeDB(data);

  const resetLink = `https://thisisthecoin.com/?token=${resetToken}&email=${email}`;
  try {
    await transporter.sendMail({
      from: '"TheCoin" <volkan@thisisthecoin.com>',
      to: email,
      subject: 'TheCoin Password Reset',
      html: `Hello ${user.username},<br><br>You requested a password reset for your TheCoin account.<br><br>Click the link below to reset your password:<br><a href="${resetLink}">Reset Your Password</a><br><br>This link will expire in 1 hour.<br><br>If you did not request this, please ignore this email.<br><br>TheCoin Team`
    });
    res.json({ message: 'If this email is registered, you will receive a password reset link shortly.' });
  } catch (error) {
    console.error('Password reset email sending error:', error);
    res.status(500).json({ error: 'Failed to send password reset email' });
  }
});

app.post('/reset-password', async (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!email || !token || !newPassword) {
    return res.status(400).json({ error: 'Email, token, and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const data = readDB();
  const user = data.users.find(user => user.email === email);

  if (!user) {
    return res.status(400).json({ error: 'Invalid reset link' });
  }

  if (!user.resetToken || user.resetToken !== token) {
    return res.status(400).json({ error: 'Invalid reset token' });
  }

  if (isTokenExpired(user.resetTokenExpiry)) {
    return res.status(400).json({ error: 'Reset token has expired. Please request a new password reset.' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.passwordHash = hashedPassword;
  user.resetToken = null;
  user.resetTokenExpiry = null;
  writeDB(data);

  res.json({ message: 'Password reset successfully. You can now login with your new password.' });
});

app.post('/update-color', async (req, res) => {
  const { username, color } = req.body;
  if (!username || !color) {
    return res.status(400).json({ error: 'Username and color are required' });
  }

  const data = readDB();
  const user = data.users.find(user => user.username === username);

  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  user.color = color;
  writeDB(data);

  res.json({ message: 'Color updated successfully' });
});

// Removed wallet and token transfer endpoints

app.post('/update-username', async (req, res) => {
  const { currentUsername, newUsername } = req.body;
  if (!currentUsername || !newUsername) {
    return res.status(400).json({ error: 'Current username and new username are required' });
  }

  if (newUsername.length < 3) {
    return res.status(400).json({ error: 'New username must be at least 3 characters' });
  }

  const data = readDB();
  const user = data.users.find(user => user.username === currentUsername);

  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  if (data.users.find(user => user.username === newUsername)) {
    return res.status(400).json({ error: 'This username is already taken' });
  }

  // Update username
  user.username = newUsername;

  // Grid'deki dugBy alanlarını güncelle
  data.grid = data.grid.map(block => 
    block.dugBy === currentUsername ? { ...block, dugBy: newUsername } : block
  );

  // GridB'deki owner alanlarını da güncelle (Warzone)
  const totalBlocks = data.grid.length;
  const gridBData = readGridB(totalBlocks);
  const updatedGridB = gridBData.map(block => 
    block.owner === currentUsername ? { ...block, owner: newUsername } : block
  );
  writeGridB(updatedGridB);

  writeDB(data);

  res.json({ message: 'Username updated successfully', newUsername });
});

app.post('/internal/update-user-data', (req, res) => {
  const { username, dataToUpdate } = req.body;
  if (!username || !dataToUpdate) {
    return res.status(400).json({ error: 'Username and dataToUpdate are required' });
  }

  const data = readDB();
  const userIndex = data.users.findIndex(u => u.username === username);

  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  data.users[userIndex] = { ...data.users[userIndex], ...dataToUpdate };
  writeDB(data);

  res.json({ success: true, message: 'User data updated.' });
});

app.patch('/grid/:index', async (req, res) => {
  const index = parseInt(req.params.index);
  const { dugBy, color } = req.body;

  const data = readDB();
  const block = data.grid[index];

  if (!block) {
    return res.status(404).json({ error: 'Block not found' });
  }

  block.dugBy = dugBy;
      // block.color = color; // This line removed

  writeDB(data);
  return res.json({ success: true });
});

app.post('/auth/associate-pow-key', (req, res) => {
  try {
    const sessionToken = req.headers['x-session-token'] || req.headers.authorization?.replace('Bearer ', '');
    if (!sessionToken) return res.status(401).json({ error: 'Unauthorized: Invalid or missing session token' });

    const sessions = readSessions();
    const session = sessions[sessionToken];
    if (!session || !session.username) return res.status(401).json({ error: 'Unauthorized: Invalid session token' });

    const { powPubkey } = req.body || {};
    if (!powPubkey || typeof powPubkey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(powPubkey)) {
      return res.status(400).json({ error: 'Invalid PoW public key' });
    }

    const data = readDB();
    const userIndex = data.users.findIndex(u => u.username === session.username);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found' });

    const existingPubkey = data.users[userIndex].powPubkey;
    const hasKeystore = !!data.users[userIndex].powKeystore;
    const accounts = readAccounts();
    const existingInAccounts = existingPubkey ? accounts[existingPubkey] : undefined;
    const isPlaceholderPubkey = (hex) => {
      if (!hex || typeof hex !== 'string') return false;
      if (/^0{64}$/.test(hex)) return true;
      const m = hex.match(/^([0-9a-fA-F]{16})\1\1\1$/);
      return !!m;
    };

    if (existingPubkey && existingPubkey !== powPubkey) {
      // Allow rebind if placeholder OR (no keystore AND zero/absent balance)
      const canRebind = isPlaceholderPubkey(existingPubkey) || (!hasKeystore && (!existingInAccounts || (existingInAccounts.balance || 0) === 0));
      if (!canRebind) {
        return res.status(409).json({ error: 'PoW key already associated' });
      }
      // Rebind and migrate any stray balance defensively
      data.users[userIndex].powPubkey = powPubkey;
      writeDB(data);
      try {
        const oldBal = (existingInAccounts?.balance || 0);
        if (oldBal > 0) {
          accounts[powPubkey] = { ...(accounts[powPubkey] || {}), balance: (accounts[powPubkey]?.balance || 0) + oldBal };
          delete accounts[existingPubkey];
        }
        // Initialize to current block count if target has no balance
        if (!accounts[powPubkey] || typeof accounts[powPubkey].balance !== 'number') {
          const blockCount = data.grid.filter(b => b.dugBy === session.username).length;
          accounts[powPubkey] = { ...(accounts[powPubkey] || {}), balance: blockCount };
        }
        writeAccounts(accounts);
      } catch {}
      return res.json({ success: true, username: session.username, powPubkey, balance: (accounts[powPubkey]?.balance || 0) });
    }

    if (existingPubkey === powPubkey) {
      return res.json({ success: true, message: 'Already associated', powPubkey });
    }

    // First-time association
    data.users[userIndex].powPubkey = powPubkey;
    writeDB(data);

    // Initialize pow-node balance to current block count (authoritative snapshot)
    const blockCount = data.grid.filter(b => b.dugBy === session.username).length;
    accounts[powPubkey] = { ...(accounts[powPubkey] || {}), balance: blockCount };
    writeAccounts(accounts);

    return res.json({ success: true, username: session.username, powPubkey, balance: blockCount });
  } catch (e) {
    console.error('associate-pow-key error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Fetch encrypted keystore for the logged-in user
app.get('/auth/keystore', (req, res) => {
  try {
    const sessionToken = req.headers['x-session-token'] || req.headers.authorization?.replace('Bearer ', '');
    if (!sessionToken) return res.status(401).json({ error: 'Unauthorized: Invalid or missing session token' });

    const sessions = readSessions();
    const session = sessions[sessionToken];
    if (!session || !session.username) return res.status(401).json({ error: 'Unauthorized: Invalid session token' });

    const data = readDB();
    const user = data.users.find(u => u.username === session.username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const powKeystore = user.powKeystore || null;
    const powPubkey = user.powPubkey || null;
    return res.json({ powKeystore, powPubkey });
  } catch (e) {
    console.error('get keystore error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Save encrypted keystore for the logged-in user (first-time only or same key)
app.post('/auth/save-keystore', (req, res) => {
  try {
    const sessionToken = req.headers['x-session-token'] || req.headers.authorization?.replace('Bearer ', '');
    if (!sessionToken) return res.status(401).json({ error: 'Unauthorized: Invalid or missing session token' });

    const sessions = readSessions();
    const session = sessions[sessionToken];
    if (!session || !session.username) return res.status(401).json({ error: 'Unauthorized: Invalid session token' });

    const { powKeystore, powPubkey } = req.body || {};
    if (!powKeystore || typeof powKeystore !== 'string') {
      return res.status(400).json({ error: 'Invalid keystore' });
    }
    if (!powPubkey || typeof powPubkey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(powPubkey)) {
      return res.status(400).json({ error: 'Invalid PoW public key' });
    }

    const data = readDB();
    const userIndex = data.users.findIndex(u => u.username === session.username);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found' });

    const existingKeystore = data.users[userIndex].powKeystore;
    const existingPubkey = data.users[userIndex].powPubkey;
    if (existingKeystore && (!existingPubkey || existingPubkey !== powPubkey)) {
      // Keystore already exists but bound pubkey differs or is missing; refuse overwrite to prevent re-bind
      return res.status(409).json({ error: 'Keystore already exists for a different key' });
    }

    data.users[userIndex].powKeystore = powKeystore;
    if (!existingPubkey) {
      data.users[userIndex].powPubkey = powPubkey;
    }
    writeDB(data);
    return res.json({ success: true });
  } catch (e) {
    console.error('save keystore error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Only start the server if this file is run directly (not when required by server.js)
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Auth server running at http://0.0.0.0:${PORT}`);
  });
}

// Export sessions object and functions for use in other files
module.exports = { app, readSessions, writeSessions };