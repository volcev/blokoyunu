console.log('=== BLOKLARA TIMESTAMP EKLEME ===');

const { readDB, writeDB } = require('./lib/db');
const db = readDB();

let updatedBlocks = 0;

// Tüm bloklara timestamp ekle
db.grid.forEach((block, index) => {
  if (block && !block.ts && block.mined_seq) {
    const baseTime = Date.now() - (db.grid.length - block.mined_seq) * 1000;
    block.ts = baseTime;
    updatedBlocks++;
  }
});

console.log('Timestamp eklenecek blok sayısı:', updatedBlocks);

// DB'yi kaydet
writeDB(db);

console.log('✅ Timestamp ekleme tamamlandı');

// Kontrol et
const updatedDB = readDB();
const validTimestamps = updatedDB.grid.filter(b => b && b.ts).length;
console.log('Geçerli timestamp blok sayısı:', validTimestamps);
