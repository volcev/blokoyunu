const fs = require("fs");

const TOTAL_BLOCKS = 100;
const grid = Array.from({ length: TOTAL_BLOCKS }, (_, i) => ({ index: i, dugBy: null, color: null }));

const data = { grid, users: [] };

fs.writeFileSync("db.json", JSON.stringify(data));
console.log("✅ db.json oluşturuldu.");