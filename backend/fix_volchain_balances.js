#!/usr/bin/env node

const axios = require('axios');

async function fixVolchainBalances() {
  console.log('🔧 Fixing Volchain balances...');
  
  // Get current state
  const response = await axios.get('http://localhost:3001/volchain/verify?mode=system&details=1');
  const mismatches = response.data.users.mismatches;
  
  console.log('Current mismatches:');
  for (const mismatch of mismatches) {
    console.log(`- ${mismatch.username}: balance=${mismatch.balance}, mined=${mismatch.mined}, diff=${mismatch.diff_balance_mined}`);
  }
  
  // We need to create burn transactions for excess balances
  const v = require('./volchain_chain.js');
  
  for (const mismatch of mismatches) {
    if (mismatch.diff_balance_mined > 0) {
      const excessAmount = mismatch.diff_balance_mined;
      console.log(`🔥 Burning ${excessAmount} excess balance for ${mismatch.username} (pubkey: ${mismatch.pubkey.slice(0,8)}...)`);
      
      try {
        const burnTx = v.translateEventToTx({
          type: 'burn',
          reason: 'balance_correction',
          username: mismatch.username,
          pubkey: mismatch.pubkey,
          amount: excessAmount,
          op_id: `balance_fix_${Date.now()}_${mismatch.username}`,
          memo: { reason: 'balance_correction', username: mismatch.username }
        });
        
        console.log(`   Created burn tx:`, burnTx);
        
        // Precheck and enqueue
        v.precheckBundle([burnTx]);
        v.enqueueTx(burnTx);
        
        console.log(`   ✅ Burn transaction enqueued for ${mismatch.username}`);
      } catch (e) {
        console.error(`   ❌ Error creating burn tx for ${mismatch.username}:`, e.message);
      }
    }
  }
  
  // Wait a moment for transactions to process
  console.log('⏳ Waiting for transactions to process...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check results
  const afterResponse = await axios.get('http://localhost:3001/volchain/verify?mode=system&details=1');
  const afterMismatches = afterResponse.data.users.mismatches;
  
  console.log('\n📊 After fixes:');
  for (const mismatch of afterMismatches) {
    console.log(`- ${mismatch.username}: balance=${mismatch.balance}, mined=${mismatch.mined}, diff=${mismatch.diff_balance_mined}`);
  }
  
  if (afterMismatches.length === 0) {
    console.log('🎉 All mismatches fixed!');
  } else {
    console.log(`⚠️ ${afterMismatches.length} mismatches remaining`);
  }
}

fixVolchainBalances().catch(console.error);

