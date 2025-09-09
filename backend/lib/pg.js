const { Pool } = require('pg');

let __pool = null;

function getPool() {
  if (__pool) return __pool;
  const connectionString = process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL || '';
  if (connectionString) {
    __pool = new Pool({ connectionString, ssl: process.env.PG_SSL === '1' ? { rejectUnauthorized: false } : undefined });
  } else {
    __pool = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || process.env.USER || 'postgres',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'blokoyunu'
    });
  }
  return __pool;
}

async function query(text, params) {
  const pool = getPool();
  return pool.query(text, params);
}

async function ensureSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dig_blocks (
      index INT PRIMARY KEY,
      dug_by TEXT NULL,
      color TEXT NULL,
      visual TEXT NULL,
      ts BIGINT NULL
    );
  `);
  await pool.query(`ALTER TABLE dig_blocks ADD COLUMN IF NOT EXISTS owner TEXT NULL;`);
  await pool.query(`ALTER TABLE dig_blocks ADD COLUMN IF NOT EXISTS mined_seq INT NULL;`);
  await pool.query(`ALTER TABLE dig_blocks ADD COLUMN IF NOT EXISTS status TEXT NULL;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gridb_blocks (
      index INT PRIMARY KEY,
      owner TEXT NULL,
      defense INT NOT NULL DEFAULT 0,
      color TEXT NULL,
      visual TEXT NULL,
      user_block_index INT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stats_kv (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      color TEXT NULL,
      pow_pubkey TEXT NULL UNIQUE,
      email TEXT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expiry BIGINT NULL;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      pubkey TEXT PRIMARY KEY,
      balance INT NOT NULL DEFAULT 0,
      staked INT NOT NULL DEFAULT 0,
      available INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at BIGINT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vol_events (
      id BIGSERIAL PRIMARY KEY,
      ts BIGINT,
      type TEXT,
      username TEXT NULL,
      pubkey TEXT NULL,
      amount INT NULL,
      reason TEXT NULL,
      grid_index INT NULL,
      op_id TEXT NULL,
      payload JSONB NULL
    );
  `);
}

module.exports = { getPool, query, ensureSchema };


