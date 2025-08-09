const fs = require('fs');
const { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction,
  TransactionInstruction,
  SystemProgram
} = require('@solana/web3.js');

// Configuration
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const STATS_PROGRAM_ID = new PublicKey('5f6EPwYGs9LqSYoGb9mBfDwPTmfyQMVq9ERrAgpdojCN');

// Load wallet
const secretKey = JSON.parse(fs.readFileSync('./id.json', 'utf8'));
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

// Calculate PDA
const [gameStatsPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("game_stats_v3")],
  STATS_PROGRAM_ID
);

async function testConnection() {
  try {
    console.log('🧪 Testing connection to blockchain...');
    console.log('📍 Program ID:', STATS_PROGRAM_ID.toString());
    console.log('📍 Game Stats PDA:', gameStatsPDA.toString());
    console.log('📍 Payer:', payer.publicKey.toString());
    
    // Check if the account exists
    const accountInfo = await connection.getAccountInfo(gameStatsPDA);
    if (accountInfo) {
      console.log('✅ Account exists, data length:', accountInfo.data.length);
      console.log('📦 Account owner:', accountInfo.owner.toString());
      
      // Try to parse current data
      console.log('🔍 Current data preview (first 50 bytes):');
      console.log(Array.from(accountInfo.data.slice(0, 50)));
      
      return true;
    } else {
      console.log('❌ Account not found');
      return false;
    }
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
    return false;
  }
}

async function simulateDataMigration() {
  try {
    console.log('📊 Loading real data from database...');
    
    // Load real data from database
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
    
    // Show what would be migrated
    console.log('⛏️ MINERS TO MIGRATE:');
    const topMiners = Object.entries(playerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    topMiners.forEach(([name, count], i) => {
      const color = userColors[name] || '#888888';
      console.log(`  ${i+1}. ${name}: ${count} blocks (${color})`);
    });
    
    console.log('\n💰 THET OWNERS TO MIGRATE:');
    const thetOwners = data.users
      .filter(u => u.sentTokens && u.sentTokens > 0)
      .sort((a, b) => (b.sentTokens || 0) - (a.sentTokens || 0))
      .slice(0, 10);
    
    thetOwners.forEach((user, i) => {
      console.log(`  ${i+1}. ${user.username}: ${user.sentTokens} THET (${user.color})`);
    });
    
    console.log('\n📈 MIGRATION SUMMARY:');
    console.log('Total blocks:', data.grid.length);
    console.log('Mined blocks:', data.grid.filter(b => b.dugBy).length);
    console.log('Miners to migrate:', topMiners.length);
    console.log('THET owners to migrate:', thetOwners.length);
    
  } catch (error) {
    console.error('❌ Data simulation failed:', error.message);
  }
}

// Main function
async function main() {
  console.log('🚀 Simple Migration Tool - Testing Phase');
  console.log('=====================================\n');
  
  const connectionOk = await testConnection();
  
  if (connectionOk) {
    console.log('\n📋 Simulating data migration...');
    await simulateDataMigration();
    
    console.log('\n✅ Test completed successfully!');
    console.log('💡 Next step: Use Solana playground to update data manually or');
    console.log('💡 Get the proper IDL from your deployed program for automation.');
  } else {
    console.log('❌ Cannot proceed without blockchain connection');
  }
}

main().catch(console.error); 