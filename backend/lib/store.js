// Store abstraction with FileStore and PgStore, dual-write capable
const { readDB, writeDB } = require('./db');
const { readGridB, writeGridB } = require('./gridb');
const { query, ensureSchema } = require('./pg');

class FileStore {
  async getDigGrid() {
    const data = readDB();
    return Array.isArray(data.grid) ? data.grid : [];
  }
  async putDigGrid(grid) {
    const data = readDB();
    data.grid = Array.isArray(grid) ? grid : [];
    writeDB(data);
  }
  async getGridB() {
    const total = readDB().grid.length;
    return readGridB(total);
  }
  async putGridB(arr) {
    writeGridB(arr);
  }
  async upsertDigRow(row) {
    const data = readDB();
    const idx = Number(row.index);
    if (!Array.isArray(data.grid)) data.grid = [];
    if (!data.grid[idx]) data.grid[idx] = { index: idx, dugBy: null, color: null, visual: null };
    const target = data.grid[idx];
    if (Object.prototype.hasOwnProperty.call(row, 'dugBy') && row.dugBy != null) target.dugBy = row.dugBy;
    if (Object.prototype.hasOwnProperty.call(row, 'color') && row.color != null) target.color = row.color;
    if (Object.prototype.hasOwnProperty.call(row, 'visual') && row.visual != null) target.visual = row.visual;
    writeDB(data);
  }
  async upsertDigGridRow(row) {
    // Accept snake_case or camelCase input
    const mapped = {
      index: Number(row.index),
      dugBy: row.dug_by ?? row.dugBy ?? null,
      color: row.color ?? null,
      visual: row.visual ?? null,
    };
    return this.upsertDigRow(mapped);
  }
  async upsertGridBRow(row) {
    const total = readDB().grid.length;
    const arr = readGridB(total);
    const idx = Number(row.index);
    if (!arr[idx]) arr[idx] = { index: idx, owner: null, defense: 0, color: null, visual: null, userBlockIndex: null };
    const target = arr[idx];
    if (Object.prototype.hasOwnProperty.call(row, 'owner') && row.owner != null) target.owner = row.owner;
    if (Object.prototype.hasOwnProperty.call(row, 'defense') && row.defense != null) target.defense = Number(row.defense || 0);
    if (Object.prototype.hasOwnProperty.call(row, 'color') && row.color != null) target.color = row.color;
    if (Object.prototype.hasOwnProperty.call(row, 'visual') && row.visual != null) target.visual = row.visual;
    if (Object.prototype.hasOwnProperty.call(row, 'userBlockIndex') && row.userBlockIndex != null) target.userBlockIndex = row.userBlockIndex;
    writeGridB(arr);
  }
}

