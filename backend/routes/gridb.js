const express = require('express');
const router = express.Router();
const { readDB } = require('../lib/db');
const { readGridB } = require('../lib/gridb');

// GET /gridb: Return the current state of GridB
router.get('/gridb', (req, res) => {
  try {
    const totalBlocks = readDB().grid.length;
    const gridb = readGridB(totalBlocks);
    res.json(gridb);
  } catch (e) {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;



