const fs = require('fs');
const path = require('path');
const { readDB } = require('./db');

const GRIDB_FILE = process.env.GRIDB_PATH ? String(process.env.GRIDB_PATH) : path.join(__dirname, '..', 'gridb.json');

function atomicWriteJson(filePath, obj) {
  const tmp = filePath + '.new';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function readGridB(totalBlocks) {
  try {
    const raw = JSON.parse(fs.readFileSync(GRIDB_FILE, 'utf8'));
    // Normalize: ensure array of objects; replace null/invalid items with empty slot objects
    const arr = Array.isArray(raw) ? raw : [];
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      if (!it || typeof it !== 'object') {
        arr[i] = { index: i, owner: null, color: null, visual: null, userBlockIndex: null };
      } else {
        // Ensure required fields
        if (typeof it.index !== 'number') it.index = i;
        if (!('owner' in it)) it.owner = null;
        if (!('defense' in it)) it.defense = it.owner ? 1 : 0;
        if (!('color' in it)) it.color = null;
        if (!('visual' in it)) it.visual = null;
        if (!('userBlockIndex' in it)) it.userBlockIndex = null;
      }
    }
    if (arr.length < totalBlocks) {
      for (let i = arr.length; i < totalBlocks; i++) {
        arr.push({ index: i, owner: null, color: null, visual: null, userBlockIndex: null, defense: 0 });
      }
    }
    // Persist normalization if anything changed length or nulls were replaced
    fs.writeFileSync(GRIDB_FILE, JSON.stringify(arr, null, 2));
    return arr;
  } catch (e) {
    const arr = Array.from({ length: readDB().grid.length }, (_, i) => ({ index: i, owner: null, color: null, visual: null, userBlockIndex: null, defense: 0 }));
    fs.writeFileSync(GRIDB_FILE, JSON.stringify(arr, null, 2));
    return arr;
  }
}

function writeGridB(arr) {
  try {
    // Normalize on write as well
    const norm = Array.isArray(arr) ? arr.map((it, i) => {
      if (!it || typeof it !== 'object') return { index: i, owner: null, color: null, visual: null, userBlockIndex: null, defense: 0 };
      return {
        index: typeof it.index === 'number' ? it.index : i,
        owner: it.owner ?? null,
        color: it.color ?? null,
        visual: it.visual ?? null,
        userBlockIndex: it.userBlockIndex ?? null,
        defense: Number.isFinite(Number(it.defense)) ? Number(it.defense) : (it.owner ? 1 : 0)
      };
    }) : [];
    atomicWriteJson(GRIDB_FILE, norm);
  } catch (e) {
    // Fallback plain write
    fs.writeFileSync(GRIDB_FILE, JSON.stringify(arr, null, 2));
  }
}

module.exports = { GRIDB_FILE, readGridB, writeGridB };



