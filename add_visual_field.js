const fs = require('fs');

const DB_FILE = './backend/db.json';

try {
  // db.json'u oku
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

  // Her bloğa visual: null ekle
  db.grid = db.grid.map(block => ({
    ...block,
    visual: block.visual || null // Mevcut visual varsa koru, yoksa null
  }));

  // Güncellenmiş veriyi db.json'a yaz
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  console.log('✅ db.json güncellendi, tüm bloklara visual: null eklendi.');
} catch (error) {
  console.error('Hata:', error.message);
}