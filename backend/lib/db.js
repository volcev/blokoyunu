const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.GAME_DB_PATH ? String(process.env.GAME_DB_PATH) : path.join(__dirname, '..', 'db.json');

function readDB() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!Array.isArray(data.grid)) data.grid = [];
    if (!Array.isArray(data.users)) data.users = [];
    return data;
  } catch {
    return { grid: [], users: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

module.exports = { DB_FILE, readDB, writeDB };



