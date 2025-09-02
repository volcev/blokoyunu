#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

try {
  // db.json dosyasını oku
  const dbPath = path.join(__dirname, 'db.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  console.log('🔧 Muge\'nin eksik bloklarını düzeltiyorum...');

  let fixedBlocks = 0;

  // Muge'nin dugBy alanı dolu ama status/owner eksik olan bloklarını düzelt
  for (let i = 0; i < db.grid.length; i++) {
    const block = db.grid[i];
    if (block && block.dugBy === 'Muge' && (!block.status || !block.owner)) {
      block.status = 'dug';
      block.owner = 'Muge';
      // mined_seq ekle (eğer yoksa)
      if (!block.mined_seq) {
        // Basit bir sequence numarası ver
        block.mined_seq = 999000 + fixedBlocks + 1;
      }
      fixedBlocks++;
    }
  }

  if (fixedBlocks > 0) {
    // Backup oluştur
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(dbPath, `${dbPath}.backup.${timestamp}`);
    console.log(`💾 Backup oluşturuldu: db.json.backup.${timestamp}`);

    // Değişiklikleri kaydet
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    console.log(`✅ ${fixedBlocks} blok düzeltildi ve kaydedildi`);

    // Stats'i güncelle
    const statsPath = path.join(__dirname, 'stats.json');
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    stats.total_supply = Number(stats.total_supply || 0) + fixedBlocks;
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    console.log(`📊 Stats güncellendi: total_supply += ${fixedBlocks}`);

  } else {
    console.log('ℹ️  Düzeltilecek blok bulunamadı');
  }

} catch (error) {
  console.error('❌ Hata:', error.message);
  process.exit(1);
}




