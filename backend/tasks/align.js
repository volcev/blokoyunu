const path = require('path');

function initPeriodicStakeAlign() {
  try {
    const { readDB } = require('../lib/db');
    const { readGridB } = require('../lib/gridb');
    const volchain = require('../volchain_chain.js');
    const { genOpId } = require('../lib/utils');

    async function alignOnce() {
      try {
        const db = readDB();
        const totalBlocks = db.grid.length;
        const gridb = readGridB(totalBlocks);

        // desired staked per username from GridB (mirror UI logic)
        const desiredByUser = {};
        for (const b of gridb) {
          if (b && b.owner) {
            const d = Math.max(1, Number(b.defense || 1));
            desiredByUser[b.owner] = (desiredByUser[b.owner] || 0) + d;
          }
        }

        // map username -> pubkey
        const userToPub = {};
        for (const u of (db.users || [])) {
          if (u && u.username && u.powPubkey) userToPub[u.username] = String(u.powPubkey);
        }

        // current staked snapshot
        const snap = volchain.getSnapshot();
        const currentStaked = (snap && snap.staked) ? snap.staked : {};

        let stakeTotal = 0;
        let unstakeTotal = 0;

        for (const [username, target] of Object.entries(desiredByUser)) {
          const pub = userToPub[username];
          if (!pub) continue;
          const pk = String(pub);
          let have = 0;
          if (Object.prototype.hasOwnProperty.call(currentStaked, pk)) have = currentStaked[pk];
          else if (Object.prototype.hasOwnProperty.call(currentStaked, pk.toLowerCase())) have = currentStaked[pk.toLowerCase()];
          else if (Object.prototype.hasOwnProperty.call(currentStaked, pk.toUpperCase())) have = currentStaked[pk.toUpperCase()];
          have = Number(have || 0);

          const delta = Number(target) - have;
          if (delta > 0) {
            const opId = genOpId();
            volchain.appendEvent({ type:'stake', username, pubkey: pub, amount: delta, reason:'periodic_align', op_id: opId, memo:{ op_id: opId, reason:'periodic_align' } });
            stakeTotal += delta;
          } else if (delta < 0) {
            const amt = Math.abs(delta);
            const opId = genOpId();
            volchain.appendEvent({ type:'unstake', username, pubkey: pub, amount: amt, reason:'periodic_align', op_id: opId, memo:{ op_id: opId, reason:'periodic_align' } });
            unstakeTotal += amt;
          }
        }
        return { ok: true, stakeTotal, unstakeTotal };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // Run once on init, then every minute
    alignOnce().catch(() => {});
    setInterval(() => { alignOnce().catch(() => {}); }, 60 * 1000);
  } catch {}
}

module.exports = { initPeriodicStakeAlign };


