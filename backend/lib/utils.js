const crypto = require('crypto');

function genOpId() {
  try { return crypto.randomUUID(); }
  catch { return (Date.now().toString(36) + Math.random().toString(36).slice(2)); }
}

function resolveOpId(req, required = false) {
  try {
    const h = req.headers['x-op-id'] || req.headers['X-Op-Id'] || req.headers['x-op-id'.toLowerCase()];
    if (h && typeof h === 'string' && h.length <= 128) return h;
  } catch {}
  if (required) return null;
  return genOpId();
}

// Normalize a public key input into hex64. Accepts hex64, base64, or bech32 v1
function resolveAnyToHex64(input) {
  try {
    if (!input || typeof input !== 'string') return null;
    const s = input.trim();
    if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
    try {
      const hex = Buffer.from(s, 'base64').toString('hex');
      if (/^[0-9a-fA-F]{64}$/.test(hex)) return hex.toLowerCase();
    } catch {}
    try {
      if (s.startsWith('v1')) {
        const v = require('../volchain_chain.js');
        const snap = v.getSnapshot();
        const keys = Object.keys((snap && snap.balances) || {});
        for (const hex of keys) {
          try {
            const b64 = v.hexToB64(hex.toLowerCase());
            const addr = v.addrFromPub(b64);
            if (addr === s) return hex.toLowerCase();
          } catch {}
        }
      }
    } catch {}
    return null;
  } catch { return null; }
}

function resolveAnyKeyToHex64(input) {
  return resolveAnyToHex64(input);
}

module.exports = { genOpId, resolveOpId, resolveAnyToHex64, resolveAnyKeyToHex64 };


