const { readDB } = require('./db');

function computeLocalStats(username = null) {
  const data = readDB();
  const totalBlocks = data.grid.length;
  const minedBlocks = data.grid.filter(b => b.dugBy).length;

  const playerCounts = {};
  data.grid.forEach(block => {
    if (block.dugBy) {
      playerCounts[block.dugBy] = (playerCounts[block.dugBy] || 0) + 1;
    }
  });

  const topMiners = Object.entries(playerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => {
      const user = data.users.find(u => u.username === name);
      return { name, blockCount: count, color: user ? user.color : '#888' };
    });

  let currentUserStats = null;
  if (username) {
    const user = data.users.find(u => u.username === username);
    const today = new Date().toISOString().slice(0, 10);
    let remainingMines = 20;
    if (user && user.lastDigDate === today) {
      remainingMines = Math.max(0, 20 - (user.dailyDigCount || 0));
    }
    currentUserStats = {
      username,
      totalBlocks: playerCounts[username] || 0,
      remainingMines,
      color: user ? user.color : '#888'
    };
  }

  return {
    totalBlocks,
    minedBlocks,
    emptyBlocks: totalBlocks - minedBlocks,
    topMiners,
    currentUser: currentUserStats,
    totalBlocksMined: minedBlocks,
    gridExpansions: Math.floor(totalBlocks / 100) - 1
  };
}

module.exports = { computeLocalStats };



