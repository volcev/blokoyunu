const { resolveOpId, genOpId } = require('../lib/utils');
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function enforceSecurityRequirements(req, requireOpId = true, requireChainId = true) {
  if (requireChainId) {
    const expectedChainId = process.env.CHAIN_ID || 'volchain-main';
    const chainIdHdr = req.headers['x-chain-id'] || req.headers['X-Chain-Id'] || req.headers['x-chain-id'.toLowerCase()];
    if (!chainIdHdr || String(chainIdHdr) !== expectedChainId) {
      return { error: !chainIdHdr ? 'CHAIN_ID required' : 'CHAIN_ID mismatch' };
    }
  }
  const opId = resolveOpId(req, requireOpId);
  if (requireOpId && !opId) return { error: 'op_id required in X-Op-Id header' };
  if (opId) {
    if (!UUID_V4_REGEX.test(String(opId))) return { error: 'invalid_op_id' };
  }
  return { opId: opId || genOpId() };
}

const __txRateMap = new Map();
function txRateLimiter(req, res, next) {
  try {
    const VOLCHAIN_TX_RATE_WINDOW_MS = Number(process.env.VOLCHAIN_TX_RATE_WINDOW_MS || 60000);
    const VOLCHAIN_TX_RATE_MAX = Number(process.env.VOLCHAIN_TX_RATE_MAX || 30);
    const whitelist = (process.env.VOLCHAIN_TX_IP_WHITELIST || '').split(',').map(s=>s.trim()).filter(Boolean);
    const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip || 'unknown';
    if (whitelist.length > 0 && whitelist.includes(ip)) return next();
    const now = Date.now();
    const rec = __txRateMap.get(ip) || { count: 0, resetAt: now + VOLCHAIN_TX_RATE_WINDOW_MS };
    if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + VOLCHAIN_TX_RATE_WINDOW_MS; }
    rec.count++; __txRateMap.set(ip, rec);
    if (rec.count > VOLCHAIN_TX_RATE_MAX) return res.status(429).json({ ok:false, error:'rate_limited' });
    return next();
  } catch { return next(); }
}

function txBodySizeGuard(req, res, next) {
  try {
    const limit = Number(process.env.VOLCHAIN_TX_MAX_BODY_BYTES || 2048);
    const lenHdr = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(lenHdr) && lenHdr > limit) return res.status(413).json({ ok:false, error:'request_entity_too_large' });
    const approx = Buffer.byteLength(JSON.stringify(req.body || {}));
    if (approx > limit) return res.status(413).json({ ok:false, error:'request_entity_too_large' });
    return next();
  } catch { return next(); }
}

module.exports = { enforceSecurityRequirements, txRateLimiter, txBodySizeGuard };


