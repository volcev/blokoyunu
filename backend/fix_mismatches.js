#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read current data
const dbPath = path.join(__dirname, 'db.json');
const gridbPath = path.join(__dirname, 'gridb.json');

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const gridb = JSON.parse(fs.readFileSync(gridbPath, 'utf8'));

console.log('🔍 Analyzing current state...');

// Find users to fix
const vacatayUser = db.users.find(u => u.username === 'vacatay');
const VacatayUser = db.users.find(u => u.username === 'Vacatay');
const volUser = db.users.find(u => u.username === 'Vol');
const volkan2User = db.users.find(u => u.username === 'Volkan2');
const dgngntrkn = db.users.find(u => u.username === 'Dgngntrkn');

console.log('Users found:');
console.log('- vacatay:', !!vacatayUser, vacatayUser?.powPubkey?.slice(0,8));
console.log('- Vacatay:', !!VacatayUser, VacatayUser?.powPubkey?.slice(0,8));
console.log('- Vol:', !!volUser, volUser?.powPubkey?.slice(0,8));
console.log('- Volkan2:', !!volkan2User, volkan2User?.powPubkey?.slice(0,8));
console.log('- Dgngntrkn:', !!dgngntrkn, dgngntrkn?.powPubkey?.slice(0,8));

// Count blocks by user
const blockCounts = {};
for (const block of db.grid) {
  if (block.dugBy) {
    blockCounts[block.dugBy] = (blockCounts[block.dugBy] || 0) + 1;
  }
}

// Count warzone usage by user
const warzoneUsage = {};
for (const block of gridb) {
  if (block && block.owner) {
    warzoneUsage[block.owner] = (warzoneUsage[block.owner] || 0) + (block.defense || 1);
  }
}

console.log('\n📊 Current blocks mined:');
console.log('- Vacatay:', blockCounts['Vacatay'] || 0);
console.log('- vacatay:', blockCounts['vacatay'] || 0);
console.log('- Vol:', blockCounts['Vol'] || 0);
console.log('- Volkan2:', blockCounts['Volkan2'] || 0);
console.log('- Dgngntrkn:', blockCounts['Dgngntrkn'] || 0);

console.log('\n⚔️ Current warzone usage:');
console.log('- Vacatay:', warzoneUsage['Vacatay'] || 0);
console.log('- vacatay:', warzoneUsage['vacatay'] || 0);
console.log('- Vol:', warzoneUsage['Vol'] || 0);
console.log('- Volkan2:', warzoneUsage['Volkan2'] || 0);
console.log('- Dgngntrkn:', warzoneUsage['Dgngntrkn'] || 0);

console.log('\n🔧 Starting fixes...');

// 1. Remove vacatay user and all their blocks
if (vacatayUser) {
  console.log('1️⃣ Removing vacatay user...');
  
  // Remove from users list
  db.users = db.users.filter(u => u.username !== 'vacatay');
  
  // Remove all blocks owned by vacatay in Digzone
  let removedDigzoneBlocks = 0;
  for (const block of db.grid) {
    if (block.dugBy === 'vacatay') {
      block.dugBy = null;
      if (block.visual) block.visual = null;
      if (block.color) block.color = null;
      removedDigzoneBlocks++;
    }
  }
  
  // Remove all blocks owned by vacatay in Warzone
  let removedWarzoneBlocks = 0;
  for (let i = 0; i < gridb.length; i++) {
    if (gridb[i] && gridb[i].owner === 'vacatay') {
      gridb[i] = { index: i, owner: null };
      removedWarzoneBlocks++;
    }
  }
  
  console.log(`   Removed vacatay user and ${removedDigzoneBlocks} digzone blocks, ${removedWarzoneBlocks} warzone blocks`);
}

// 2. Fix Vol and Volkan2 excess balance
console.log('2️⃣ Fixing Vol and Volkan2 excess balances...');

