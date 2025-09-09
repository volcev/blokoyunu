import React, { useEffect, useState, useCallback, useRef } from "react";
import { withRetry } from './components/request';
import { createPortal } from "react-dom";
import "./Grid.css";

// Removed unused function

function getNeighbors(index: number, totalBlocks: number, columnCount: number): number[] {
  const neighbors: number[] = [];
  const col = index % columnCount;

  // Top
  if (index >= columnCount) {
    neighbors.push(index - columnCount);
  }

  // Bottom
  const bottomNeighbor = index + columnCount;
  if (bottomNeighbor < totalBlocks) {
    neighbors.push(bottomNeighbor);
  }

  // Left
  if (col > 0) {
    neighbors.push(index - 1);
  }

  // Right
  // Check that we are not on the rightmost column
  if (col < columnCount - 1) {
    const rightNeighbor = index + 1;
    // and the neighbor is within grid bounds
    if (rightNeighbor < totalBlocks) {
        neighbors.push(rightNeighbor);
    }
  }

  return neighbors;
}

type Props = {
  totalBlocks: number;
  username: string;
  userColor: string;
  tokenBalance: number;
  setTokenBalance: React.Dispatch<React.SetStateAction<number>>;
  setBlockData: React.Dispatch<React.SetStateAction<any[]>>;
};

