const express = require('express');
const fs = require('fs');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const { PublicKey, Connection, Keypair, Transaction } = require('@solana/web3.js');
const { createTransferInstruction, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

const DB_FILE = './db.json';
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const THE_TOKEN_MINT = new PublicKey('7gryqXLucgivS9NHgnA22WFZqLG8jU317pBJYeWkGynH');
const secretKey = JSON.parse(fs.readFileSync('./id.json', 'utf8'));
const senderKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));

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

function generateVerificationToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Session store (memory-based, process restartında silinir)
const sessions = {};

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
    createdAt: new Date().toISOString(),
    walletAddress: null,
    sentTokens: 0
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

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    return res.status(400).json({ error: 'Invalid password' });
  }

  // Session token üret ve sakla
  const sessionToken = generateSessionToken();
  sessions[sessionToken] = { username: user.username, createdAt: Date.now() };

  res.json({ success: true, username: user.username, color: user.color, walletAddress: user.walletAddress, sentTokens: user.sentTokens, sessionToken });
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

  res.json({ email: user.email, username: user.username, color: user.color, walletAddress: user.walletAddress, sentTokens: user.sentTokens });
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

app.post('/update-wallet', async (req, res) => {
  const { username, walletAddress } = req.body;
  if (!username || !walletAddress) {
    return res.status(400).json({ error: 'Username and wallet address are required' });
  }

  const data = readDB();
  const user = data.users.find(user => user.username === username);

  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  try {
    const receiverPubkey = new PublicKey(walletAddress);
    user.walletAddress = walletAddress;

    const userBlocks = data.grid.filter(block => block.dugBy === username);
    const tokenAmount = userBlocks.length;

    if (tokenAmount > 0) {
      const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        senderKeypair,
        THE_TOKEN_MINT,
        senderKeypair.publicKey
      );

      const receiverTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        senderKeypair,
        THE_TOKEN_MINT,
        receiverPubkey
      );

      const transaction = new Transaction().add(
        createTransferInstruction(
          senderTokenAccount.address,
          receiverTokenAccount.address,
          senderKeypair.publicKey,
          tokenAmount * 1000000000 // 1 THET = 10^9 lamports
        )
      );

      const signature = await connection.sendTransaction(transaction, [senderKeypair]);
      await connection.confirmTransaction(signature, 'confirmed');

      user.sentTokens = (user.sentTokens || 0) + tokenAmount;
      writeDB(data);

      res.json({ message: 'Wallet address and token transfer successful', signature, sentTokens: user.sentTokens });
    } else {
      user.sentTokens = user.sentTokens || 0;
      writeDB(data);
      res.json({ message: 'Wallet address updated, no blocks dug', sentTokens: user.sentTokens });
    }
  } catch (error) {
    console.error('Wallet address or transfer error:', error);
    return res.status(400).json({ error: `Invalid wallet address or transfer error: ${error.message}` });
  }
});

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

  // Kullanıcı adını güncelle
  user.username = newUsername;

  // Grid’deki dugBy alanlarını güncelle
  data.grid = data.grid.map(block => 
    block.dugBy === currentUsername ? { ...block, dugBy: newUsername } : block
  );

  writeDB(data);

  res.json({ message: 'Username updated successfully', newUsername });
});

app.patch('/grid/:index', async (req, res) => {
  const index = parseInt(req.params.index);
  const { dugBy, color, receiverAddress } = req.body;

  const data = readDB();
  const block = data.grid[index];

  if (!block) {
    return res.status(404).json({ error: 'Block not found' });
  }

  block.dugBy = dugBy;
  block.color = color;

  if (!receiverAddress) {
    writeDB(data);
    return res.json({ success: true });
  }

  try {
    const receiverPubkey = new PublicKey(receiverAddress);
    const user = data.users.find(user => user.username === dugBy);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair,
      THE_TOKEN_MINT,
      senderKeypair.publicKey
    );

    const receiverTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair,
      THE_TOKEN_MINT,
      receiverPubkey
    );

    const transaction = new Transaction().add(
      createTransferInstruction(
        senderTokenAccount.address,
        receiverTokenAccount.address,
        senderKeypair.publicKey,
        1 * 1000000000 // 1 THET = 10^9 lamports
      )
    );

    const signature = await connection.sendTransaction(transaction, [senderKeypair]);
    await connection.confirmTransaction(signature, 'confirmed');

    user.sentTokens = (user.sentTokens || 0) + 1;
    writeDB(data);

    res.json({ success: true, rewardSignature: signature, sentTokens: user.sentTokens });
  } catch (error) {
    console.error('Reward transfer error:', error);
    res.json({ success: true, rewardError: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Auth server running at http://0.0.0.0:${PORT}`);
});

// Export sessions objesi ve fonksiyonları diğer dosyalarda kullanmak için
module.exports = { app, sessions };