class PgStore {
  constructor() {
    this.ready = ensureSchema().catch(()=>{});
  }
  // Per-row upserts for GridB and Dig
  async getDigGrid() {
    await this.ready;
    const { rows } = await query('SELECT index, dug_by, owner, status, mined_seq, color, visual, ts FROM dig_blocks ORDER BY index ASC');
    return rows.map(r => ({ index: r.index, dugBy: r.dug_by || null, owner: r.owner || null, status: r.status || null, mined_seq: r.mined_seq || null, color: r.color || null, visual: r.visual || null }));
  }
  async putDigGrid(grid) {
    await this.ready;
    const client = (await require('./pg').getPool().connect());
    try {
      await client.query('BEGIN');
      for (const b of grid) {
        await client.query(
          'INSERT INTO dig_blocks(index, dug_by, owner, status, mined_seq, color, visual, ts) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (index) DO UPDATE SET dug_by=EXCLUDED.dug_by, owner=EXCLUDED.owner, status=EXCLUDED.status, mined_seq=EXCLUDED.mined_seq, color=EXCLUDED.color, visual=EXCLUDED.visual, ts=EXCLUDED.ts',
          [b.index, b.dugBy || null, b.owner || null, b.status || null, b.mined_seq || null, b.color || null, b.visual || null, Date.now()]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }
  async upsertDigRow(row) {
    await this.ready;
    const { index, dugBy, owner, status, mined_seq, color, visual } = row;
    await query('INSERT INTO dig_blocks(index, dug_by, owner, status, mined_seq, color, visual, ts) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (index) DO UPDATE SET dug_by=COALESCE(EXCLUDED.dug_by, dig_blocks.dug_by), owner=COALESCE(EXCLUDED.owner, dig_blocks.owner), status=COALESCE(EXCLUDED.status, dig_blocks.status), mined_seq=COALESCE(EXCLUDED.mined_seq, dig_blocks.mined_seq), color=COALESCE(EXCLUDED.color, dig_blocks.color), visual=COALESCE(EXCLUDED.visual, dig_blocks.visual), ts=EXCLUDED.ts', [index, dugBy || null, owner || null, status || null, mined_seq || null, color || null, visual || null, Date.now()]);
  }
  async upsertDigGridRow(row) {
    const mapped = {
      index: Number(row.index),
      dugBy: row.dug_by ?? row.dugBy ?? null,
      owner: row.owner ?? null,
      status: row.status ?? null,
      mined_seq: row.mined_seq ?? null,
      color: row.color ?? null,
      visual: row.visual ?? null,
    };
    return this.upsertDigRow(mapped);
  }
  async getGridB() {
    await this.ready;
    const { rows } = await query('SELECT index, owner, defense, color, visual, user_block_index FROM gridb_blocks ORDER BY index ASC');
    return rows.map(r => ({ index: r.index, owner: r.owner || null, defense: Number(r.defense || 0), color: r.color || null, visual: r.visual || null, userBlockIndex: r.user_block_index || null }));
  }
  async putGridB(arr) {
    await this.ready;
    const client = (await require('./pg').getPool().connect());
    try {
      await client.query('BEGIN');
      for (const it of arr) {
        await client.query(
          'INSERT INTO gridb_blocks(index, owner, defense, color, visual, user_block_index) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (index) DO UPDATE SET owner=EXCLUDED.owner, defense=EXCLUDED.defense, color=EXCLUDED.color, visual=EXCLUDED.visual, user_block_index=EXCLUDED.user_block_index',
          [it.index, it.owner || null, Number(it.defense || 0), it.color || null, it.visual || null, it.userBlockIndex || null]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }
  async upsertGridBRow(row) {
    await this.ready;
    const { index, owner, defense, color, visual, userBlockIndex } = row;
    await query('INSERT INTO gridb_blocks(index, owner, defense, color, visual, user_block_index) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (index) DO UPDATE SET owner=COALESCE(EXCLUDED.owner, gridb_blocks.owner), defense=COALESCE(EXCLUDED.defense, gridb_blocks.defense), color=COALESCE(EXCLUDED.color, gridb_blocks.color), visual=COALESCE(EXCLUDED.visual, gridb_blocks.visual), user_block_index=COALESCE(EXCLUDED.user_block_index, gridb_blocks.user_block_index)', [index, owner || null, Number(defense || 0), color || null, visual || null, userBlockIndex || null]);
  }
  // Users/accounts/events
  async upsertUser({ username, color, pow_pubkey, email }) {
    await this.ready;
    await query('INSERT INTO users(username, color, pow_pubkey, email, updated_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT (username) DO UPDATE SET color=EXCLUDED.color, pow_pubkey=EXCLUDED.pow_pubkey, email=EXCLUDED.email, updated_at=NOW()', [username, color || null, pow_pubkey || null, email || null]);
  }
  async upsertAccount({ pubkey, balance, staked, available }) {
    await this.ready;
    await query('INSERT INTO accounts(pubkey, balance, staked, available, updated_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT (pubkey) DO UPDATE SET balance=EXCLUDED.balance, staked=EXCLUDED.staked, available=EXCLUDED.available, updated_at=NOW()', [pubkey, Number(balance||0), Number(staked||0), Number(available||0)]);
  }
  async appendVolEvent(evt) {
    await this.ready;
    const { ts, type, username, pubkey, amount, reason, gridIndex, op_id, payload } = evt || {};
    await query('INSERT INTO vol_events(ts, type, username, pubkey, amount, reason, grid_index, op_id, payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [Number(ts||Date.now()), String(type||''), username||null, pubkey||null, Number(amount||0)||null, reason||null, Number(gridIndex||0)||null, op_id||null, payload?JSON.stringify(payload):null]);
  }
}

class DualStore {
  constructor(primary, secondary) {
    this.primary = primary; // Prefer PG as primary in zero-downtime rollout
    this.secondary = secondary; // File as fallback
  }
  async getDigGrid() {
    // Read both and choose the richer dataset to avoid empty-PG masking
    let p = null, s = null;
    try { p = await this.primary.getDigGrid(); } catch {}
    try { s = await this.secondary.getDigGrid(); } catch {}
    if (Array.isArray(p) && Array.isArray(s)) {
      return (s.length > p.length) ? s : p;
    }
    if (Array.isArray(p)) return p;
    if (Array.isArray(s)) return s;
    return [];
  }
  async putDigGrid(grid) {
    const errors = [];
    try { await this.primary.putDigGrid(grid); } catch (e) { errors.push(e); }
    try { await this.secondary.putDigGrid(grid); } catch (e) { errors.push(e); }
    if (errors.length === 2) throw errors[0];
  }
  async getGridB() {
    // Read both and choose the richer dataset (more staked/owned entries wins)
    let p = null, s = null;
    try { p = await this.primary.getGridB(); } catch {}
    try { s = await this.secondary.getGridB(); } catch {}
    const score = (arr) => Array.isArray(arr) ? arr.reduce((acc, b) => acc + ((b && b.owner) ? 1 : 0), 0) : -1;
    const lp = score(p), ls = score(s);
    if (lp >= 0 && ls >= 0) {
      // Prefer the one with more owned cells; tie-break by length
      if (ls > lp) return s; if (lp > ls) return p; return (Array.isArray(s) && Array.isArray(p) ? (s.length > p.length ? s : p) : (p || s || []));
    }
    if (lp >= 0) return p;
    if (ls >= 0) return s;
    return [];
  }
  async putGridB(arr) {
    const errors = [];
    try { await this.primary.putGridB(arr); } catch (e) { errors.push(e); }
    try { await this.secondary.putGridB(arr); } catch (e) { errors.push(e); }
    if (errors.length === 2) throw errors[0];
  }
  async upsertDigRow(row) {
    const errors = [];
    try { await this.primary.upsertDigRow(row); } catch (e) { errors.push(e); }
    try { await this.secondary.upsertDigRow(row); } catch (e) { errors.push(e); }
    if (errors.length === 2) throw errors[0];
  }
  async upsertDigGridRow(row) {
    const normalized = {
      index: Number(row.index),
      dugBy: row.dug_by ?? row.dugBy ?? null,
      color: row.color ?? null,
      visual: row.visual ?? null,
    };
    return this.upsertDigRow(normalized);
  }
  async upsertGridBRow(row) {
    const errors = [];
    try { await this.primary.upsertGridBRow(row); } catch (e) { errors.push(e); }
    try { await this.secondary.upsertGridBRow(row); } catch (e) { errors.push(e); }
    if (errors.length === 2) throw errors[0];
  }
}

function buildStore() {
  const mode = String(process.env.STORE_MODE || 'dual').toLowerCase();
  const file = new FileStore();
  if (mode === 'file') return file;
  const pg = new PgStore();
  if (mode === 'pg') return pg;
  return new DualStore(pg, file);
}

module.exports = { FileStore, PgStore, DualStore, buildStore };


