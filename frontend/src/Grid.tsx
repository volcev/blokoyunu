import React, { useEffect, useState, useCallback, Dispatch, SetStateAction, useRef } from "react";
import { withRetry } from './components/request';
import { createPortal } from "react-dom";
import "./Grid.css";

type Props = {
  username: string;
  userColor: string;
  showSettings: boolean;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  handleLogout: () => void;
  setUsername: Dispatch<SetStateAction<string | null>>;
  tokenBalance: number;
  setTokenBalance: Dispatch<SetStateAction<number>>;
  blockData: Block[];
  setBlockData: Dispatch<SetStateAction<Block[]>>;
};

type Block = {
  index: number;
  dugBy: string | null;
  color?: string | null;
  visual?: string | null;
  // PoW-related fields (optional)
  height?: number;
  nonce?: number;
  hash?: string;
};

type BlockState = "idle" | "digging" | "dug";
type MiningStatus = 'idle' | 'fetching_challenge' | 'mining' | 'submitting' | 'success' | 'error';

// POW endpoint (Nginx'te /pow/ --> 4001'e gidiyor)
const POW_API = '/pow';

// Kullanıcı pubkey'ini al (64 hex bekliyoruz, yoksa dummy)
const getUserPubkeyHex = () => {
  const v = localStorage.getItem('user_pubkey') || '';
  return /^[0-9a-fA-F]{64}$/.test(v) ? v : '0'.repeat(64);
};

// Arka planda PoW'u UI'ı bekletmeden tetikle (shadow)
async function kickPowShadow(pubkeyHex: string) {
  try {
    const t = await fetch(`${POW_API}/target`).then(r => r.json());
    const w = new Worker('/powWorker.js?v=1');
    w.postMessage({ ...t, pubkey: pubkeyHex, apiBase: POW_API });
    // sonucu önemsemiyoruz; worker kendi kendine kapanır
    w.onmessage = () => w.terminate();
    w.onerror = () => w.terminate();
  } catch {}
}

// Grid is always 10x10
const API_BASE = "";
const USE_POW_MINING = false; // Set to true to enable PoW mining, false for 10s timer

