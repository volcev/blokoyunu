#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

try {
  // Dosyaları oku
  const accountsPath = path.join(__dirname, 'accounts.json');
  const gridbPath = path.join(__dirname, 'gridb.json');
  const dbPath = path.join(__dirname, 'db.json');

  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
  const gridb = JSON.parse(fs.readFileSync(gridbPath, 'utf8'));
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  console.log('🔧 GridB hesaplarını düzeltiyorum...');

  // Her kullanıcı için gerçek değerleri hesapla
  const userStats = {};

  // Tüm kullanıcıları tara
  accounts.forEach(acc => {
    const username = acc.username;

    // GridB'deki gerçek used değeri
    const userBlocks = gridb.filter(b => b.owner === username);
    const realUsed = userBlocks.reduce((sum, b) => sum + (b.defense || 1), 0);

    // Digzone'deki gerçek mined değeri
    const realMined = db.grid.filter(b => b.dugBy === username).length;

    userStats[username] = {
      oldBalance: acc.balance,
      oldUsed: acc.used,
      oldAvailable: acc.available,
      realMined: realMined,
      realUsed: realUsed,
      realAvailable: Math.max(0, realMined - realUsed),
      newBalance: realMined
    };
  });

  // Hesapları güncelle
  let totalFixed = 0;
  accounts.forEach(acc => {
    const stats = userStats[acc.username];

    if (stats.oldUsed !== stats.realUsed ||
        stats.oldAvailable !== stats.realAvailable ||
        stats.oldBalance !== stats.realMined) {

      console.log(`🔄 ${acc.username}:`);
      console.log(`   Balance: ${stats.oldBalance} → ${stats.realMined}`);
      console.log(`   Used: ${stats.oldUsed} → ${stats.realUsed}`);
      console.log(`   Available: ${stats.oldAvailable} → ${stats.realAvailable}`);

      acc.balance = stats.realMined;
      acc.used = stats.realUsed;
      acc.available = stats.realAvailable;
      totalFixed++;
    }
  });

  if (totalFixed > 0) {
    // Backup oluştur
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(accountsPath, `${accountsPath}.backup.${timestamp}`);
    console.log(`\n💾 Backup oluşturuldu: accounts.json.backup.${timestamp}`);

    // Değişiklikleri kaydet
    fs.writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));
    console.log(`✅ ${totalFixed} kullanıcının hesabı düzeltildi`);

    // Yeni toplamları hesapla
    let totalBalance = 0, totalUsed = 0, totalAvailable = 0;
    accounts.forEach(acc => {
      totalBalance += acc.balance;
      totalUsed += acc.used;
      totalAvailable += acc.available;
    });

    console.log(`\n📊 Yeni toplamlar:`);
    console.log(`   Σ(Balance): ${totalBalance}`);
    console.log(`   Σ(Used): ${totalUsed}`);
    console.log(`   Σ(Available): ${totalAvailable}`);
    console.log(`   Toplam: ${totalUsed + totalAvailable}`);

  } else {
    console.log('ℹ️  Düzeltilecek hesap bulunamadı');
  }

} catch (error) {
  console.error('❌ Hata:', error.message);
  process.exit(1);
}




