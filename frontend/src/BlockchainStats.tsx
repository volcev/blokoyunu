import React, { useState, useEffect, useCallback } from 'react';
import './BlockchainStats.css';

interface BlockchainStatsProps {
  isVisible: boolean;
  onClose: () => void;
  username?: string | null;
}

interface TopMiner {
  name: string;
  blockCount: number;
  color: string;
}

interface TopThetOwner {
  name: string;
  thetEarned: number;
  color: string;
}

interface CurrentUser {
  username: string;
  totalBlocks: number;
  remainingMines: number;
  color: string;
  thetEarned: number;
}

interface GameStats {
      // New detailed information
  totalBlocks: number;
  minedBlocks: number;
  emptyBlocks: number;
  topMiners: TopMiner[];
  topThetOwners: TopThetOwner[];
  currentUser: CurrentUser | null;
  
      // Legacy values (for compatibility)
  totalBlocksMined: number;
  gridExpansions: number;
  
  // Teknik bilgiler
  programId?: string;
  gameStatsPDA?: string;
}

interface StatsResponse {
  success: boolean;
  stats: GameStats;
  source: 'blockchain' | 'local_fallback';
}

const BlockchainStats: React.FC<BlockchainStatsProps> = ({ isVisible, onClose, username }) => {
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = username 
        ? `/stats/blockchain?username=${encodeURIComponent(username)}`
        : '/stats/blockchain';
      const response = await fetch(url);
      const data: StatsResponse = await response.json();
      
      if (data.success) {
        setStats(data.stats);
        setSource(data.source === 'blockchain' ? '🔗 Blockchain' : '💾 Local Fallback');
      } else {
        setError('Failed to fetch stats');
      }
    } catch (err) {
      setError('Network error');
      console.error('Stats fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [username, setLoading, setError, setStats, setSource]);

  useEffect(() => {
    if (isVisible) {
      fetchStats();
    }
  }, [isVisible, fetchStats]);

  if (!isVisible) return null;

  return (
    <div className="settings-modal" onClick={onClose}>
      <div className="settings-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header stats-header">
          <h2 className="modal-title">🏗️ Game Statistics</h2>
          <button className="modal-close-x stats-close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="stats-source">
            Data Source: <span className={source.includes('Blockchain') ? 'source-blockchain' : 'source-local'}>
              {source}
            </span>
          </div>

          {loading && (
            <div className="stats-loading">
              <div className="spinner"></div>
              <p>Loading stats from blockchain...</p>
            </div>
          )}

          {error && (
            <div className="stats-error">
              <p>❌ {error}</p>
              <button onClick={fetchStats} className="retry-btn">Retry</button>
            </div>
          )}

          {stats && !loading && (
            <div className="stats-sections">
              {/* 1. Grid Information */}
              <div className="stats-section">
                <h4 className="section-title">📊 Grid Information</h4>
                <div className="stats-row">
                  <div className="stat-item">
                    <span className="stat-label">Total Blocks:</span>
                    <span className="stat-value">{stats.totalBlocks?.toLocaleString() || 0}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Mined Blocks:</span>
                    <span className="stat-value">{stats.minedBlocks?.toLocaleString() || 0}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Empty Blocks:</span>
                    <span className="stat-value">{stats.emptyBlocks?.toLocaleString() || 0}</span>
                  </div>
                </div>
              </div>

              {/* 2. Top Lists - Miners & THET Owners */}
              <div className="stats-section">
                <div className="top-lists-container">
                  {/* Top Miners */}
                  <div className="top-list-column">
                    <h4 className="section-title">🏆 Top Blok Owners</h4>
                    <div className="top-miners-list">
                      {Array.from({ length: 3 }).map((_, index) => {
                        const miner = stats.topMiners?.[index];
                        return (
                          <div key={index} className={`miner-item ${!miner ? 'placeholder' : ''}`}>
                            <span className="miner-rank">{index + 1}</span>
                            <div 
                              className="miner-color" 
                              style={{ backgroundColor: miner?.color || '#e0e0e0' }}
                            ></div>
                            <span className="miner-name">{miner?.name || '---'}</span>
                            <span className="miner-blocks">{miner ? `${miner.blockCount}` : '0'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Top THET Owners */}
                  <div className="top-list-column">
                    <h4 className="section-title">💰 Top THET Owners</h4>
                    <div className="top-miners-list">
                      {Array.from({ length: 3 }).map((_, index) => {
                        const owner = stats.topThetOwners?.[index];
                        return (
                          <div key={index} className={`miner-item ${!owner ? 'placeholder' : ''}`}>
                            <span className="miner-rank">{index + 1}</span>
                            <div 
                              className="miner-color" 
                              style={{ backgroundColor: owner?.color || '#e0e0e0' }}
                            ></div>
                            <span className="miner-name">{owner?.name || '---'}</span>
                            <span className="miner-blocks">{owner ? `${owner.thetEarned}` : '0'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Current User Stats */}
              {stats.currentUser && (
                <div className="stats-section">
                  <h4 className="section-title">👤 Your Stats</h4>
                  <div className="stats-row">
                    <div className="stat-item">
                      <span className="stat-label">Your Blocks:</span>
                      <span className="stat-value">{stats.currentUser.totalBlocks}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Remaining Mines Today:</span>
                      <span className="stat-value highlight">{stats.currentUser.remainingMines}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">THET Earned:</span>
                      <span className="stat-value" style={{ color: '#f57c00', fontWeight: 'bold' }}>
                        {stats.currentUser.thetEarned} THET
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. Technical Information */}
              <div className="stats-section technical-section">
                <h4 className="section-title">🔗 Blockchain Info</h4>
                <div className="tech-info">
                  {stats.programId && (
                    <div className="tech-item">
                      <span className="tech-label">Program ID:</span>
                      <span className="tech-value tech-address">{stats.programId.slice(0, 8)}...{stats.programId.slice(-8)}</span>
                    </div>
                  )}
                  {stats.gameStatsPDA && (
                    <div className="tech-item">
                      <span className="tech-label">Game Stats PDA:</span>
                      <span className="tech-value tech-address">{stats.gameStatsPDA.slice(0, 8)}...{stats.gameStatsPDA.slice(-8)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="stats-footer">
            <button onClick={fetchStats} className="refresh-btn" disabled={loading}>
              🔄 Refresh
            </button>
            <p className="stats-note">
              Stats are updated on the Solana blockchain in real-time
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlockchainStats; 