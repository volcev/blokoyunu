const { readDB, writeDB } = require('../lib/db');
const { readGridB, writeGridB } = require('../lib/gridb');
const { query, ensureSchema } = require('../lib/pg');

async function main() {
  await ensureSchema();

  const db = readDB();
  const grid = Array.isArray(db.grid) ? db.grid : [];
  const total = grid.length;
  const gridb = readGridB(total);

  let digPgUpserts = 0;
  let digFileUpdates = 0;
  let gridbPgUpserts = 0;
  let gridbFileUpdates = 0;

  // Load PG snapshots
  const digRowsRes = await query('SELECT index, dug_by, color, visual FROM dig_blocks ORDER BY index ASC');
  const digByIndex = new Map(digRowsRes.rows.map(r => [Number(r.index), r]));

  const gridbRowsRes = await query('SELECT index, owner, defense, color, visual, user_block_index FROM gridb_blocks ORDER BY index ASC');
  const gridbByIndex = new Map(gridbRowsRes.rows.map(r => [Number(r.index), r]));

  // Reconcile Dig (dug_by/color/visual only, matching current schema)
  for (let i = 0; i < total; i++) {
    const f = grid[i] || { index: i };
    const p = digByIndex.get(i) || null;
    const fDug = f.dugBy ?? null;
    const pDug = p ? (p.dug_by ?? null) : null;
    const fColor = f.color ?? null;
    const pColor = p ? (p.color ?? null) : null;
    const fVisual = f.visual ?? null;
    const pVisual = p ? (p.visual ?? null) : null;

    // Prefer non-null; if file has value and PG lacks or differs, push to PG
    const shouldPushToPg = (fDug != null && fDug !== pDug) || (fColor != null && fColor !== pColor) || (fVisual != null && fVisual !== pVisual) || (!p && (fDug != null || fColor != null || fVisual != null));
    if (shouldPushToPg) {
      await query(
        'INSERT INTO dig_blocks(index, dug_by, color, visual, ts) VALUES($1,$2,$3,$4,$5) ON CONFLICT (index) DO UPDATE SET dug_by=COALESCE(EXCLUDED.dug_by, dig_blocks.dug_by), color=COALESCE(EXCLUDED.color, dig_blocks.color), visual=COALESCE(EXCLUDED.visual, dig_blocks.visual), ts=EXCLUDED.ts',
        [i, fDug, fColor, fVisual, Date.now()]
      );
      digPgUpserts++;
      continue;
    }

    // If PG has value but file lacks, pull into file
    if ((pDug != null && fDug == null) || (pColor != null && fColor == null) || (pVisual != null && fVisual == null)) {
      grid[i] = {
        index: i,
        dugBy: fDug != null ? fDug : pDug,
        color: fColor != null ? fColor : pColor,
        visual: fVisual != null ? fVisual : pVisual,
        status: f.status ?? null,
        owner: f.owner ?? null,
        mined_seq: f.mined_seq ?? null,
      };
      digFileUpdates++;
    }
  }

  if (digFileUpdates > 0) {
    db.grid = grid;
    writeDB(db);
  }

  // Reconcile GridB (prefer file when it has stronger data like owner/defense)
  for (let i = 0; i < total; i++) {
    const f = gridb[i] || { index: i };
    const p = gridbByIndex.get(i) || null;
    const fOwner = f.owner ?? null;
    const pOwner = p ? (p.owner ?? null) : null;
    const fDefense = Number(f.defense || 0);
    const pDefense = Number((p && p.defense) || 0);
    const fColor = f.color ?? null;
    const pColor = p ? (p.color ?? null) : null;
    const fVisual = f.visual ?? null;
    const pVisual = p ? (p.visual ?? null) : null;
    const fUBI = f.userBlockIndex ?? null;
    const pUBI = p ? (p.user_block_index ?? null) : null;

    const fileHasSignal = (fOwner != null) || (fDefense > 0) || (fColor != null) || (fVisual != null) || (fUBI != null);

    // Push file -> PG if file has signal and PG differs or missing
    if (fileHasSignal && (!p || fOwner !== pOwner || fDefense !== pDefense || fColor !== pColor || fVisual !== pVisual || fUBI !== pUBI)) {
      await query(
        'INSERT INTO gridb_blocks(index, owner, defense, color, visual, user_block_index) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (index) DO UPDATE SET owner=COALESCE(EXCLUDED.owner, gridb_blocks.owner), defense=COALESCE(EXCLUDED.defense, gridb_blocks.defense), color=COALESCE(EXCLUDED.color, gridb_blocks.color), visual=COALESCE(EXCLUDED.visual, gridb_blocks.visual), user_block_index=COALESCE(EXCLUDED.user_block_index, gridb_blocks.user_block_index)',
        [i, fOwner, fDefense, fColor, fVisual, fUBI]
      );
      gridbPgUpserts++;
      continue;
    }

    // Pull PG -> file if PG has stronger signal and file lacks
    const pgHasSignal = (pOwner != null) || (pDefense > 0) || (pColor != null) || (pVisual != null) || (pUBI != null);
    if (pgHasSignal && (!fileHasSignal || (fOwner == null && pOwner != null) || (fDefense === 0 && pDefense > 0) || (fColor == null && pColor != null) || (fVisual == null && pVisual != null) || (fUBI == null && pUBI != null))) {
      gridb[i] = {
        index: i,
        owner: fOwner != null ? fOwner : pOwner,
        defense: fDefense > 0 ? fDefense : pDefense,
        color: fColor != null ? fColor : pColor,
        visual: fVisual != null ? fVisual : pVisual,
        userBlockIndex: fUBI != null ? fUBI : pUBI,
      };
      gridbFileUpdates++;
    }
  }

  if (gridbFileUpdates > 0) {
    writeGridB(gridb);
  }

  console.log(JSON.stringify({ ok: true, digPgUpserts, digFileUpdates, gridbPgUpserts, gridbFileUpdates }, null, 2));
}

if (require.main === module) {
  main().then(()=>process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}