const GridB: React.FC<Props> = ({ totalBlocks, username, userColor, tokenBalance, setTokenBalance, setBlockData }) => {
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  });
  
  // Mobile detection function
  const isMobile = useCallback(() => windowSize.width <= 800, [windowSize.width]);
  
  // Warzone her zaman 50 sütun olmalı
  const columnCount = 50;
  const rows = Math.ceil(totalBlocks / columnCount);
  const blocks = Array.from({ length: totalBlocks }, (_, i) => i);

  const [gridB, setGridB] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [userColors, setUserColors] = useState<{ [username: string]: string }>({});
  const [showBlockModal, setShowBlockModal] = useState<boolean>(false);
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);
  const [warMode, setWarMode] = useState<'stake' | 'unstake'>('stake');
  
  const getModalWidth = () => {
    const screenWidth = window.screen.width || window.innerWidth;
    return screenWidth < 400 ? '280px' : '300px';
  };
  
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  
  useEffect(() => {
    if (!showBlockModal) return;
    
    const originalBodyStyle = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    
    const forceModalCSS = () => {
      const overlay = document.querySelector('[style*="z-index: 99999"]');
      const content = document.querySelector('[style*="border-radius: 12px"][style*="background"]');
      
      if (overlay) {
        const overlayEl = overlay as HTMLElement;
        overlayEl.style.position = 'fixed';
        overlayEl.style.top = '0px';
        overlayEl.style.left = '0px';
        
        if (isIOS) {
          overlayEl.style.width = `${window.screen.width}px`;
          overlayEl.style.height = `${window.screen.height}px`;
          overlayEl.style.right = '0px';
          overlayEl.style.bottom = '0px';
          overlayEl.style.setProperty('-webkit-transform', 'none');
          overlayEl.style.setProperty('-webkit-zoom', 'normal');
          overlayEl.style.setProperty('zoom', 'normal');
        } else if (isAndroid) {
          const viewportHeight = window.visualViewport?.height || window.innerHeight;
          overlayEl.style.width = '100vw';
          overlayEl.style.height = `${viewportHeight}px`;
          overlayEl.style.setProperty('zoom', '1');
          overlayEl.style.setProperty('transform', 'none');
        } else {
          overlayEl.style.width = '100vw';
          overlayEl.style.height = '100vh';
          overlayEl.style.setProperty('zoom', '1');
        }
        
        overlayEl.style.transform = 'none';
        overlayEl.style.zIndex = '2147483647';
        overlayEl.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        overlayEl.style.display = 'flex';
        overlayEl.style.justifyContent = 'center';
        overlayEl.style.alignItems = 'center';
      }
      
      if (content) {
        const contentEl = content as HTMLElement;
        const modalWidth = isIOS ? (window.screen.width < 400 ? '280px' : '300px') : getModalWidth();
        
        contentEl.style.width = modalWidth;
        contentEl.style.minWidth = modalWidth;
        contentEl.style.maxWidth = modalWidth;
        contentEl.style.transform = 'none';
        contentEl.style.fontSize = '14px';
        contentEl.style.position = 'relative';
        contentEl.style.backgroundColor = 'white';
        contentEl.style.padding = '20px';
        contentEl.style.borderRadius = '12px';
        contentEl.style.textAlign = 'center';
        contentEl.style.margin = '0';
        contentEl.style.border = 'none';
        contentEl.style.outline = 'none';
        
        if (isIOS) {
          contentEl.style.setProperty('-webkit-transform', 'none');
          contentEl.style.setProperty('-webkit-zoom', 'normal');
          contentEl.style.setProperty('zoom', 'normal');
          contentEl.style.setProperty('will-change', 'auto');
        } else {
          contentEl.style.setProperty('zoom', '1');
        }
      }
    };
    
    const timer = setInterval(forceModalCSS, isSafari ? 16 : 50);
    const observer = new MutationObserver(forceModalCSS);
    
    setTimeout(() => {
      const overlay = document.querySelector('[style*="z-index: 99999"]');
      const content = document.querySelector('[style*="border-radius: 12px"][style*="background"]');
      
      if (overlay) {
        observer.observe(overlay, { 
          attributes: true, 
          attributeFilter: ['style', 'class'] 
        });
      }
      
      if (content) {
        observer.observe(content, { 
          attributes: true, 
          attributeFilter: ['style', 'class'] 
        });
      }
    }, 10);
    
    return () => {
      clearInterval(timer);
      observer.disconnect();
      document.body.style.overflow = originalBodyStyle;
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [showBlockModal, isAndroid, isIOS, isSafari]);

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const calculateBlockSize = useCallback(() => {
    const { width } = windowSize;
    // Ekranın %95'ini kullan ve gap'leri hesaba kat
    const availableWidth = width * 0.95;
    const totalGaps = (columnCount - 1) * 0.5; // Her gap 0.5px
    const blockSize = Math.floor((availableWidth - totalGaps) / columnCount);
    // Minimum blok boyutu 4px, maksimum 20px
    return Math.min(Math.max(blockSize, 4), 20);
  }, [windowSize, columnCount]);

  const blockWidth = calculateBlockSize();

  const fetchGridB = async () => {
    setLoading(true);
    const res = await fetch('/gridb');
    const data = await res.json();
    setGridB(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchGridB();
  }, [totalBlocks]);

  useEffect(() => {
    const uniqueUsers = Array.from(new Set(gridB.filter(b => b && typeof b === 'object' && b.owner).map(b => b.owner)));
    Promise.all(uniqueUsers.map(async (u) => {
      const res = await fetch(`/auth/user?username=${u}`);
      const data = await res.json();
      return [u, data.color];
    })).then(results => {
      const colorMap: { [username: string]: string } = {};
      results.forEach(([u, color]) => { colorMap[u] = color; });
      setUserColors(colorMap);
    });
  }, [gridB]);

  const userBlocksInGridB = gridB.filter(b => b && typeof b === 'object' && b.owner === username);
  const totalDefenseUsed = userBlocksInGridB.reduce((sum, b) => sum + (Number(b.defense || 1) || 1), 0);
  const currentStock = tokenBalance - totalDefenseUsed;

  const handleBlockClick = useCallback((index: number) => {
    if (loading) return;
    const selectedBlock = (gridB[index] && typeof gridB[index] === 'object') ? gridB[index] : null;

    if (warMode === 'stake') {
      const realTimeCurrentStock = tokenBalance - totalDefenseUsed;
      const needsStock = !selectedBlock?.owner || selectedBlock.owner !== username;
      if (needsStock && realTimeCurrentStock <= 0) {
        alert('⚠️ No available blocks for war! Mine more blocks in Digzone first.');
        return;
      }

      if (!selectedBlock?.owner) {
        const userHasNoBlocksInGridB = gridB.filter(b => b && typeof b === 'object' && b.owner === username).length === 0;
        const isFirstPlacement = userHasNoBlocksInGridB;
        if (!isFirstPlacement) {
          const neighbors = getNeighbors(index, totalBlocks, columnCount);
          const hasNeighbor = neighbors.some(n => gridB[n] && typeof gridB[n] === 'object' && gridB[n].owner === username);
          if (!hasNeighbor) {
            alert('⚠️ You must place blocks adjacent to your existing blocks! Expand step by step.');
            return;
          }
        }
      }
    }

    setSelectedBlockIndex(index);
    setShowBlockModal(true);
  }, [loading, tokenBalance, totalDefenseUsed, gridB, username, totalBlocks, columnCount, warMode]);

  const handleBlockAction = useCallback(async (index: number) => {
    if (loading) return;
    
    const realTimeCurrentStock = tokenBalance - totalDefenseUsed;
    const selectedBlock = (gridB[index] && typeof gridB[index] === 'object') ? gridB[index] : null;
    const needsStock = !selectedBlock?.owner || selectedBlock.owner !== username;
    
    if (needsStock && realTimeCurrentStock <= 0) {
      alert('⚠️ No available blocks for war! Mine more blocks in Digzone first.');
      setShowBlockModal(false);
      return;
    }
    
    if (!selectedBlock?.owner) {
      const userHasNoBlocksInGridB = gridB.filter(b => b && typeof b === 'object' && b.owner === username).length === 0;
      const isFirstPlacement = userHasNoBlocksInGridB;
      
      if (!isFirstPlacement) {
        const neighbors = getNeighbors(index, totalBlocks, columnCount);
        const hasNeighbor = neighbors.some(n => gridB[n] && typeof gridB[n] === 'object' && gridB[n].owner === username);
        if (!hasNeighbor) {
          alert('⚠️ You must place blocks adjacent to your existing blocks! Expand step by step.');
          setShowBlockModal(false);
          return;
        }
      }
    }
    
    setShowBlockModal(false);
    setLoading(true);
    const prevOwner = selectedBlock?.owner || null;
    const prevDefense = typeof selectedBlock?.defense === 'number' ? selectedBlock!.defense : (selectedBlock?.owner ? 1 : 0);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Retry mechanism for guard system failures
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        const res = await withRetry(`/gridb/${index}`, { 
          method: 'PATCH', 
          headers: { 'Content-Type': 'application/json' },
          body: { action: 'attack' }
        }, 1);
        
        if (res.ok) {
          const data = await res.json();
          
          // Handle new attack response format
          if (data.ok && data.gridb) {
            setGridB(data.gridb);
            console.log(`[ATTACK] Success: ${data.mode}, effects:`, data.effects);
          } else if (Array.isArray(data)) {
            // Legacy format
            setGridB(data);
          } else {
            console.warn('[ATTACK] Unexpected response format:', data);
            setGridB(data);
          }
          
          // If target cell appears unchanged in returned payload, force a fresh read
          const gridData = data.gridb || data;
          try {
            const updated = (gridData[index] && typeof gridData[index] === 'object') ? gridData[index] : null;
            const updatedOwner = updated?.owner || null;
            const updatedDefense = typeof updated?.defense === 'number' ? updated.defense : (updated?.owner ? 1 : 0);
            const changed = (updatedOwner !== prevOwner) || (updatedDefense !== prevDefense);
            if (!changed) {
              const gbRes = await withRetry('/gridb', { method: 'GET', requireOpId: false }, 1);
              if (gbRes.ok) {
                const gb = await gbRes.json();
                setGridB(gb);
              }
            }
          } catch {}
          
          try {
            const gridRes = await withRetry('/grid', { method: 'GET', requireOpId: false }, 1);
            if (gridRes.ok) {
              const gridData = await gridRes.json();
              setBlockData(gridData);
              const userGridBlocks = gridData.filter((block: any) => block.dugBy === username);
              const newTokenBalance = userGridBlocks.length;
              setTokenBalance(newTokenBalance);
              console.log(`🔄 Token balance updated: ${tokenBalance} → ${newTokenBalance}`);
            }
          } catch (error) {
            console.error('Failed to update grid data:', error);
          }
          
          const ownersSource = Array.isArray(gridData)
            ? gridData
            : (Array.isArray((data as any)?.gridb) ? (data as any).gridb : []);
          const uniqueOwners = Array.from(new Set(
            ownersSource
              .filter((b: any) => b && typeof b === 'object' && b.owner)
              .map((b: any) => b.owner)
          )) as string[];
          const colorPromises = uniqueOwners.map(async (owner: string) => {
            try {
              const userRes = await withRetry(`/auth/user?username=${owner}`, { method: 'GET', requireOpId: false }, 1);
              if (userRes.ok) {
                const userData = await userRes.json();
                return { [owner]: userData.color };
              }
            } catch (e) {
              console.log('Color fetch failed for', owner);
            }
            return {};
          });
          
          const colors = await Promise.all(colorPromises);
          const newUserColors = colors.reduce((acc, colorObj) => ({ ...acc, ...colorObj }), {});
          setUserColors(prev => ({ ...prev, ...newUserColors }));
          
          setLoading(false);
          return; // Success, exit retry loop
        } else {
          const err = await res.json();
          if (err.error === 'guard_system_failed') {
            attempts++;
            if (attempts < maxAttempts) {
              console.log(`Guard system busy, retrying... (${attempts}/${maxAttempts})`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
              continue;
            } else {
              alert('⚠️ System temporarily busy. Please try again in a moment.');
            }
          } else {
            alert(err.error || 'Block action failed');
          }
          break;
        }
      } catch (error) {
        attempts++;
        console.error('Request failed:', error);
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        } else {
          alert('⚠️ Connection error. Please try again.');
        }
      }
    }
    setLoading(false);
  }, [loading, setBlockData, setTokenBalance, username, tokenBalance, totalDefenseUsed, gridB, columnCount, totalBlocks]);

  // Stake (defense +1) for own block
  const handleStake = useCallback(async (index: number) => {
    if (loading) return;
    const selectedBlock = (gridB[index] && typeof gridB[index] === 'object') ? gridB[index] : null;
    if (!selectedBlock || selectedBlock.owner !== username) return;

    if ((selectedBlock.defense || 1) >= 10) {
      alert('🏰 Maximum defense reached! Cannot stake further.');
      return;
    }

    setShowBlockModal(false);
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 100));

    const res = await withRetry(`/gridb/${index}/stake`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, 1);

    if (res.ok) {
      const data = await res.json();
      console.log('Stake response:', data); // Debug log

      // If data is object with success property, refresh gridB instead
      if (data.success) {
        // Refresh gridB to get updated data (no info modal)
        fetchGridB();
      } else if (Array.isArray(data)) {
        // Legacy format
        setGridB(data);
      } else {
        console.error('Unexpected response format:', data);
        fetchGridB();
      }

      try {
        const gridRes = await withRetry('/grid', { method: 'GET', requireOpId: false }, 1);
        if (gridRes.ok) {
          const gridData = await gridRes.json();
          setBlockData(gridData);
          const userGridBlocks = gridData.filter((block: any) => block.dugBy === username);
          const newTokenBalance = userGridBlocks.length;
          setTokenBalance(newTokenBalance);
        }
      } catch (error) {
        console.error('Failed to update grid data:', error);
      }
    } else {
      const err = await res.json().catch(() => ({} as any));
      if (err.error === 'guard_system_failed') {
        alert('⚠️ System temporarily busy. Please try again in a moment.');
      } else {
        alert(err.error || 'Stake failed');
      }
    }
    setLoading(false);
  }, [loading, gridB, setBlockData, setTokenBalance, username]);

  // Upgrade to Castle (stake repeatedly until defense reaches 10 or stock runs out)
  const handleUpgradeToCastle = useCallback(async (index: number) => {
    if (loading) return;
    const selectedBlock = (gridB[index] && typeof gridB[index] === 'object') ? gridB[index] : null;
    if (!selectedBlock || selectedBlock.owner !== username) return;

    const currentDefense = typeof selectedBlock.defense === 'number' ? selectedBlock.defense : 1;
    if (currentDefense >= 10) {
      alert('🏰 Already a castle.');
      return;
    }

    // Calculate how many stakes we can perform right now
    const needed = Math.max(0, 10 - currentDefense);
    const canUse = Math.max(0, currentStock);
    const steps = Math.min(needed, canUse);
    if (steps <= 0) {
      alert('⚠️ No available stock to upgrade.');
      return;
    }

    setShowBlockModal(false);
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 100));

    let performed = 0;
    for (let i = 0; i < steps; i++) {
      try {
        const res = await withRetry(`/gridb/${index}/stake`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, 1);
        if (!res.ok) {
          const err = await res.json().catch(() => ({} as any));
          if (err?.error === 'guard_system_failed') {
            // brief backoff and retry this iteration once
            await new Promise(r => setTimeout(r, 800));
            const retry = await withRetry(`/gridb/${index}/stake`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, 1);
            if (!retry.ok) break;
          } else {
            break;
          }
        }
        performed++;
      } catch {
        // network hiccup: stop the batch
        break;
      }
    }

    // Refresh data after batch
    try {
      await fetchGridB();
      const gridRes = await withRetry('/grid', { method: 'GET', requireOpId: false }, 1);
      if (gridRes.ok) {
        const gridData = await gridRes.json();
        setBlockData(gridData);
        const userGridBlocks = gridData.filter((block: any) => block.dugBy === username);
        const newTokenBalance = userGridBlocks.length;
        setTokenBalance(newTokenBalance);
      }
    } catch {}

    if (performed < steps) {
      // Partial success feedback
      try { alert(`Upgraded ${performed} step(s).`); } catch {}
    }

    setLoading(false);
  }, [loading, gridB, setBlockData, setTokenBalance, username, currentStock]);

  // Unstake (defense -1) for own block
  const handleUnstake = useCallback(async (index: number) => {
    if (loading) return;
    const selectedBlock = (gridB[index] && typeof gridB[index] === 'object') ? gridB[index] : null;
    if (!selectedBlock || selectedBlock.owner !== username) return;

    // Remove extra confirmation: initial modal is sufficient

    setShowBlockModal(false);
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 100));

    const res = await withRetry(`/gridb/${index}/unstake`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, 1);

    if (res.ok) {
      const data = await res.json();
      console.log('Unstake response:', data); // Debug log

      // If data is object with success property, refresh gridB instead
      if (data.success) {
        // Refresh gridB to get updated data (no info modal)
        fetchGridB();
      } else if (Array.isArray(data)) {
        // Legacy format
        setGridB(data);
      } else {
        console.error('Unexpected response format:', data);
        fetchGridB();
      }

      try {
        const gridRes = await withRetry('/grid', { method: 'GET', requireOpId: false }, 1);
        if (gridRes.ok) {
          const gridData = await gridRes.json();
          setBlockData(gridData);
          const userGridBlocks = gridData.filter((block: any) => block.dugBy === username);
          const newTokenBalance = userGridBlocks.length;
          setTokenBalance(newTokenBalance);
        }
      } catch (error) {
        console.error('Failed to update grid data:', error);
      }
    } else {
      const err = await res.json().catch(() => ({} as any));
      if (err.error === 'guard_system_failed') {
        alert('⚠️ System temporarily busy. Please try again in a moment.');
      } else {
        alert(err.error || 'Unstake failed');
      }
    }
    setLoading(false);
  }, [loading, gridB, setBlockData, setTokenBalance, username]);

  // Batch Unstake: perform multiple -1 steps safely
  const handleBatchUnstake = useCallback(async (index: number, stepsRequested: number) => {
    if (loading) return;
    const selectedBlock = (gridB[index] && typeof gridB[index] === 'object') ? gridB[index] : null;
    if (!selectedBlock || selectedBlock.owner !== username) return;

    const currentDefense = typeof selectedBlock.defense === 'number' ? selectedBlock.defense : 1;
    const maxSteps = Math.max(0, currentDefense - 1); // cannot go below 1 via unstake
    const steps = Math.min(Math.max(0, stepsRequested), maxSteps);
    if (steps <= 0) return;

    setShowBlockModal(false);
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 100));

    let performed = 0;
    for (let i = 0; i < steps; i++) {
      try {
        const res = await withRetry(`/gridb/${index}/unstake`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, 1);
        if (!res.ok) {
          const err = await res.json().catch(() => ({} as any));
          if (err?.error === 'guard_system_failed') {
            await new Promise(r => setTimeout(r, 800));
            const retry = await withRetry(`/gridb/${index}/unstake`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, 1);
            if (!retry.ok) break;
          } else {
            break;
          }
        }
        performed++;
      } catch {
        break;
      }
    }

    // Refresh data
    try {
      await fetchGridB();
      const gridRes = await withRetry('/grid', { method: 'GET', requireOpId: false }, 1);
      if (gridRes.ok) {
        const gridData = await gridRes.json();
        setBlockData(gridData);
        const userGridBlocks = gridData.filter((block: any) => block.dugBy === username);
        const newTokenBalance = userGridBlocks.length;
        setTokenBalance(newTokenBalance);
      }
    } catch {}

    if (performed < stepsRequested) {
      try { alert(`Unstaked ${performed} step(s).`); } catch {}
    }

    setLoading(false);
  }, [loading, gridB, setBlockData, setTokenBalance, username]);

  

  // Remove block (full unstake) for own block with defense 1
  const handleRemove = useCallback(async (index: number) => {
    if (loading) return;
    const selectedBlock = gridB[index];
    if (!selectedBlock || selectedBlock.owner !== username) return;

    // Remove extra confirmation: initial modal is sufficient

    setShowBlockModal(false);
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 100));

    const res = await withRetry(`/gridb/${index}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }, 1);

    if (res.ok) {
      const data = await res.json();
      console.log('Remove response:', data); // Debug log

      // If data is object with success property, refresh gridB instead
      if (data.success) {
        // Refresh gridB to get updated data (no info modal)
        fetchGridB();
      } else if (Array.isArray(data)) {
        // Legacy format
        setGridB(data);
      } else {
        console.error('Unexpected response format:', data);
        fetchGridB();
      }

      try {
        const gridRes = await withRetry('/grid', { method: 'GET', requireOpId: false }, 1);
        if (gridRes.ok) {
          const gridData = await gridRes.json();
          setBlockData(gridData);
          const userGridBlocks = gridData.filter((block: any) => block.dugBy === username);
          const newTokenBalance = userGridBlocks.length;
          setTokenBalance(newTokenBalance);
        }
      } catch (error) {
        console.error('Failed to update grid data:', error);
      }
    } else {
      const err = await res.json().catch(() => ({} as any));
      if (err.error === 'guard_system_failed') {
        alert('⚠️ System temporarily busy. Please try again in a moment.');
      } else {
        alert(err.error || 'Remove failed');
      }
    }
    setLoading(false);
  }, [loading, gridB, setBlockData, setTokenBalance, username]);

  // Unstake to 1 (convenience) and optionally remove
  const handleUnstakeToOne = useCallback(async (index: number, removeAfter: boolean = false) => {
    if (loading) return;
    const selectedBlock = (gridB[index] && typeof gridB[index] === 'object') ? gridB[index] : null;
    if (!selectedBlock || selectedBlock.owner !== username) return;
    const currentDefense = typeof selectedBlock.defense === 'number' ? selectedBlock.defense : 1;
    const steps = Math.max(0, currentDefense - 1);
    if (steps === 0) {
      if (removeAfter) {
        await handleRemove(index);
      }
      return;
    }

    await handleBatchUnstake(index, steps);
    if (removeAfter) {
      await new Promise(r => setTimeout(r, 150));
      await handleRemove(index);
    }
  }, [loading, gridB, handleBatchUnstake, handleRemove, username]);

  const [touchStartPos, setTouchStartPos] = useState<{ x: number; y: number; time: number } | null>(null);
  const [isMultiTouch, setIsMultiTouch] = useState(false);
  const wasPinching = useRef(false);

  // Pinch-zoom states
  const [scale, setScale] = useState(1);
  const [lastScale, setLastScale] = useState(1);
  const [initialDistance, setInitialDistance] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [lastPosition, setLastPosition] = useState({ x: 0, y: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  // Touch/click management
  const isTouchDeviceRef = useRef<boolean>(false);
  const suppressNextClickRef = useRef<boolean>(false);
  
  // Min/max zoom limits
  const MIN_SCALE = 1;
  const MAX_SCALE = 4;
  
  // Pan boundaries - grid'in ne kadar hareket edebileceğini sınırla
  const [momentum, setMomentum] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const momentumRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  // Setup environment flags once
  useEffect(() => {
    try {
      isTouchDeviceRef.current = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    } catch {
      isTouchDeviceRef.current = false;
    }
  }, []);

  // Pan sınırlarını hesapla
  const getPanBoundaries = useCallback(() => {
    if (!gridRef.current || !gridRef.current.parentElement) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    const parentRect = gridRef.current.parentElement.getBoundingClientRect();
    // Use offsetWidth/Height to get the raw, untransformed dimensions
    const gridWidth = gridRef.current.offsetWidth;
    const gridHeight = gridRef.current.offsetHeight;

    const scaledGridWidth = gridWidth * scale;
    const scaledGridHeight = gridHeight * scale;

    // If the scaled grid is smaller than the container, it should not be pannable.
    // We calculate a position to keep it centered.
    if (scaledGridWidth <= parentRect.width && scaledGridHeight <= parentRect.height) {
        // Since we want to center it, min and max are the same.
        // But our logic is based on transform from center, so position should be 0.
        // We will handle centering with CSS for this case if needed.
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    // Calculate the overflow
    const overflowX = scaledGridWidth > parentRect.width ? scaledGridWidth - parentRect.width : 0;
    const overflowY = scaledGridHeight > parentRect.height ? scaledGridHeight - parentRect.height : 0;
    
    // The maximum translation is half of the overflow, adjusted for the current scale
    const maxX = overflowX / 2 / scale;
    const maxY = overflowY / 2 / scale;

    return {
      minX: -maxX,
      maxX: maxX,
      minY: -maxY,
      maxY: maxY,
    };
  }, [scale]);


  // Momentum-based panning
  const updatePosition = useCallback(() => {
    if (isDragging || (!isDragging && Math.abs(momentum.x) < 0.01 && Math.abs(momentum.y) < 0.01)) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const now = Date.now();
    const deltaTime = now - lastTimeRef.current;
    lastTimeRef.current = now;

    // Apply damping to momentum
    const dampingFactor = 0.92;
    const newMomentum = {
      x: momentum.x * Math.pow(dampingFactor, deltaTime / 16),
      y: momentum.y * Math.pow(dampingFactor, deltaTime / 16),
    };

    const boundaries = getPanBoundaries();
    const newPosition = {
      x: position.x + newMomentum.x,
      y: position.y + newMomentum.y,
    };

    // Clamp position to boundaries
    const clampedPosition = {
        x: Math.max(boundaries.minX, Math.min(boundaries.maxX, newPosition.x)),
        y: Math.max(boundaries.minY, Math.min(boundaries.maxY, newPosition.y)),
    };

    if (gridRef.current) {
      gridRef.current.style.transform = `scale(${scale}) translate(${clampedPosition.x}px, ${clampedPosition.y}px)`;
    }

    setPosition(clampedPosition);
    setMomentum(newMomentum);

    animationFrameRef.current = requestAnimationFrame(updatePosition);
  }, [momentum, isDragging, position, scale, getPanBoundaries]);

  useEffect(() => {
    if (!isDragging && (Math.abs(momentum.x) > 0.01 || Math.abs(momentum.y) > 0.01)) {
      lastTimeRef.current = Date.now();
      animationFrameRef.current = requestAnimationFrame(updatePosition);
    }
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [momentum, isDragging, updatePosition]);



  const getDistance = useCallback((touch1: React.Touch, touch2: React.Touch) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent, index: number) => {
    if (e.touches.length >= 2) {
      // Pinch start, invalidate any single-touch actions
      setTouchStartPos(null); 
      wasPinching.current = true;
      setIsMultiTouch(true);
      const dist = getDistance(e.touches[0], e.touches[1]);
      setInitialDistance(dist);
      setLastScale(scale);
      e.preventDefault();
      return;
    }
    
    // Single touch start
    wasPinching.current = false;
    setIsMultiTouch(false);
    setIsDragging(true);
    const touch = e.touches[0];
    setTouchStartPos({
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    });
    setLastPosition(position);
    setMomentum({ x: 0, y: 0 });
    momentumRef.current = { x: 0, y: 0 };
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, [getDistance, scale, position]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && isMultiTouch) {
      // Pinch zoom
      const dist = getDistance(e.touches[0], e.touches[1]);
      const newScale = Math.min(Math.max(lastScale * (dist / initialDistance), MIN_SCALE), MAX_SCALE);
      
      if (gridRef.current) {
        requestAnimationFrame(() => {
          setScale(newScale);
          const transform = `scale(${newScale}) translate(${position.x}px, ${position.y}px)`;
          gridRef.current!.style.transform = transform;
        });
      }
      e.preventDefault();
      return;
    }

    if (!touchStartPos || e.touches.length !== 1 || !isDragging) {
      return;
    }

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartPos.x;
    const deltaY = touch.clientY - touchStartPos.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // If the user has moved their finger more than the tap threshold,
    // we can immediately decide this is not a tap.
    if (distance > 10 && touchStartPos) {
        // You could set a flag here, e.g., setIsTap(false)
        // For simplicity, we'll just handle it in touchend, 
        // but this is a good place for more complex gesture detection.
    }
    
    // Pan logic with momentum calculation
    // Calculate velocity for momentum
    const now = Date.now();
    const deltaTime = now - touchStartPos.time;
    if (deltaTime > 10) { // a small delta threshold to avoid division by zero
        const velocityX = deltaX / deltaTime;
        const velocityY = deltaY / deltaTime;
        momentumRef.current = { x: velocityX * 16.67, y: velocityY * 16.67 }; // Extrapolate to 60fps
    }
    
    const boundaries = getPanBoundaries();
    const newX = Math.min(Math.max(lastPosition.x + deltaX, boundaries.minX), boundaries.maxX);
    const newY = Math.min(Math.max(lastPosition.y + deltaY, boundaries.minY), boundaries.maxY);
    
    if (gridRef.current) {
      requestAnimationFrame(() => {
        const transform = `scale(${scale}) translate(${newX}px, ${newY}px)`;
        gridRef.current!.style.transform = transform;
        setPosition({ x: newX, y: newY });
      });
    }
  }, [isMultiTouch, getDistance, initialDistance, lastScale, touchStartPos, lastPosition, scale, getPanBoundaries, isDragging, position]);

  // Pinch sonrası ilk tap'i yoksaymak için flag
  const justPinched = useRef(false);

  const handleTouchEnd = useCallback((e: React.TouchEvent, index: number) => {
    // Pinch bitiminde, bir veya iki parmak kalksa da tap engelle
    if (wasPinching.current || isMultiTouch) {
      setIsMultiTouch(false);
      wasPinching.current = false;
      justPinched.current = true;
      return;
    }

    // Only fire on the last finger up
    if (e.touches.length > 0) {
      return;
    }

    setIsDragging(false);

    if (!touchStartPos) {
      return;
    }

    const touch = e.changedTouches[0];
    const deltaX = Math.abs(touch.clientX - touchStartPos.x);
    const deltaY = Math.abs(touch.clientY - touchStartPos.y);
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const duration = Date.now() - touchStartPos.time;

    // A valid tap should be short in duration and move a very small distance.
    // Make tap detection stricter at higher zoom to avoid accidental taps
    const TAP_DURATION_MS = 250;
    const baseMoveThresholdPx = 10; // at scale=1
    const moveThresholdPx = Math.max(2, baseMoveThresholdPx / Math.max(1, scale));
    const isTap = duration < TAP_DURATION_MS && distance < moveThresholdPx;

    // Pinch sonrası ilk tap'i yoksay
    if (isTap) {
      if (justPinched.current) {
        justPinched.current = false;
        setTouchStartPos(null);
        return;
      }
      // It's a click
      e.preventDefault();
      handleBlockClick(index);
    } else {
      // It's a pan/drag, apply momentum and suppress any synthetic click
      setMomentum(momentumRef.current);
      try {
        // Prevent the subsequent synthetic click
        (e as unknown as Event).preventDefault?.();
      } catch {}
      suppressNextClickRef.current = true;
      window.setTimeout(() => { suppressNextClickRef.current = false; }, 250);
    }

    setTouchStartPos(null);
  }, [touchStartPos, handleBlockClick, isMultiTouch]);

  return (
    <div className="gridb-container" style={{ 
      display: "flex", 
      flexDirection: "column", 
      alignItems: "center", 
      width: "100%",
      padding: isMobile() ? "8px" : "16px",
      boxSizing: "border-box"
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: isMobile() ? 40 : 0, marginBottom: isMobile() ? 8 : 12 }}>
        <div style={{ display: 'inline-flex', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
          <button
            onClick={() => setWarMode('stake')}
            disabled={loading}
            style={{
              padding: isMobile() ? '6px 10px' : '8px 14px',
              fontSize: isMobile() ? 12 : 14,
              border: 'none',
              background: warMode === 'stake' ? '#2196F3' : '#f5f5f5',
              color: warMode === 'stake' ? '#fff' : '#333',
              cursor: 'pointer',
              fontWeight: 700
            }}
          >Stake</button>
          <button
            onClick={() => setWarMode('unstake')}
            disabled={loading}
            style={{
              padding: isMobile() ? '6px 10px' : '8px 14px',
              fontSize: isMobile() ? 12 : 14,
              border: 'none',
              background: warMode === 'unstake' ? '#ff9800' : '#f5f5f5',
              color: warMode === 'unstake' ? '#fff' : '#333',
              cursor: 'pointer',
              fontWeight: 700
            }}
          >Unstake</button>
        </div>
        <div style={{ fontSize: isMobile() ? 12 : 13, color: '#666' }}>
          Mode: {warMode === 'stake' ? 'Place/Support/Attack' : 'Decrease defense or remove your blocks'}
        </div>
      </div>

      {/* Uyarı metni kaldırıldı: Digzone/Warzone ayrı gridler */}
      <div style={{
        fontSize: isMobile() ? 14 : 16,
        marginBottom: isMobile() ? "8px" : "12px",
                            color: currentStock > 0 ? "#2196f3" : "#ff5722",
          fontWeight: currentStock < 0 ? "bold" : 600
      }}>
        💰 Total: {tokenBalance} | 🏗️ Used: {totalDefenseUsed} | Available: {currentStock >= 0 ? currentStock : `${currentStock} (NEGATIVE!)`}
      </div>
      <div className="gridb-wrapper" style={{
        width: '100%',
        maxWidth: '95vw',
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        padding: '2px',
        margin: '0 auto',
        boxSizing: 'border-box',
        backgroundColor: '#f5f5f5',
        borderRadius: '4px',
        position: 'relative'
      }}>
        <div
          ref={gridRef}
        className="grid-container gridb-grid"
        style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columnCount}, ${blockWidth}px)`,
          gridTemplateRows: `repeat(${rows}, ${blockWidth}px)`,
            gap: '0.5px',
            width: `${blockWidth * columnCount + (columnCount - 1) * 0.5}px`,
            transformOrigin: 'center',
            willChange: 'transform',
            contain: 'paint layout',
            touchAction: 'none'
          }}>
        {blocks.map((index) => {
          const filled = (gridB[index] && typeof gridB[index] === 'object') ? gridB[index] : null;
          const isUserBlock = filled && filled.owner === username;
          const blockColor = filled && filled.owner && userColors[filled.owner] ? userColors[filled.owner] : "#f5f5f5";
          const isCastle = filled && filled.defense >= 10;

          // Digzone/Warzone ayrımı: İlk 10x10 = Digzone, geri kalan = Warzone
          const row = Math.floor(index / columnCount);
          const col = index % columnCount;
          const isDigzone = row < 10 && col < 10;
          const isWarzone = !isDigzone;
          
          const fontSize = isMobile() 
            ? Math.max(4, Math.min(8, Math.floor(blockWidth * 0.3)))
            : Math.max(Math.floor(blockWidth * 0.4), 10);
            
          return (
            <div
              key={index}
              className={`grid-block${isUserBlock ? " my-block" : ""}${isDigzone ? " digzone-block" : " warzone-block"}`}

              style={{
                backgroundColor: filled && filled.owner ? blockColor : "#ffffff",
                border: `0.5px solid ${filled && filled.owner ? (isCastle ? "#000" : "#999") : "#dddddd"}`,
                background: filled && filled.owner ? blockColor : "#ffffff",
                color: filled && filled.owner ? "#222" : "#888",
                fontSize: fontSize,
                lineHeight: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                height: `${blockWidth}px`,
                width: `${blockWidth}px`,
                userSelect: "none",
                boxSizing: "border-box",
                cursor: loading ? "wait" : "pointer",
                fontWeight: filled && filled.owner ? (isMobile() ? 700 : 600) : 400,
                opacity: loading ? 0.5 : 1,
                pointerEvents: loading ? "none" : "auto",
                transition: isMobile() ? "none" : "transform 0.1s",
                minWidth: isMobile() ? "8px" : "auto",
                minHeight: isMobile() ? "8px" : "auto",
              }}
              title={
                filled && filled.owner
                  ? `Block #${index} - Owner: ${filled.owner}`
                  : `Block #${index}`
              }
              onClick={(ev) => {
                if (suppressNextClickRef.current) {
                  ev.preventDefault();
                  return;
                }
                handleBlockClick(index);
              }}
              onTouchStart={(e) => handleTouchStart(e, index)}
              onTouchMove={handleTouchMove}
              onTouchEnd={(e) => handleTouchEnd(e, index)}
            >
              {filled && filled.owner ? (typeof filled.defense === 'number' ? filled.defense : 1) : ''}
            </div>
          );
        })}
        </div>
      </div>
    
      {showBlockModal && selectedBlockIndex !== null && createPortal(
        <div 
          className="block-modal-overlay" 
          data-modal="block-info"
          data-ios={isIOS ? "true" : "false"}
          onClick={() => setShowBlockModal(false)}
          style={{
            position: 'fixed',
            top: '0',
            left: '0',
            bottom: '0',
            right: '0',
            zIndex: 2147483647,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            transform: 'none',
            transformOrigin: '0 0',
            zoom: 1,
            WebkitTransform: 'none',
            MozTransform: 'none',
            msTransform: 'none',
          }}
        >
          <div 
            className="block-modal-content" 
            data-modal-content="block-info"
            data-ios={isIOS ? "true" : "false"}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
              textAlign: 'center',
              width: getModalWidth(),
              maxWidth: getModalWidth(),
              minWidth: getModalWidth(),
              height: 'auto',
              maxHeight: '400px',
              position: 'relative',
              transform: 'none',
              transformOrigin: 'center center',
              zoom: 1,
              fontSize: '14px',
              WebkitTransform: 'none',
              MozTransform: 'none',
              msTransform: 'none',
              margin: '0',
              border: 'none',
              outline: 'none',
            }}
          >
            <button
              className="modal-close-x"
              onClick={() => setShowBlockModal(false)}
              aria-label="Close"
              style={{ position: 'absolute', top: 8, right: 8 }}
            >
              ×
            </button>
            {(() => {
              const selectedBlock = gridB.find(b => b && typeof b === 'object' && b.index === selectedBlockIndex);
              const isOwner = selectedBlock?.owner === username;
              const isEmpty = !selectedBlock?.owner;
              const isOthersBlock = selectedBlock?.owner && selectedBlock?.owner !== username;
              const isCastle = selectedBlock?.defense >= 10;
              const userHasNoBlocksInGridB = gridB.filter(b => b.owner === username).length === 0;
              const emptyBlocks = gridB.filter(b => !b.owner);
              const isFirstPlacement = userHasNoBlocksInGridB && emptyBlocks.length === 0;
              
              return (
                <>
                  <h3 style={{ margin: '0 0 16px 0', color: '#333', fontSize: '20px' }}>
                    Block #{selectedBlockIndex}
                  </h3>
                  {isEmpty ? (
                    <p style={{ margin: '8px 0 20px 0', color: '#666', fontSize: '16px' }}>Empty Block</p>
                  ) : isOwner ? (
                    <div style={{ margin: '8px 0 20px 0' }}>
                      <p style={{ margin: '0 0 8px 0', color: '#666', fontSize: '16px' }}>
                        Owner: You (Defense: {selectedBlock?.defense || 1})
                      </p>
                      {isCastle && (
                        <p style={{ margin: '0', color: '#f57c00', fontSize: '14px', fontWeight: 'bold' }}>
                          Castle: +1 auto-mining per day
                        </p>
                      )}
                    </div>
                  ) : (
                    <div style={{ margin: '8px 0 20px 0' }}>
                      <p style={{ margin: '0 0 8px 0', color: '#666', fontSize: '16px' }}>
                        Owner: {selectedBlock?.owner} (Defense: {selectedBlock?.defense || 1})
                      </p>
                      {isCastle && (
                        <p style={{ margin: '0 0 8px 0', color: '#f57c00', fontSize: '14px', fontWeight: 'bold' }}>
                          Enemy Castle: Generates +1 block/day
                        </p>
                      )}
                      {isFirstPlacement && isCastle && (
                        <p style={{ margin: '0', color: '#f44336', fontSize: '13px', fontStyle: 'italic' }}>
                          Castle Protection: Attack neighboring blocks first
                        </p>
                      )}
                    </div>
                  )}
                  
                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    {warMode === 'stake' && (
                      <>
                        {(isEmpty || isOthersBlock) && (
                          <button 
                            className="block-modal-button attack-button" 
                            onClick={() => selectedBlockIndex !== null && handleBlockAction(selectedBlockIndex)}
                            disabled={loading || (isFirstPlacement && isCastle)}
                            style={{
                              padding: '10px 20px',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: (loading || (isFirstPlacement && isCastle)) ? 'not-allowed' : 'pointer',
                              backgroundColor: (isFirstPlacement && isCastle) ? '#9E9E9E' : '#f44336',
                              color: 'white',
                              minWidth: '80px',
                              opacity: (isFirstPlacement && isCastle) ? 0.6 : 1,
                            }}
                            title={isFirstPlacement && isCastle ? 'Cannot attack castles on first placement' : ''}
                          >
                            {loading ? 'Processing...' : (isFirstPlacement && isCastle) ? 'Protected' : (isEmpty ? 'Claim' : 'Attack')}
                          </button>
                        )}
                        {isOwner && (
                          <button
                            className="block-modal-button support-button"
                            onClick={() => selectedBlockIndex !== null && handleStake(selectedBlockIndex)}
                            disabled={loading}
                            style={{
                              padding: '10px 20px',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              backgroundColor: (selectedBlock?.defense === 9) ? '#ff9800' : '#2196F3',
                              color: 'white',
                              minWidth: '80px',
                            }}
                            title={selectedBlock?.defense === 9 ? 'Upgrade to Castle! (+1 auto-mining/day)' : 'Increase defense by 1'}
                          >
                            {loading ? 'Processing...' : (selectedBlock?.defense === 9) ? 'Castle!' : 'Support'}
                          </button>
                        )}
                        {isOwner && ((selectedBlock?.defense || 1) < 10) && (
                          <button
                            className="block-modal-button support-button"
                            onClick={() => selectedBlockIndex !== null && handleUpgradeToCastle(selectedBlockIndex)}
                            disabled={loading || currentStock <= 0}
                            style={{
                              padding: '10px 20px',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: (loading || currentStock <= 0) ? 'not-allowed' : 'pointer',
                              backgroundColor: '#673AB7',
                              color: 'white',
                              minWidth: '80px',
                            }}
                            title={`Upgrade with up to ${Math.min(Math.max(0, 10 - (selectedBlock?.defense || 1)), Math.max(0, currentStock))} support(s) to reach Castle`}
                          >
                            {loading ? 'Processing...' : 'Upgrade to Castle'}
                          </button>
                        )}
                      </>
                    )}

                    {warMode === 'unstake' && isOwner && (
                      <>
                        {(selectedBlock?.defense || 1) > 1 && (
                          <button 
                            className="block-modal-button unstake-button" 
                            onClick={() => selectedBlockIndex !== null && handleUnstake(selectedBlockIndex)}
                            disabled={loading}
                            style={{
                              padding: '10px 20px',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              backgroundColor: '#ff9800',
                              color: 'white',
                              minWidth: '80px',
                            }}
                            title={isCastle ? 'Drop castle defense by 1' : 'Decrease defense by 1'}
                          >
                            {loading ? 'Processing...' : 'Unstake'}
                          </button>
                        )}
                        {(
                          <button
                            className="block-modal-button remove-button"
                            onClick={() => selectedBlockIndex !== null && handleUnstakeToOne(selectedBlockIndex, true)}
                            disabled={loading}
                            style={{
                              padding: '10px 20px',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              backgroundColor: '#d32f2f',
                              color: 'white',
                              minWidth: '80px',
                            }}
                            title={'Unstake all (remove block)'}
                          >
                            {loading ? 'Processing...' : 'Unstake All'}
                          </button>
                        )}
                      </>
                    )}

                    {/* Close button removed; red X at top-right */}
                  </div>
                </>
              );
            })()}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default GridB; 