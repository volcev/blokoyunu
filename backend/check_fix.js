const { readDB } = require('./lib/db');
const v = require('./volchain_chain.js');

const db = readDB();
const snap = v.getSnapshot();
const balances = snap?.balances || {};
const staked = snap?.staked || {};

console.log('🔍 DÜZELTME SONRASI KONTROL');
console.log('===========================');
console.log('');

// Database totals
const minedByUser = {};
for (const b of (db?.grid || [])) {
  if (b && b.dugBy) minedByUser[b.dugBy] = (minedByUser[b.dugBy] || 0) + 1;
}

const { readGridB } = require('./lib/gridb');
const gridb = readGridB((db?.grid || []).length);
let usedByUser = {};
for (const cell of (gridb || [])) {
  if (cell && cell.owner) {
    const def = Number(cell.defense || 1) || 1;
    usedByUser[cell.owner] = (usedByUser[cell.owner] || 0) + def;
  }
}

// User comparison
const users = Array.isArray(db?.users) ? db.users : [];
const activeUsers = users.filter(u => {
  const username = String(u?.username || '');
  return (minedByUser[username] || 0) > 0;
});

activeUsers.sort((a, b) => (minedByUser[b.username] || 0) - (minedByUser[a.username] || 0));

console.log('👥 KULLANICI BAZINDA KONTROL:');
console.log('=============================');

let totalProblems = 0;
const problemUsers = [];

activeUsers.forEach((u, index) => {
  const username = String(u?.username || '');
  const hex = (u && u.powPubkey && typeof u.powPubkey === 'string') ? u.powPubkey : null;
  
  const dbMined = minedByUser[username] || 0;
  const dbUsed = usedByUser[username] || 0;
  const dbAvailable = Math.max(0, dbMined - dbUsed);
  
  let volBalance = 0, volStaked = 0;
  if (hex) {
    const lower = hex.toLowerCase();
    const upper = hex.toUpperCase();
    volBalance = Number(balances[lower] ?? balances[upper] ?? 0);
    volStaked = Number(staked[lower] ?? staked[upper] ?? 0);
  }
  const volAvailable = Math.max(0, volBalance - volStaked);
  
  const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
  
  const balanceMatch = (dbMined === volBalance);
  const usedMatch = (dbUsed === volStaked);
  const availMatch = (dbAvailable === volAvailable);
  
  console.log(`${medal} ${(index + 1).toString().padStart(2)}: ${username.padEnd(12)} → ${balanceMatch && usedMatch && availMatch ? '✅ TUTARLI' : '❌ SORUNLU'}`);
  
  if (!balanceMatch || !usedMatch || !availMatch) {
    totalProblems++;
    problemUsers.push({
      username,
      dbMined, volBalance, balanceDiff: dbMined - volBalance,
      dbUsed, volStaked, usedDiff: dbUsed - volStaked
    });
    console.log(`     DB: Mined=${dbMined}, Used=${dbUsed}, Available=${dbAvailable}`);
    console.log(`     VC: Balance=${volBalance}, Staked=${volStaked}, Available=${volAvailable}`);
    console.log(`     Farklar: Balance=${dbMined-volBalance}, Used=${dbUsed-volStaked}, Available=${dbAvailable-volAvailable}`);
  }
});

// Totals
const totalDbMined = Object.values(minedByUser).reduce((sum, v) => sum + v, 0);
const totalDbUsed = Object.values(usedByUser).reduce((sum, v) => sum + v, 0);
const totalVolBalance = Object.values(balances).reduce((sum, v) => sum + Number(v || 0), 0);
const totalVolStaked = Object.values(staked).reduce((sum, v) => sum + Number(v || 0), 0);

console.log('');
console.log('📊 GENEL TOPLAM:');
console.log('================');
console.log(`DATABASE  → Mined: ${totalDbMined}, Used: ${totalDbUsed}, Available: ${totalDbMined - totalDbUsed}`);
console.log(`VOLCHAIN  → Balance: ${totalVolBalance}, Staked: ${totalVolStaked}, Available: ${totalVolBalance - totalVolStaked}`);

const minedMatch = totalDbMined === totalVolBalance;
const usedMatch = totalDbUsed === totalVolStaked;

console.log('');
console.log('🎯 SONUÇ:');
console.log('=========');
console.log(`Mined vs Balance: ${minedMatch ? '✅ TUTARLI' : '❌ UYUMSUZ'} (${totalDbMined} vs ${totalVolBalance})`);
console.log(`Used vs Staked: ${usedMatch ? '✅ TUTARLI' : '❌ UYUMSUZ'} (${totalDbUsed} vs ${totalVolStaked})`);
console.log(`Sorunlu kullanıcı sayısı: ${totalProblems}/10`);

if (totalProblems === 0 && minedMatch && usedMatch) {
  console.log('');
  console.log('🎉 BAŞARILI! TÜM VERİLER TUTARLI! 🎉');
  console.log('Volchain reset ve reseed işlemi tam olarak çalıştı.');
} else {
  console.log('');
  console.log('⚠️  HALA SORUNLAR VAR:');
  if (!minedMatch) console.log(`   - Total Balance farkı: ${totalDbMined - totalVolBalance}`);
  if (!usedMatch) console.log(`   - Total Staked farkı: ${totalDbUsed - totalVolStaked}`);
  if (totalProblems > 0) console.log(`   - ${totalProblems} kullanıcıda tutarsızlık`);
}
