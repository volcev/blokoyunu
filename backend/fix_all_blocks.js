#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

try {
  // db.json dosyasını oku
  const dbPath = path.join(__dirname, 'db.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  console.log('🔧 Tüm kullanıcıların eksik bloklarını düzeltiyorum...');

  let totalFixedBlocks = 0;
  const userFixes = {};

  // Tüm grid'i tara ve dugBy dolu ama status/owner eksik olan blokları düzelt
  for (let i = 0; i < db.grid.length; i++) {
    const block = db.grid[i];
    if (block && block.dugBy && (!block.status || !block.owner)) {
      const username = block.dugBy;

      // Eski status'u kaydet
      const oldStatus = block.status || 'none';
      const oldOwner = block.owner || 'none';

      // Blok'u dug olarak işaretle
      block.status = 'dug';
      block.owner = username;

      // mined_seq ekle (eğer yoksa)
      if (!block.mined_seq) {
        // Basit bir sequence numarası ver (yüksek sayıdan başla)
        block.mined_seq = 999000 + totalFixedBlocks + 1;
      }

      // Kullanıcı istatistiklerini güncelle
      if (!userFixes[username]) {
        userFixes[username] = { count: 0, oldStatus: oldStatus, oldOwner: oldOwner };
      }
      userFixes[username].count++;

      totalFixedBlocks++;
    }
  }

  if (totalFixedBlocks > 0) {
    console.log(`📊 Toplam ${totalFixedBlocks} blok düzeltilecek`);

    // Kullanıcı bazlı rapor
    console.log('\n👥 Kullanıcı bazlı düzeltmeler:');
    Object.entries(userFixes)
      .sort(([,a], [,b]) => b.count - a.count)
      .forEach(([username, data]) => {
        console.log(`   ${username}: ${data.count} blok (${data.oldStatus} → dug, ${data.oldOwner} → ${username})`);
      });

    // Backup oluştur
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(dbPath, `${dbPath}.backup.${timestamp}`);
    console.log(`\n💾 Backup oluşturuldu: db.json.backup.${timestamp}`);

    // Değişiklikleri kaydet
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    console.log(`✅ ${totalFixedBlocks} blok düzeltildi ve kaydedildi`);

    // Stats'i güncelle
    const statsPath = path.join(__dirname, 'stats.json');
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    stats.total_supply = Number(stats.total_supply || 0) + totalFixedBlocks;
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    console.log(`📊 Stats güncellendi: total_supply += ${totalFixedBlocks}`);

    // Accounts'u yeniden hesapla
    console.log('\n🔄 Accounts yeniden hesaplanıyor...');
    const accountsPath = path.join(__dirname, 'accounts.json');

    // Grid'den mined bilgilerini hesapla
    const minedByUser = {};
    const usedByUser = {};

    for (const block of db.grid) {
      if (block && block.status === 'dug' && block.owner) {
        minedByUser[block.owner] = (minedByUser[block.owner] || 0) + 1;
      }
    }

    // GridB'den used bilgilerini hesapla
    const gridbPath = path.join(__dirname, 'gridb.json');
    const gridb = JSON.parse(fs.readFileSync(gridbPath, 'utf8'));
    for (const block of gridb) {
      if (block && block.owner) {
        usedByUser[block.owner] = (usedByUser[block.owner] || 0) + Math.max(1, Number(block.defense || 1));
      }
    }

    // Accounts'u güncelle
    const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    const accountsMap = new Map(accounts.map(acc => [acc.username, acc]));

    // Tüm kullanıcıları tara
    const allUsers = new Set([...Object.keys(minedByUser), ...Object.keys(usedByUser)]);
    for (const username of allUsers) {
      const mined = Number(minedByUser[username] || 0);
      const used = Math.min(Number(usedByUser[username] || 0), mined);
      const available = Math.max(0, mined - used);

      let account = accountsMap.get(username);
      if (!account) {
        account = { username, balance: 0, used: 0, available: 0 };
        accounts.push(account);
        accountsMap.set(username, account);
      }

      account.balance = mined;
      account.used = used;
      account.available = available;
    }

    // Accounts'u kaydet
    fs.writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));
    console.log('✅ Accounts güncellendi');

    console.log('\n🎉 Tüm bloklar başarıyla düzeltildi!');

  } else {
    console.log('ℹ️  Düzeltilecek blok bulunamadı');
  }

} catch (error) {
  console.error('❌ Hata:', error.message);
  process.exit(1);
}




