/* Volchain Producer - keeps sealing mempool into blocks continuously */

process.title = 'volchain-producer';

try {
  const path = require('path');
  const fs = require('fs');
  const volchain = require('../volchain_chain.js');

  const INTERVAL_MS = Number(process.env.VOLCHAIN_PRODUCER_INTERVAL_MS || 1000);
  const BATCH_SIZE = Number(process.env.VOLCHAIN_PRODUCER_BATCH || 200);

  // Ensure data dir exists
  try {
    const dataDir = process.env.VOLCHAIN_DIR || path.join(__dirname, '..', 'volchain');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch {}

  // Aggressive flush loop: seal until mempool is empty each tick
  setInterval(() => {
    try {
      let loops = 0;
      let sealed = 0;
      while ((volchain.__mempoolSize && volchain.__mempoolSize()) > 0 && loops < 100) {
        const block = volchain.sealPending(10000);
        if (!block) break;
        sealed++;
        loops++;
      }
      if (sealed > 0) {
        const snap = volchain.getSnapshot();
        console.log(`[producer] sealed=${sealed} height=${snap?.height || 0} lastId=${snap?.lastId || 0} mempool=${volchain.__mempoolSize ? volchain.__mempoolSize() : 0}`);
      }
    } catch (e) {
      console.error('[producer] flush error:', e && e.message ? e.message : e);
    }
  }, INTERVAL_MS);

  // Periodic health log
  setInterval(() => {
    try {
      const snap = volchain.getSnapshot();
      const mb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
      const mp = volchain.__mempoolSize ? volchain.__mempoolSize() : 0;
      console.log(`[producer] health height=${snap?.height || 0} lastId=${snap?.lastId || 0} mempool=${mp} mem=${mb}MB`);
    } catch {}
  }, 10000);

  // Keep process alive
  setInterval(() => {}, 1 << 30);
} catch (e) {
  console.error('Producer failed to start:', e && e.message ? e.message : e);
  process.exit(1);
}


