const fs = require('fs');
const path = require('path');

function getAdminSecret(){
  try { if (process.env.VOLCHAIN_ADMIN_SECRET && String(process.env.VOLCHAIN_ADMIN_SECRET).length > 0) return String(process.env.VOLCHAIN_ADMIN_SECRET); } catch {}
  try { const p = path.join(__dirname, '..', 'admin.secret'); if (fs.existsSync(p)) { const s = String(fs.readFileSync(p,'utf8')).trim(); if (s) return s; } } catch {}
  // default fallback to unify across processes
  return '06Sa954371v@';
}

module.exports = { getAdminSecret };



