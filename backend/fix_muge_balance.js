#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read accounts file
const accountsPath = path.join(__dirname, 'accounts.json');
const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));

console.log('🔍 Checking Muge\'s current balance...');

// Find Muge's account
const mugeAccount = accounts.find(acc => acc.username === 'Muge');

if (!mugeAccount) {
  console.log('❌ Muge account not found');
  process.exit(1);
}

console.log(`📊 Muge current balance: ${mugeAccount.balance}`);
console.log(`📊 Muge current used: ${mugeAccount.used}`);
console.log(`📊 Muge current available: ${mugeAccount.available}`);

// Count actual blocks mined by Muge in the grid
const dbPath = path.join(__dirname, 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

let actualMinedBlocks = 0;
for (const block of db.grid) {
  if (block && block.status === 'dug' && block.owner === 'Muge') {
    actualMinedBlocks++;
  }
}

console.log(`⛏️  Muge actual mined blocks: ${actualMinedBlocks}`);

// Fix the balance mismatch
if (mugeAccount.balance !== actualMinedBlocks) {
  console.log(`🔧 Fixing balance mismatch: ${mugeAccount.balance} → ${actualMinedBlocks}`);

  // Create backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(accountsPath, `${accountsPath}.backup.${timestamp}`);
  console.log(`💾 Backup created: accounts.json.backup.${timestamp}`);

  // Fix the balance
  mugeAccount.balance = actualMinedBlocks;
  mugeAccount.used = Math.min(mugeAccount.used, actualMinedBlocks);
  mugeAccount.available = Math.max(0, actualMinedBlocks - mugeAccount.used);

  // Write back to file
  fs.writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));

  console.log('✅ Muge\'s balance fixed!');
  console.log(`📊 New balance: ${mugeAccount.balance}`);
  console.log(`📊 New used: ${mugeAccount.used}`);
  console.log(`📊 New available: ${mugeAccount.available}`);
} else {
  console.log('✅ Muge\'s balance is already correct');
}

console.log('🎉 Balance fix completed!');




