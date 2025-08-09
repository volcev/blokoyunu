const fs = require('fs');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet, BN } = require('@coral-xyz/anchor');

// Configuration
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const STATS_PROGRAM_ID = '5f6EPwYGs9LqSYoGb9mBfDwPTmfyQMVq9ERrAgpdojCN';

// Load wallet (you'll need to have the keypair)
const secretKey = JSON.parse(fs.readFileSync('./id.json', 'utf8'));
const wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(secretKey)));
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

// Load IDL (you'll need to get this from your Solana program)
const idl = {
  "version": "0.1.0",
  "name": "blokoyunu",
  "instructions": [
    {
      "name": "updateMining",
      "accounts": [
        { "name": "gameStats", "isMut": true, "isSigner": false },
        { "name": "user", "isMut": false, "isSigner": true }
      ],
      "args": [
        { "name": "minerName", "type": "string" },
        { "name": "minerColor", "type": "string" },
        { "name": "blocksMined", "type": "u64" },
        { "name": "totalBlocks", "type": "u64" }
      ]
    },
    {
      "name": "updateThetEarnings",
      "accounts": [
        { "name": "gameStats", "isMut": true, "isSigner": false },
        { "name": "user", "isMut": false, "isSigner": true }
      ],
      "args": [
        { "name": "ownerName", "type": "string" },
        { "name": "ownerColor", "type": "string" },
        { "name": "thetAmount", "type": "u64" }
      ]
    }
  ]
};

const program = new Program(idl, STATS_PROGRAM_ID, provider);

// Calculate PDA
const [gameStatsPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("game_stats_v3")],
  program.programId
);

async function migrateRealDataToBlockchain() {
  try {
    console.log('🚀 Starting migration of real data to blockchain...');
    console.log('📍 Program ID:', STATS_PROGRAM_ID);
    console.log('📍 Game Stats PDA:', gameStatsPDA.toString());
    
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
    
    // Migrate top miners
    const topMiners = Object.entries(playerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Top 10 miners
    
    console.log('⛏️ Migrating miners...');
    for (const [minerName, blockCount] of topMiners) {
      const minerColor = userColors[minerName] || '#888888';
      
      console.log(`  → ${minerName}: ${blockCount} blocks (${minerColor})`);
      
      try {
        const tx = await program.methods
          .updateMining(
            minerName,
            minerColor,
            new BN(blockCount),
            new BN(data.grid.length) // total blocks
          )
          .accounts({
            gameStats: gameStatsPDA,
            user: wallet.publicKey,
          })
          .rpc();
        
        console.log(`    ✅ Transaction: ${tx}`);
        
        // Wait a bit between transactions
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.log(`    ❌ Error: ${error.message}`);
      }
    }
    
    // Migrate THET owners
    const thetOwners = data.users
      .filter(u => u.sentTokens && u.sentTokens > 0)
      .sort((a, b) => (b.sentTokens || 0) - (a.sentTokens || 0))
      .slice(0, 10); // Top 10 THET owners
    
    console.log('💰 Migrating THET owners...');
    for (const user of thetOwners) {
      const ownerColor = user.color || '#888888';
      
      console.log(`  → ${user.username}: ${user.sentTokens} THET (${ownerColor})`);
      
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
        
        console.log(`    ✅ Transaction: ${tx}`);
        
        // Wait a bit between transactions
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.log(`    ❌ Error: ${error.message}`);
      }
    }
    
    console.log('🎉 Migration completed!');
    console.log('🔍 You can now test the /stats/blockchain endpoint');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

// Run migration
migrateRealDataToBlockchain(); 