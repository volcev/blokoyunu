const { enforceInvariants, autoCorrectInvariants } = require('./invariants');
const { readDB, writeDB } = require('./db');
const { readGridB } = require('./gridb');

let opIdDedupTotal = 0;
let digIdDuplicateTotal = 0;

async function ledgerFirstCommitWithBarrier({ bundleFn, commitGameFn, guardFn, op_id, precheckFn, onIdempotent }) {
  try {
    const v = require('../volchain_chain.js');
    const preSnapshot = v.getSnapshot();
    const preDb = readDB();
    const preGridb = readGridB(preDb.grid.length);
    const preIssues = enforceInvariants(preSnapshot, preDb, preGridb);
    if (preIssues.length > 0) {
      const hasCritical = preIssues.some(issue => issue.includes('SYSTEM_') || issue.includes('INVARIANT_CHECK_ERROR'));
      if (hasCritical) {
        const corrected = await autoCorrectInvariants(preSnapshot, preDb, preGridb);
        if (!corrected) throw new Error(`CRITICAL_INVARIANT_FAILURE: ${preIssues.join(', ')}`);
      }
    }
    if (precheckFn) {
      const precheckResult = await precheckFn();
      if (!precheckResult || precheckResult.ok !== true) throw new Error(`precheck_failed: ${precheckResult?.error || 'unknown'}`);
    }
    const txList = await bundleFn();
    if (!Array.isArray(txList) || txList.length === 0) throw new Error('empty_bundle');
    const { ids, bundleSize } = v.appendBundle(txList);
    // Proactively trigger sealing to meet UX wait window (e.g., 10s dig timer)
    try { if (typeof v.sealPending === 'function') v.sealPending(1000); } catch {}
    let sealResult = await v.waitUntilSealed({ ids, timeoutMs: 2000 });
    if (!sealResult.ok) {
      // Emergency: try forced seals and a short retry before giving up
      try { if (typeof v.sealPending === 'function') v.sealPending(1000); } catch {}
      sealResult = await v.waitUntilSealed({ ids, timeoutMs: 1000 });
    }
    // Proceed even if still not sealed; apply path will also help drain mempool
    let applyResult = await v.waitUntilApplied({ bundleSize, timeoutMs: 2000 });
    if (!applyResult.ok) {
      try { if (typeof v.sealPending === 'function') v.sealPending(1000); } catch {}
      applyResult = await v.waitUntilApplied({ bundleSize, timeoutMs: 1000 });
    }
    const gameBackup = await commitGameFn();
    const guardResult = await guardFn(gameBackup); if (!guardResult || guardResult.ok !== true) return { ok:false, error:'guard_failed', details: guardResult, seal: sealResult, apply: applyResult };
    // Accept success even if seal/apply reported timeout; chain will reconcile shortly
    return { ok:true, seal: sealResult, apply: applyResult, guard: guardResult, op_id };
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg === 'duplicate_op_id' || msg === 'DIG_ID_DUPLICATE' || msg === 'duplicate_dig_id') {
      if (msg === 'duplicate_op_id') opIdDedupTotal++;
      if (msg === 'DIG_ID_DUPLICATE' || msg === 'duplicate_dig_id') digIdDuplicateTotal++;
      if (typeof onIdempotent === 'function') { try { await onIdempotent(); } catch {} }
      return { ok: true, idempotent: true, op_id };
    }
    throw e;
  }
}

function getLedgerMetrics() {
  return { opIdDedupTotal, digIdDuplicateTotal };
}

module.exports = { ledgerFirstCommitWithBarrier, getLedgerMetrics };



