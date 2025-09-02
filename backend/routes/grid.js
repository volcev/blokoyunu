const express = require('express');
const router = express.Router();
const { readDB, writeDB } = require('../lib/db');
const { readGridB, writeGridB } = require('../lib/gridb');

// GET /grid: Return Digzone grid
router.get('/grid', (req, res) => {
  try {
    const data = readDB();
    res.json(data.grid);
  } catch (e) {
    res.status(500).json({ error: 'failed' });
  }
});

// POST /expand: Expand grid by 100 blocks and keep GridB in sync
router.post('/expand', (req, res) => {
  try {
    const data = readDB();
    const currentLength = data.grid.length;
    const newBlocks = [];
    for (let i = 0; i < 100; i++) {
      newBlocks.push({ index: currentLength + i, dugBy: null, color: null, visual: null });
    }
    data.grid = data.grid.concat(newBlocks);
    writeDB(data);
    // Ensure GridB matches the same length
    let gridb = readGridB(data.grid.length);
    writeGridB(gridb);
    res.json({ added: 100, total: data.grid.length });
  } catch (e) {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;