// Vol: needs to lose 2 blocks (balance=496, mined should be 494)
let volBlocksToRemove = 2;
let volBlocksRemoved = 0;
for (let i = db.grid.length - 1; i >= 0 && volBlocksRemoved < volBlocksToRemove; i--) {
  if (db.grid[i].dugBy === 'Vol') {
    db.grid[i].dugBy = null;
    if (db.grid[i].visual) db.grid[i].visual = null;
    if (db.grid[i].color) db.grid[i].color = null;
    volBlocksRemoved++;
  }
}

// Volkan2: needs to lose 2 blocks (balance=493, mined should be 491)
let volkan2BlocksToRemove = 2;
let volkan2BlocksRemoved = 0;
for (let i = db.grid.length - 1; i >= 0 && volkan2BlocksRemoved < volkan2BlocksToRemove; i--) {
  if (db.grid[i].dugBy === 'Volkan2') {
    db.grid[i].dugBy = null;
    if (db.grid[i].visual) db.grid[i].visual = null;
    if (db.grid[i].color) db.grid[i].color = null;
    volkan2BlocksRemoved++;
  }
}

console.log(`   Removed ${volBlocksRemoved} Vol blocks and ${volkan2BlocksRemoved} Volkan2 blocks`);

// 3. Fix Dgngntrkn excess warzone usage
console.log('3️⃣ Fixing Dgngntrkn excess warzone usage...');

// Dgngntrkn: needs to lose 3 warzone usage (used=1237, should be 1234)
let dgngUsageToRemove = 3;
let dgngUsageRemoved = 0;

// Strategy: Remove lowest defense blocks first, or reduce defense on higher blocks
for (let i = gridb.length - 1; i >= 0 && dgngUsageRemoved < dgngUsageToRemove; i--) {
  if (gridb[i] && gridb[i].owner === 'Dgngntrkn') {
    const currentDefense = gridb[i].defense || 1;
    
    if (currentDefense === 1) {
      // Remove the block entirely
      gridb[i] = { index: i, owner: null };
      dgngUsageRemoved += 1;
    } else {
      // Reduce defense
      const reductionNeeded = Math.min(dgngUsageToRemove - dgngUsageRemoved, currentDefense - 1);
      gridb[i].defense = currentDefense - reductionNeeded;
      dgngUsageRemoved += reductionNeeded;
    }
  }
}

console.log(`   Reduced Dgngntrkn warzone usage by ${dgngUsageRemoved}`);

// Create backups
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(dbPath, `${dbPath}.backup.${timestamp}`);
fs.copyFileSync(gridbPath, `${gridbPath}.backup.${timestamp}`);

// Write the fixed data
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
fs.writeFileSync(gridbPath, JSON.stringify(gridb, null, 2));

console.log('✅ Mismatches fixed! Backups created.');
console.log(`   Backup files: db.json.backup.${timestamp}, gridb.json.backup.${timestamp}`);

// Recount to verify
const newBlockCounts = {};
for (const block of db.grid) {
  if (block.dugBy) {
    newBlockCounts[block.dugBy] = (newBlockCounts[block.dugBy] || 0) + 1;
  }
}

const newWarzoneUsage = {};
for (const block of gridb) {
  if (block && block.owner) {
    newWarzoneUsage[block.owner] = (newWarzoneUsage[block.owner] || 0) + (block.defense || 1);
  }
}

console.log('\n📊 New blocks mined:');
console.log('- Vacatay:', newBlockCounts['Vacatay'] || 0);
console.log('- Vol:', newBlockCounts['Vol'] || 0);
console.log('- Volkan2:', newBlockCounts['Volkan2'] || 0);
console.log('- Dgngntrkn:', newBlockCounts['Dgngntrkn'] || 0);

console.log('\n⚔️ New warzone usage:');
console.log('- Vacatay:', newWarzoneUsage['Vacatay'] || 0);
console.log('- Vol:', newWarzoneUsage['Vol'] || 0);
console.log('- Volkan2:', newWarzoneUsage['Volkan2'] || 0);
console.log('- Dgngntrkn:', newWarzoneUsage['Dgngntrkn'] || 0);

