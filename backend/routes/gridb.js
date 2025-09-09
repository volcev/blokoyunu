const express = require('express');
const router = express.Router();
const { readDB } = require('../lib/db');
const { readGridB } = require('../lib/gridb');
const { buildStore } = require('../lib/store');
const logger = require('../lib/logger');

// GET /gridb: Return the current state of GridB
router.get('/gridb', async (req, res) => {
  try {
    const gridb = await buildStore().getGridB();
    // Ensure length matches Digzone for UI consistency
    const totalBlocks = readDB().grid.length;
    if (gridb.length < totalBlocks) {
      const filled = gridb.slice();
      for (let i = gridb.length; i < totalBlocks; i++) {
        filled.push({ index: i, owner: null, color: null, visual: null, userBlockIndex: null, defense: 0 });
      }
      return res.json(filled);
    }
    res.json(gridb);
  } catch (e) {
    try { logger.error('GET /gridb failed, falling back to file:', e?.message || e); } catch {}
    try {
      const totalBlocks = readDB().grid.length;
      const gridb = readGridB(totalBlocks);
      return res.json(gridb);
    } catch {
      return res.status(503).json({ error: 'unavailable' });
    }
  }
});

module.exports = router;



