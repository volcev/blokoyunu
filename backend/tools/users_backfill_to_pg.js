#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ensureSchema, getPool } = require('../lib/pg');

function readJsonSafe(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }

async function main(){
  await ensureSchema();
  const pool = getPool();
  const dbPath = process.env.GAME_DB_PATH || path.join(__dirname, '..', 'db.json');
  const db = readJsonSafe(dbPath) || { users: [] };
  const users = Array.isArray(db.users) ? db.users : [];
  const client = await pool.connect();
  let upserts = 0;
  try {
    await client.query('BEGIN');
    for (const u of users) {
      if (!u || !u.username) continue;
      await client.query(
        'INSERT INTO users(username, color, pow_pubkey, email, updated_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT (username) DO UPDATE SET color=EXCLUDED.color, pow_pubkey=EXCLUDED.pow_pubkey, email=EXCLUDED.email, updated_at=NOW()',
        [u.username, u.color || null, u.powPubkey || null, u.email || null]
      );
      upserts++;
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Users backfill failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
  console.log(JSON.stringify({ ok: process.exitCode !== 1, upserts }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });








