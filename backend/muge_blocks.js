#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

try {
  // db.json dosyasını oku
  const dbPath = path.join(__dirname, 'db.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  console.log('🔍 Muge\'nin kazdığı blokları inceliyorum...');

  let mugeBlocks = [];
  let totalMugeBlocks = 0;

  // Muge'nin kazdığı tüm blokları bul
  for (let i = 0; i < db.grid.length; i++) {
    const block = db.grid[i];
    if (block && block.dugBy === 'Muge') {
      totalMugeBlocks++;
      mugeBlocks.push({
        index: i,
        visual: block.visual,
        mined_seq: block.mined_seq,
        status: block.status || 'pending',
        owner: block.owner || null
      });
    }
  }

  console.log(`📊 Muge toplam: ${totalMugeBlocks} blok kazmış`);
  console.log(`📋 İlk 20 blok:`);

  mugeBlocks.slice(0, 20).forEach((block, idx) => {
    console.log(`   ${idx + 1}. Blok #${block.index} - Visual: ${block.visual || 'Yok'} - Status: ${block.status} - Owner: ${block.owner || 'Yok'}`);
  });

  if (mugeBlocks.length > 20) {
    console.log(`   ... ve ${mugeBlocks.length - 20} blok daha`);
  }

  // Tamamlanmış ve bekleyen blok sayıları
  const completedBlocks = mugeBlocks.filter(b => b.status === 'dug').length;
  const pendingBlocks = mugeBlocks.filter(b => b.status !== 'dug').length;

  console.log(`\n✅ Tamamlanmış bloklar: ${completedBlocks}`);
  console.log(`⏳ Bekleyen bloklar: ${pendingBlocks}`);

  // Visual dağılımı
  const visualStats = {};
  mugeBlocks.forEach(block => {
    const visual = block.visual || 'Yok';
    visualStats[visual] = (visualStats[visual] || 0) + 1;
  });

  console.log(`\n🎨 Visual dağılımı:`);
  Object.entries(visualStats)
    .sort(([,a], [,b]) => b - a)
    .forEach(([visual, count]) => {
      console.log(`   ${visual}: ${count} blok`);
    });

} catch (error) {
  console.error('❌ Hata:', error.message);
  process.exit(1);
}




