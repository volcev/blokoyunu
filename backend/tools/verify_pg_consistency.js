#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getPool } = require('../lib/pg');

function readJsonSafe(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }

async function main(){
  const pool = getPool();
  const dbPath = process.env.GAME_DB_PATH || path.join(__dirname, '..', 'db.json');
  const gridbPath = process.env.GRIDB_PATH || path.join(__dirname, '..', 'gridb.json');
  const db = readJsonSafe(dbPath);
  const gridb = readJsonSafe(gridbPath);
  if (!db || !Array.isArray(db.grid)) { console.error('JSON db.grid missing'); process.exit(2); }
  if (!Array.isArray(gridb)) { console.error('JSON gridb missing'); process.exit(2); }

  const digRows = (await pool.query('SELECT index, dug_by, owner, status, mined_seq, color, visual FROM dig_blocks ORDER BY index ASC')).rows;
  const gbRows = (await pool.query('SELECT index, owner, defense, color, visual, user_block_index FROM gridb_blocks ORDER BY index ASC')).rows;

  // Compare lengths
  const digEqualLen = db.grid.length === digRows.length;
  const gbEqualLen = gridb.length === gbRows.length;

  // Compare content
  let digMismatches = [];
  const minDig = Math.min(db.grid.length, digRows.length);
  for (let i=0;i<minDig;i++){
    const a = db.grid[i] || {}; const b = digRows[i] || {};
    const same = Number(a.index)===Number(b.index)
      && String(a.dugBy||'')===String(b.dug_by||'')
      && String(a.owner||'')===String(b.owner||'')
      && String(a.status||'')===String(b.status||'')
      && String(a.mined_seq||'')===String(b.mined_seq||'')
      && String(a.color||'')===String(b.color||'')
      && String(a.visual||'')===String(b.visual||'');
    if (!same) digMismatches.push({ index:i, file:a, pg:b });
  }

  let gbMismatches = [];
  const minGb = Math.min(gridb.length, gbRows.length);
  for (let i=0;i<minGb;i++){
    const a = gridb[i] || {}; const b = gbRows[i] || {};
    const same = Number(a.index)===Number(b.index) && String(a.owner||'')===String(b.owner||'') && Number(a.defense||0)===Number(b.defense||0) && String(a.color||'')===String(b.color||'') && String(a.visual||'')===String(b.visual||'') && Number(a.userBlockIndex||0)===Number(b.user_block_index||0);
    if (!same) gbMismatches.push({ index:i, file:a, pg:b });
  }

  const result = {
    ok: digEqualLen && gbEqualLen && digMismatches.length===0 && gbMismatches.length===0,
    dig: { fileLength: db.grid.length, pgLength: digRows.length, mismatches: digMismatches.slice(0,5), mismatchCount: digMismatches.length },
    gridb: { fileLength: gridb.length, pgLength: gbRows.length, mismatches: gbMismatches.slice(0,5), mismatchCount: gbMismatches.length }
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch(e=>{ console.error(e); process.exit(1); });


