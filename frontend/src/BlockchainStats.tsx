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

interface CurrentUser {
  username: string;
  totalBlocks: number;
  remainingMines: number;
  color: string;
}

interface GameStats {
      // New detailed information
  totalBlocks: number;
  minedBlocks: number;
  emptyBlocks: number;
  topMiners: TopMiner[];
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
  source: 'blockchain' | 'local_fallback' | 'local';
}

const BlockchainStats: React.FC<BlockchainStatsProps> = ({ isVisible, onClose, username }) => {
  const [stats, setStats] = useState<GameStats | null>(null);
  const [castlesCount, setCastlesCount] = useState<number | null>(null);
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
        setSource(data.source === 'blockchain' ? '🔗 Volchain' : '💾 Local');
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

  // Fetch castles count (defense >= 10) for current user from GridB
  useEffect(() => {
    (async () => {
      try {
        if (!isVisible || !username) { setCastlesCount(null); return; }
        const resp = await fetch('/gridb');
        const gridb = await resp.json();
        const count = Array.isArray(gridb)
          ? gridb.filter((b: any) => b && b.owner === username && (b.defense || 0) >= 10).length
          : 0;
        setCastlesCount(count);
      } catch {
        setCastlesCount(null);
      }
    })();
  }, [isVisible, username]);

  if (!isVisible) return null;

  return (
    <div className="settings-modal" onClick={onClose}>
      <div className="settings-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header stats-header">
          <h2 className="modal-title">🏗️ Volchain Statistics</h2>
          <button className="modal-close-x stats-close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="stats-source">
            Data Source: <span className={source.includes('Volchain') ? 'source-blockchain' : 'source-local'}>
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
              {/* 1. Volchain Information */}
              <div className="stats-section">
                <h4 className="section-title">📊 Volchain Information</h4>
                <div className="stats-row">
                  <div className="stat-item">
                    <span className="stat-label">Total Volore:</span>
                    <span className="stat-value">{(1000000000).toLocaleString()}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Mined Volore:</span>
                    <span className="stat-value">{stats.minedBlocks?.toLocaleString() || 0}</span>
                  </div>
                </div>
              </div>

              {/* 2. Top Lists - Miners */}
              <div className="stats-section">
                <div className="top-lists-container">
                  {/* Top Volore Miners */}
                  <div className="top-list-column">
                    <h4 className="section-title">🏆 Top Volore Miners</h4>
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

                  
                </div>
              </div>

              {/* 3. Current User Stats */}
              {stats.currentUser && (
                <div className="stats-section">
                  <h4 className="section-title">👤 Your Stats</h4>
                  <div className="stats-row">
                    <div className="stat-item">
                      <span className="stat-label">Your Volore:</span>
                      <span className="stat-value">{stats.currentUser.totalBlocks}</span>
                    </div>
                    {typeof castlesCount === 'number' && (
                      <div className="stat-item">
                        <span className="stat-label">Your Castles:</span>
                        <span className="stat-value">{castlesCount}</span>
                      </div>
                    )}
                    <div className="stat-item">
                      <span className="stat-label">Remaining Mines Today:</span>
                      <span className="stat-value highlight">{stats.currentUser.remainingMines}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Technical Information removed */}
            </div>
          )}

          <div className="stats-footer">
            <button onClick={fetchStats} className="refresh-btn" disabled={loading}>
              🔄 Refresh
            </button>
              <p className="stats-note">Stats are computed locally</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlockchainStats; 