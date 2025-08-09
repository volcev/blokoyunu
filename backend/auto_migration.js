const fs = require('fs');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet, BN } = require('@coral-xyz/anchor');

// Configuration
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const STATS_PROGRAM_ID = new PublicKey('5f6EPwYGs9LqSYoGb9mBfDwPTmfyQMVq9ERrAgpdojCN');

// Load wallet
const secretKey = JSON.parse(fs.readFileSync('./id.json', 'utf8'));
const wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(secretKey)));
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

// Load IDL
const idl = JSON.parse(fs.readFileSync('./blokoyunu_idl.json', 'utf8'));
const program = new Program(idl, STATS_PROGRAM_ID, provider);

// Calculate PDA
const [gameStatsPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("game_stats_v3")],
  STATS_PROGRAM_ID
);

async function migrateRealDataToBlockchain() {
  try {
    console.log('🚀 Starting AUTOMATIC migration of real data to blockchain...');
    console.log('📍 Program ID:', STATS_PROGRAM_ID.toString());
    console.log('📍 Game Stats PDA:', gameStatsPDA.toString());
    console.log('📍 Wallet:', wallet.publicKey.toString());
    
    // Load real data from database
    console.log('📊 Loading real data from database...');
    const data = JSON.parse(fs.readFileSync('./db.json', 'utf8'));
    
    // Calculate player stats
    const playerCounts = {};
    data.grid.forEach(block => {
      if (block.dugBy) {
        playerCounts[block.dugBy] = (playerCounts[block.dugBy] || 0) + 1;
      }
    });
    
    // Get user colors
    const userColors = {};
    data.users.forEach(user => {
      if (user.color) {
        userColors[user.username] = user.color;
      }
    });
    
    // Test connection first
    console.log('🧪 Testing blockchain connection...');
    const accountInfo = await connection.getAccountInfo(gameStatsPDA);
    if (!accountInfo) {
      console.log('❌ Game stats account not found');
      return;
    }
    console.log('✅ Account found, data length:', accountInfo.data.length);
    
    // Migrate top miners
    const topMiners = Object.entries(playerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Top 10 miners
    
    console.log('\n⛏️ MIGRATING MINERS...');
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < topMiners.length; i++) {
      const [minerName, blockCount] = topMiners[i];
      const minerColor = userColors[minerName] || '#888888';
      
      console.log(`  ${i+1}/${topMiners.length} → ${minerName}: ${blockCount} blocks (${minerColor})`);
      
      try {
        const tx = await program.methods
          .updateMining(
            minerName,
            minerColor,
            new BN(blockCount),
            new BN(data.grid.length) // total blocks in grid
          )
          .accounts({
            gameStats: gameStatsPDA,
            user: wallet.publicKey,
          })
          .rpc();
        
        console.log(`    ✅ Success: ${tx.slice(0, 20)}...`);
        successCount++;
        
        // Wait between transactions to avoid rate limits
        if (i < topMiners.length - 1) {
          console.log('    ⏳ Waiting 2 seconds...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.log(`    ❌ Error: ${error.message}`);
        errorCount++;
        
        // If too many errors, stop
        if (errorCount > 3) {
          console.log('🛑 Too many errors, stopping migration');
          return;
        }
      }
    }
    
    console.log(`\n📊 MINERS MIGRATION RESULT: ${successCount} success, ${errorCount} errors`);
    
    // Migrate THET owners
    const thetOwners = data.users
      .filter(u => u.sentTokens && u.sentTokens > 0)
      .sort((a, b) => (b.sentTokens || 0) - (a.sentTokens || 0))
      .slice(0, 10); // Top 10 THET owners
    
    console.log('\n💰 MIGRATING THET OWNERS...');
    successCount = 0;
    errorCount = 0;
    
    for (let i = 0; i < thetOwners.length; i++) {
      const user = thetOwners[i];
      const ownerColor = user.color || '#888888';
      
      console.log(`  ${i+1}/${thetOwners.length} → ${user.username}: ${user.sentTokens} THET (${ownerColor})`);
      
      try {
        const tx = await program.methods
          .updateThetEarnings(
            user.username,
            ownerColor,
            new BN(user.sentTokens)
          )
          .accounts({
            gameStats: gameStatsPDA,
            user: wallet.publicKey,
          })
          .rpc();
        
        console.log(`    ✅ Success: ${tx.slice(0, 20)}...`);
        successCount++;
        
        // Wait between transactions
        if (i < thetOwners.length - 1) {
          console.log('    ⏳ Waiting 2 seconds...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.log(`    ❌ Error: ${error.message}`);
        errorCount++;
        
        if (errorCount > 3) {
          console.log('🛑 Too many errors, stopping migration');
          return;
        }
      }
    }
    
    console.log(`\n📊 THET OWNERS MIGRATION RESULT: ${successCount} success, ${errorCount} errors`);
    
    console.log('\n🎉 MIGRATION COMPLETED!');
    console.log('🔍 Test the /stats/blockchain endpoint to see results');
    console.log('💡 Frontend BlockchainStats should now show real data');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

// Run migration
console.log('🎯 Starting automatic migration in 3 seconds...');
console.log('Press Ctrl+C to cancel');

setTimeout(() => {
  migrateRealDataToBlockchain();
}, 3000); 