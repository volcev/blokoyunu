import React, { useState, useEffect, useCallback } from 'react';
import './BlockchainStats.css';
import { withRetry } from './components/request';

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
  grid: GameStats;
  source: string;
  volchain?: { totalSupply: number; currentUser?: { balance?: number } };
}

const BlockchainStats: React.FC<BlockchainStatsProps> = ({ isVisible, onClose, username }) => {
  const [stats, setStats] = useState<GameStats | null>(null);
  const [castlesCount, setCastlesCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [holders, setHolders] = useState<Array<{ name: string; balance: number; color: string; pubkey: string }>>([]);
  const [chainTotal, setChainTotal] = useState<number>(0);
  const [chainUserBalance, setChainUserBalance] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = username 
        ? `/stats/volchain?username=${encodeURIComponent(username)}`
        : '/stats/volchain';
      const [statsResp, holdersResp] = await Promise.all([
        withRetry(url, { method: 'GET' }, 1),
        withRetry('/volchain/holders?limit=3', { method: 'GET' }, 1)
      ]);
      const data: StatsResponse = await statsResp.json();
      if (Array.isArray(holdersResp)) {
        // no-op (type guard)
      }
      const holdersJson = await holdersResp.json().catch(() => []);
      if (Array.isArray(holdersJson)) {
        setHolders(holdersJson.map((h: any) => ({
          name: h?.name || (typeof h?.pubkey === 'string' ? h.pubkey.slice(0,8) : ''),
          balance: Number(h?.balance) || 0,
          color: h?.color || '#e0e0e0',
          pubkey: h?.pubkey || ''
        })));
      } else {
        setHolders([]);
      }
      
      if (data.success) {
        setStats(data.grid);
        setSource(data.source === 'volchain' ? '🔗 Volchain' : '💾 Local');
        const vt = Number(data?.volchain?.totalSupply || 0);
        setChainTotal(vt);
        const ub = Number(data?.volchain?.currentUser?.balance || 0);
        setChainUserBalance(ub);
        const minedBlocks = Number(data?.grid?.minedBlocks || 0);
        setIsSyncing(vt > 0 && minedBlocks >= 0 && vt !== minedBlocks);
      } else {
        setError('Failed to fetch stats');
      }
    } catch (err) {
      setError('Network error');
      console.error('Stats fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [username, setLoading, setError, setStats, setSource, setHolders]);

  useEffect(() => {
    if (isVisible) {
      fetchStats();
    }
  }, [isVisible, fetchStats]);

  // Fetch Top Volore Holders directly from Volchain when modal opens
  useEffect(() => {
    (async () => {
      try {
        if (!isVisible) { setHolders([]); return; }
        const resp = await withRetry('/volchain/holders?limit=3', { method: 'GET' }, 1);
        const data = await resp.json();
        if (Array.isArray(data)) {
          setHolders(data.map((h: any) => ({
            name: h?.name || (typeof h?.pubkey === 'string' ? h.pubkey.slice(0,8) : '---'),
            balance: Number(h?.balance) || 0,
            color: h?.color || '#e0e0e0',
            pubkey: h?.pubkey || ''
          })));
        } else {
          setHolders([]);
        }
      } catch {
        setHolders([]);
      }
    })();
  }, [isVisible]);

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
                    <span className="stat-value">{(chainTotal || 0).toLocaleString()}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Mined Volore:</span>
                    <span className="stat-value">{(chainTotal || 0).toLocaleString()}</span>
                  </div>
                </div>
                {isSyncing && (
                  <div className="stats-note" style={{ color: '#b58900' }}>syncing…</div>
                )}
              </div>

              {/* 2. Top Lists */}
              <div className="stats-section">
                <div className="top-lists-container">
                  {/* Top Volore Holders */}
                  <div className="top-list-column">
                    <h4 className="section-title">🏅 Top Volore Holders</h4>
                    <div className="top-miners-list">
                      {Array.from({ length: 3 }).map((_, index) => {
                        const holder = holders[index];
                        return (
                          <div key={index} className={`miner-item ${!holder ? 'placeholder' : ''}`}>
                            <span className="miner-rank">{index + 1}</span>
                            <div 
                              className="miner-color" 
                              style={{ backgroundColor: holder?.color || '#e0e0e0' }}
                            ></div>
                            <span className="miner-name">{holder?.name || '---'}</span>
                            <span className="miner-blocks">{holder ? `${holder.balance}` : '0'}</span>
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
                      <span className="stat-value">{(chainUserBalance || 0).toLocaleString()}</span>
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
              <p className="stats-note">Stats are computed from Volchain snapshot</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlockchainStats; 