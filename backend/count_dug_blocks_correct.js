#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

try {
  // db.json dosyasını oku
  const dbPath = path.join(__dirname, 'db.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  console.log('🔍 Digzone kazılmış blok sayısı doğru şekilde hesaplanıyor...');

  let totalDugBlocks = 0;
  let blocksWithStatusDug = 0;
  let blocksWithDugBy = 0;
  let blocksWithOwner = 0;

  // Grid'deki tüm blokları kontrol et
  for (const block of db.grid) {
    if (block) {
      // Farklı kriterlere göre say
      if (block.status === 'dug') {
        blocksWithStatusDug++;
      }
      if (block.dugBy) {
        blocksWithDugBy++;
      }
      if (block.owner) {
        blocksWithOwner++;
      }
    }
  }

  // En güvenilir sayım: dugBy alanı dolu olan bloklar
  totalDugBlocks = blocksWithDugBy;

  console.log('📊 Sonuçlar:');
  console.log(`   dugBy alanı dolu olan bloklar: ${blocksWithDugBy}`);
  console.log(`   Status 'dug' olan bloklar: ${blocksWithStatusDug}`);
  console.log(`   owner alanı dolu olan bloklar: ${blocksWithOwner}`);

  console.log(`\n🎯 Digzone'da kazılmış toplam blok sayısı: ${totalDugBlocks}`);

  // Kullanıcı bazlı istatistikler (dugBy alanına göre)
  const userStats = {};
  for (const block of db.grid) {
    if (block && block.dugBy) {
      userStats[block.dugBy] = (userStats[block.dugBy] || 0) + 1;
    }
  }

  console.log('\n👥 Kullanıcı bazlı dağılım (dugBy alanına göre):');
  Object.entries(userStats)
    .sort(([,a], [,b]) => b - a)
    .forEach(([user, count]) => {
      console.log(`   ${user}: ${count} blok`);
    });

} catch (error) {
  console.error('❌ Hata:', error.message);
  process.exit(1);
}