const Grid: React.FC<Props> = ({ username, userColor, showSettings, setShowSettings, handleLogout, setUsername, tokenBalance, setTokenBalance, blockData, setBlockData }) => {
  const [blockStates, setBlockStates] = useState<BlockState[]>([]);
  const [miningStatus, setMiningStatus] = useState<MiningStatus>('idle');
  const [isMining, setIsMining] = useState<boolean>(false);
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);
  const [newlyDugBlocks, setNewlyDugBlocks] = useState<Set<number>>(new Set());
  
  // Block Info Modal State
  const [showBlockModal, setShowBlockModal] = useState<boolean>(false);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isInitialLoad = useRef(true);
  
  // Get safe modal width based on screen size
  const getModalWidth = () => {
    const screenWidth = window.screen.width || window.innerWidth;
    return screenWidth < 400 ? '280px' : '300px';
  };
  
  // Device detection
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  
  // Aggressive modal CSS protection with Safari-specific handling
  useEffect(() => {
    if (!showBlockModal) return;
    
    // Lock body scroll on modal open (Safari fix)
    const originalBodyStyle = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    
    const forceModalCSS = () => {
      // Find modal elements
      const overlay = document.querySelector('[style*="z-index: 99999"]');
      const content = document.querySelector('[style*="border-radius: 12px"][style*="background"]');
      
      if (overlay) {
        const overlayEl = overlay as HTMLElement;
        overlayEl.style.position = 'fixed';
        overlayEl.style.top = '0px';
        overlayEl.style.left = '0px';
        
        if (isIOS) {
          // iOS (Safari + Chrome): Use screen dimensions instead of viewport units
          overlayEl.style.width = `${window.screen.width}px`;
          overlayEl.style.height = `${window.screen.height}px`;
          overlayEl.style.right = '0px';
          overlayEl.style.bottom = '0px';
          overlayEl.style.setProperty('-webkit-transform', 'none');
          overlayEl.style.setProperty('-webkit-zoom', 'normal');
          overlayEl.style.setProperty('zoom', 'normal');
        } else if (isAndroid) {
          // Android-specific: Use visualViewport if available, fallback to window
          const viewportHeight = window.visualViewport?.height || window.innerHeight;
          overlayEl.style.width = '100vw';
          overlayEl.style.height = `${viewportHeight}px`;
          overlayEl.style.setProperty('zoom', '1');
          overlayEl.style.setProperty('transform', 'none');
        } else {
          // Desktop and other browsers
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
    
    // Force CSS immediately and frequently for Safari
    const timer = setInterval(forceModalCSS, isSafari ? 16 : 50); // 60fps for Safari
    
    // MutationObserver to watch for style changes
    const observer = new MutationObserver(forceModalCSS);
    
    // Start observing after modal appears
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
      // Restore body scroll
      document.body.style.overflow = originalBodyStyle;
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [showBlockModal, isAndroid, isIOS, isSafari]);

  // Create user color map
  const [userColors, setUserColors] = useState<{ [username: string]: string }>({});

  const fetchGrid = useCallback(async () => {
    try {
      const response = await withRetry(`${API_BASE}/grid`, { method: 'GET' }, 1);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: Block[] = await response.json();

      const newStates: BlockState[] = data.map((block) =>
        block.dugBy ? "dug" : "idle"
      );
      setBlockStates(newStates);
      setBlockData(data);
      // Update token balance from Volchain (Single Source of Truth)
      try {
        const volchainRes = await withRetry(`/volchain/user/${username}`, { method: 'GET' }, 1);
        if (volchainRes.ok) {
          const volchainData = await volchainRes.json();
          setTokenBalance(volchainData.balance || 0);
        } else {
          // Fallback to Digzone count for compatibility
          setTokenBalance(data.filter((block) => block.dugBy === username).length);
        }
      } catch {
        // Fallback to Digzone count for compatibility
        setTokenBalance(data.filter((block) => block.dugBy === username).length);
      }
      const dugCount = data.filter((block) => block.dugBy !== null).length;
      if (dugCount === data.length) {
        try {
          const expandResponse = await withRetry(`${API_BASE}/expand`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, 1);
          if (!expandResponse.ok) {
            return;
          }
          const newData: Block[] = await (await withRetry(`${API_BASE}/grid`, { method: 'GET' }, 1)).json();
          const newStates: BlockState[] = newData.map((block) =>
            block.dugBy ? "dug" : "idle"
          );
          setBlockStates(newStates);
          setBlockData(newData);
          setTokenBalance(newData.filter((block) => block.dugBy === username).length);
        } catch {}
      }
    } catch {}
  }, [username, setBlockData, setTokenBalance]);

  useEffect(() => {
    fetchGrid();
  }, [fetchGrid]);

  // Also update tokenBalance when blockData changes
  useEffect(() => {
    setTokenBalance(blockData.filter((block) => block.dugBy === username).length);
  }, [blockData, username, setTokenBalance]);

  useEffect(() => {
    // Fetch colors of all users in grid
    const uniqueUsers = Array.from(new Set(blockData.filter(b => b.dugBy).map(b => b.dugBy)));
    Promise.all(uniqueUsers.map(async (u) => {
      const res = await withRetry(`/auth/user?username=${u}`, { method: 'GET' }, 1);
      const data = await res.json();
      return [u, data.color];
    })).then(results => {
      const colorMap: { [username: string]: string } = {};
      results.forEach(([u, color]) => { colorMap[u] = color; });
      setUserColors(colorMap);
    });
  }, [blockData]);

  useEffect(() => {
    if (isInitialLoad.current && blockStates.length > 0) {
      const firstIdleIndex = blockStates.findIndex(state => state === 'idle');

      if (firstIdleIndex !== -1) {
        setTimeout(() => {
          const blockElement = blockRefs.current[firstIdleIndex];
          if (blockElement) {
            const rect = blockElement.getBoundingClientRect();
            const isInViewport =
              rect.top >= 0 &&
              rect.left >= 0 &&
              rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
              rect.right <= (window.innerWidth || document.documentElement.clientWidth);

            if (!isInViewport) {
              blockElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            isInitialLoad.current = false;
          }
        }, 100);
      }
    }
  }, [blockStates]);

  const handleBlockClick = (index: number) => {
    setSelectedBlockIndex(index);
    setShowBlockModal(true);
  };

  const handleDigBlock = async (index: number) => {
    if (isMining || !username) return;

    if (USE_POW_MINING) {
      if (miningStatus !== 'idle') return;

      setShowBlockModal(false);
      setIsMining(true);
      setMiningStatus('fetching_challenge');

      try {
        // 1. Fetch the mining challenge from our new PoW service
        const targetRes = await fetch('/pow/target');
        if (!targetRes.ok) {
          throw new Error('Failed to fetch mining challenge.');
        }
        const challenge = await targetRes.json();

        setMiningStatus('mining');

        // 2. Start the Web Worker to solve the challenge
        const worker = new Worker('/powWorker.js?v=1');

        worker.postMessage({
          ...challenge,
          pubkey: getUserPubkeyHex(),      // <-- '0'.repeat(64) yerine bu
          apiBase: POW_API                 // <-- window.location.origin yerine bu
        });

        worker.onmessage = async (event) => {
          worker.terminate();
          const { ok, error, nonce, hash } = event.data;

          if (ok) {
            setMiningStatus('submitting');
            
            // 3. Submit the solved block to the main backend
            const response = await withRetry(`${API_BASE}/grid/${index}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: {
                dugBy: username,
                color: userColor,
                visual: null,
                height: challenge.height,
                nonce: nonce,
                hash: hash
              }
            }, 1);
            
            if (!response.ok) {
              const result = await response.json();
               if (response.status === 401 || result.error === 'Unauthorized: Invalid or missing session token') {
                alert('Your session has expired. Please log in again.');
                localStorage.removeItem('session_token');
                localStorage.removeItem('username');
                localStorage.removeItem(`color_${username}`);
                window.location.reload();
                return;
              }
              if (response.status === 429) {
                alert(result?.error || 'Daily mining limit reached');
                return;
              }
              throw new Error(result.error || "Submitting block failed");
            }

            setMiningStatus('success');
            // Visual feedback for newly dug block
            setNewlyDugBlocks(prev => new Set(prev).add(index));
            setTimeout(() => {
              setNewlyDugBlocks(prev => {
                const newSet = new Set(prev);
                newSet.delete(index);
                return newSet;
              });
            }, 6000);

            await fetchGrid(); // Refresh grid state

          } else {
            throw new Error(error || 'Mining worker failed.');
          }
        };

        worker.onerror = (err) => {
          worker.terminate();
          throw err;
        };

      } catch (error) {
        console.error("Mining process failed:", error);
        alert(`Mining failed: ${error instanceof Error ? error.message : String(error)}`);
        setMiningStatus('error');
      } finally {
        // Reset status after a delay to show success/error message
        setTimeout(() => {
          setIsMining(false);
          setMiningStatus('idle');
        }, 2000);
      }
    } else {
      // Original 10-second timer logic
      if (blockStates[index] !== "idle") return;

      setShowBlockModal(false);
      setIsMining(true);
      const newStates = [...blockStates];
      newStates[index] = "digging";
      setBlockStates(newStates);

      try {
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const response = await withRetry(`${API_BASE}/grid/${index}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: {
            dugBy: username,
            color: userColor,
            visual: null,
          },
        }, 1);

        if (!response.ok) {
          const result = await response.json();
          if (response.status === 401 || result.error === 'Unauthorized: Invalid or missing session token') {
            alert('Your session has expired. Please log in again.');
            localStorage.removeItem('session_token');
            localStorage.removeItem('username');
            localStorage.removeItem(`color_${username}`);
            window.location.reload();
            return;
          }
          if (response.status === 429) {
            alert(result?.error || 'Daily mining limit reached');
            newStates[index] = "idle";
            setBlockStates(newStates);
            return;
          }
          alert(result.error || "Digging failed");
          newStates[index] = "idle";
          setBlockStates(newStates);
          await fetchGrid();
        } else {
          // No additional wait needed - backend is now fast
          setNewlyDugBlocks(prev => new Set(prev).add(index));
          setTimeout(() => {
            setNewlyDugBlocks(prev => {
              const newSet = new Set(prev);
              newSet.delete(index);
              return newSet;
            });
          }, 6000);

          await fetchGrid();

          // >>> shadow PoW (opsiyonel)
          kickPowShadow(getUserPubkeyHex());
        }
      } catch (error) {
        console.error("Failed to save digging:", error);
        alert("Digging failed");
        newStates[index] = "idle";
        setBlockStates(newStates);
        await fetchGrid();
      } finally {
        setIsMining(false);
      }
    }
  };


  const selectedBlock = selectedBlockIndex !== null ? blockData[selectedBlockIndex] : null;
  const selectedBlockState = selectedBlockIndex !== null ? blockStates[selectedBlockIndex] : null;
  const isOwner = selectedBlock?.dugBy === username;
  const isEmpty = selectedBlockState === "idle";

  return (
    <>
      <div style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '0 env(safe-area-inset-right) 0 env(safe-area-inset-left)'
      }}>
        <div className="grid-container" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(10, 1fr)',
          gap: '1px',
          width: '100%',
          maxWidth: '400px',
          margin: '0 auto',
          padding: '1px',
          boxSizing: 'border-box'
        }}>
        {blockStates.map((state, index) => {
          const block = blockData[index];
          const isUserBlock = block?.dugBy === username;
          const blockColor = block?.dugBy && userColors[block.dugBy] ? userColors[block.dugBy] : "transparent";
          const bgColor = state === "dug" ? blockColor : "transparent";
          
          let visualContent = "";
          if (state === 'digging' || (isMining && selectedBlockIndex === index)) {
            if (USE_POW_MINING) {
              switch (miningStatus) {
                case 'fetching_challenge': visualContent = '⚙️'; break;
                case 'mining': visualContent = '⛏️'; break;
                case 'submitting': visualContent = '🔗'; break;
                case 'success': visualContent = '✅'; break;
                case 'error': visualContent = '❌'; break;
                default: visualContent = '⏳';
              }
            } else {
              visualContent = '⏳';
            }
          }

          return (
            <div
              ref={el => { blockRefs.current[index] = el; }}
              key={index}
              className={`grid-block ${state}${isUserBlock ? " my-block" : ""}`}
              title={
                state === "dug"
                  ? `Block #${block?.index} - Dug by: ${block?.dugBy || "Unknown"}`
                  : `Block #${block?.index}`
              }
              style={{
                backgroundColor: bgColor,
                width: '100%',
                height: '100%',
                aspectRatio: '1',
                minWidth: 0,
                minHeight: 0
              }}
              onClick={() => handleBlockClick(index)}
            >
              <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {visualContent}
                {newlyDugBlocks.has(index) && (
                  <div className="newly-dug-visual">😊</div>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* Block Info Modal - Rendered via Portal to body */}
      {showBlockModal && selectedBlock && selectedBlockIndex !== null && createPortal(
        <div 
          className="block-modal-overlay" 
          data-modal="block-info"
          data-safari={isSafari ? "true" : "false"}
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
            data-safari={isSafari ? "true" : "false"}
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
            <h3 style={{ margin: '0 0 16px 0', color: '#333', fontSize: '20px' }}>
              Block #{selectedBlock.index}
            </h3>
            {isEmpty ? (
              <p style={{ margin: '8px 0 20px 0', color: '#666', fontSize: '16px' }}>Empty Block</p>
            ) : isOwner ? (
              <p style={{ margin: '8px 0 20px 0', color: '#666', fontSize: '16px' }}>Owner: You</p>
            ) : (
              <p style={{ margin: '8px 0 20px 0', color: '#666', fontSize: '16px' }}>Owner: {selectedBlock.dugBy}</p>
            )}
            
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {isEmpty && (
                <button 
                  className="block-modal-button dig-button" 
                  onClick={() => handleDigBlock(selectedBlockIndex)}
                  disabled={isMining}
                  style={{
                    padding: '10px 20px',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    minWidth: '80px',
                  }}
                >
                  {isMining ? (USE_POW_MINING ? `Mining... (${miningStatus})` : "Mining...") : "Dig"}
                </button>
              )}
              <button 
                className="block-modal-button close-button" 
                onClick={() => setShowBlockModal(false)}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  backgroundColor: '#9E9E9E',
                  color: 'white',
                  minWidth: '80px',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default Grid;