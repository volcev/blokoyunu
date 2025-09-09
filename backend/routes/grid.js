const express = require('express');
const router = express.Router();
const { readDB, writeDB } = require('../lib/db');
const { readGridB, writeGridB } = require('../lib/gridb');
const { buildStore } = require('../lib/store');
const logger = require('../lib/logger');

// GET /grid: Return Digzone grid
router.get('/grid', async (req, res) => {
  try {
    const grid = await buildStore().getDigGrid();
    res.json(grid);
  } catch (e) {
    try { logger.error('GET /grid failed, falling back to file:', e?.message || e); } catch {}
    try {
      const data = readDB();
      return res.json(Array.isArray(data.grid) ? data.grid : []);
    } catch {
      return res.status(503).json({ error: 'unavailable' });
    }
  }
});

// POST /expand: Expand grid by 100 blocks and keep GridB in sync
router.post('/expand', async (req, res) => {
  try {
    const data = readDB();
    const currentLength = data.grid.length;
    const newBlocks = [];
    for (let i = 0; i < 100; i++) {
      newBlocks.push({ index: currentLength + i, dugBy: null, color: null, visual: null });
    }
    data.grid = data.grid.concat(newBlocks);
    writeDB(data);
    // Dual-write new grid to PG as well
    try { await store.putDigGrid(data.grid); } catch {}
    // Ensure GridB matches the same length
    let gridb = readGridB(data.grid.length);
    writeGridB(gridb);
    try { await store.putGridB(gridb); } catch {}
    res.json({ added: 100, total: data.grid.length });
  } catch (e) {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;



