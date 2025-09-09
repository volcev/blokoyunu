#!/usr/bin/env node
const { readFileSync } = require('fs');
const path = require('path');
const { getPool, ensureSchema } = require('../lib/pg');

async function main() {
  await ensureSchema();
  const pool = getPool();
  const dbPath = process.env.GAME_DB_PATH || path.join(__dirname, '..', 'db.json');
  const gridbPath = process.env.GRIDB_PATH || path.join(__dirname, '..', 'gridb.json');
  const db = JSON.parse(readFileSync(dbPath, 'utf8'));
  const gridb = JSON.parse(readFileSync(gridbPath, 'utf8'));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // dig_blocks upsert (include owner/status/mined_seq)
    for (const b of (db.grid || [])) {
      await client.query(
        'INSERT INTO dig_blocks(index, dug_by, owner, status, mined_seq, color, visual, ts) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (index) DO UPDATE SET dug_by=EXCLUDED.dug_by, owner=EXCLUDED.owner, status=EXCLUDED.status, mined_seq=EXCLUDED.mined_seq, color=EXCLUDED.color, visual=EXCLUDED.visual, ts=EXCLUDED.ts',
        [Number(b.index), b.dugBy || null, b.owner || null, b.status || null, b.mined_seq || null, b.color || null, b.visual || null, Date.now()]
      );
    }
    // gridb_blocks upsert
    for (let i = 0; i < gridb.length; i++) {
      const it = gridb[i] || { index: i };
      await client.query(
        'INSERT INTO gridb_blocks(index, owner, defense, color, visual, user_block_index) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (index) DO UPDATE SET owner=EXCLUDED.owner, defense=EXCLUDED.defense, color=EXCLUDED.color, visual=EXCLUDED.visual, user_block_index=EXCLUDED.user_block_index',
        [Number(it.index ?? i), it.owner || null, Number(it.defense || 0), it.color || null, it.visual || null, it.userBlockIndex || null]
      );
    }
    await client.query('COMMIT');
    console.log('Migration completed');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });


