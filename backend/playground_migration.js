// SOLANA PLAYGROUND MIGRATION COMMANDS
// Bu komutları Solana Playground'da çalıştırarak gerçek verilerinizi blockchain'e aktarabilirsiniz

const fs = require('fs');

function generatePlaygroundCommands() {
  try {
    console.log('📋 GENERATING SOLANA PLAYGROUND MIGRATION COMMANDS');
    console.log('=================================================\n');
    
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
    
    // Generate commands for top miners
    const topMiners = Object.entries(playerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    console.log('🔥 MINERS MIGRATION COMMANDS:');
    console.log('Copy and paste these commands into Solana Playground:\n');
    
    topMiners.forEach(([name, count], i) => {
      const color = userColors[name] || '#888888';
      console.log(`// ${i+1}. ${name}: ${count} blocks`);
      console.log(`await program.methods`);
      console.log(`  .updateMining("${name}", "${color}", new BN(${count}), new BN(${data.grid.length}))`);
      console.log(`  .accounts({`);
      console.log(`    gameStats: gameStatsPDA,`);
      console.log(`    user: provider.wallet.publicKey,`);
      console.log(`  })`);
      console.log(`  .rpc();`);
      console.log(`console.log("✅ ${name} updated");\n`);
    });
    
    // Generate commands for THET owners
    const thetOwners = data.users
      .filter(u => u.sentTokens && u.sentTokens > 0)
      .sort((a, b) => (b.sentTokens || 0) - (a.sentTokens || 0))
      .slice(0, 10);
    
    console.log('\n💰 THET OWNERS MIGRATION COMMANDS:');
    console.log('Copy and paste these commands into Solana Playground:\n');
    
    thetOwners.forEach((user, i) => {
      console.log(`// ${i+1}. ${user.username}: ${user.sentTokens} THET`);
      console.log(`await program.methods`);
      console.log(`  .updateThetEarnings("${user.username}", "${user.color}", new BN(${user.sentTokens}))`);
      console.log(`  .accounts({`);
      console.log(`    gameStats: gameStatsPDA,`);
      console.log(`    user: provider.wallet.publicKey,`);
      console.log(`  })`);
      console.log(`  .rpc();`);
      console.log(`console.log("✅ ${user.username} THET updated");\n`);
    });
    
    console.log('\n📝 SETUP COMMANDS FOR PLAYGROUND:');
    console.log('First, add these variables at the top of your test:\n');
    console.log(`const { BN } = require("@coral-xyz/anchor");`);
    console.log(`const [gameStatsPDA] = PublicKey.findProgramAddressSync(`);
    console.log(`  [Buffer.from("game_stats_v3")],`);
    console.log(`  program.programId`);
    console.log(`);`);
    console.log(`console.log("PDA:", gameStatsPDA.toString());\n`);
    
    console.log('🎯 SUMMARY:');
    console.log(`- Total miners to migrate: ${topMiners.length}`);
    console.log(`- Total THET owners to migrate: ${thetOwners.length}`);
    console.log(`- Total blocks in grid: ${data.grid.length}`);
    console.log(`- Total mined blocks: ${data.grid.filter(b => b.dugBy).length}`);
    
  } catch (error) {
    console.error('❌ Failed to generate commands:', error.message);
  }
}

// Generate the commands
generatePlaygroundCommands(); 