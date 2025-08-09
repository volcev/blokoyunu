import React, { useEffect, useState, useCallback, Dispatch, SetStateAction } from "react";
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
};

type BlockState = "idle" | "digging" | "dug";

// Grid is always 10x10
const API_BASE = "";

const Grid: React.FC<Props> = ({ username, userColor, showSettings, setShowSettings, handleLogout, setUsername, tokenBalance, setTokenBalance, blockData, setBlockData }) => {
  const [blockStates, setBlockStates] = useState<BlockState[]>([]);
  const [isMining, setIsMining] = useState<boolean>(false);
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);
  
  // Block Info Modal State
  const [showBlockModal, setShowBlockModal] = useState<boolean>(false);
  
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
      console.log("fetchGrid called");
      const response = await fetch(`${API_BASE}/grid`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: Block[] = await response.json();

      const newStates: BlockState[] = data.map((block) =>
        block.dugBy ? "dug" : "idle"
      );
      setBlockStates(newStates);
      setBlockData(data);
      setTokenBalance(data.filter((block) => block.dugBy === username).length);
      console.log("fetchGrid finished");

      const dugCount = data.filter((block) => block.dugBy !== null).length;
      if (dugCount === data.length) {
        console.log("Grid is full, adding new blocks...");
        try {
          const expandResponse = await fetch(`${API_BASE}/expand`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          if (!expandResponse.ok) {
            console.error("Grid expansion failed:", await expandResponse.json());
            return;
          }
          const newData: Block[] = await (await fetch(`${API_BASE}/grid`)).json();
          const newStates: BlockState[] = newData.map((block) =>
            block.dugBy ? "dug" : "idle"
          );
          setBlockStates(newStates);
          setBlockData(newData);
          setTokenBalance(newData.filter((block) => block.dugBy === username).length);
        } catch (error) {
          console.error("Grid expansion error:", error);
        }
      }
    } catch (error) {
      console.error("Failed to fetch grid data:", error);
    }
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
      const res = await fetch(`/auth/user?username=${u}`);
      const data = await res.json();
      return [u, data.color];
    })).then(results => {
      const colorMap: { [username: string]: string } = {};
      results.forEach(([u, color]) => { colorMap[u] = color; });
      setUserColors(colorMap);
    });
  }, [blockData]);

  const handleBlockClick = (index: number) => {
    setSelectedBlockIndex(index);
    setShowBlockModal(true);
  };

  const handleDigBlock = async (index: number) => {
    if (blockStates[index] !== "idle" || isMining) return;

    setShowBlockModal(false); // Close modal first
    setIsMining(true);
    const newStates = [...blockStates];
    newStates[index] = "digging";
    setBlockStates(newStates);

    try {
      await new Promise((resolve) => setTimeout(resolve, 10000));

      const response = await fetch(`${API_BASE}/grid/${index}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": localStorage.getItem("session_token") || ""
        },
        body: JSON.stringify({
          dugBy: username,
          color: userColor,
          visual: null,
        }),
      });

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
        if (response.status === 429 && result.error === 'Daily mining limit reached') {
          alert('Your daily mining limit is reached. Please come back tomorrow!');
          newStates[index] = "idle";
          setBlockStates(newStates);
          return;
        }
        alert(result.error || "Digging failed");
        newStates[index] = "idle";
        setBlockStates(newStates);
        await fetchGrid(); // Hata durumunda grid yenile
      } else {
        await fetchGrid(); // Refresh grid after successful mining
      }
    } catch (error) {
      console.error("Failed to save digging:", error);
      alert("Digging failed");
      newStates[index] = "idle";
      setBlockStates(newStates);
      await fetchGrid(); // Hata durumunda grid yenile
    } finally {
      setIsMining(false);
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
          const visualContent = state === "digging" ? "⏳" : "";
          return (
            <div
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
              {visualContent}
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
                  {isMining ? "Mining..." : "Dig"}
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