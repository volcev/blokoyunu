import React, { useEffect, useState, useCallback } from "react";
import "./Grid.css";

type Props = {
  username: string;
  userColor: string;
  setShowMyBlocks: React.Dispatch<React.SetStateAction<boolean>>;
  handleLogout: () => void;
  setUsername: React.Dispatch<React.SetStateAction<string | null>>;
};

type Block = {
  index: number;
  dugBy: string | null;
  color?: string | null;
  visual?: string | null;
};

const BLOCKS_PER_ROW = 10;

const MyBlocks: React.FC<Props> = ({ username, userColor, setShowMyBlocks, handleLogout, setUsername }) => {
  const [userBlocks, setUserBlocks] = useState<Block[]>([]);
  const [showVisualInput, setShowVisualInput] = useState<number | null>(null);
  const [visualInput, setVisualInput] = useState<string>("");
  const [totalDugCount, setTotalDugCount] = useState<number>(0);
  const [yourDugCount, setYourDugCount] = useState<number>(0);
  const [sentTokens, setSentTokens] = useState<number>(0);
  const [showColorInput, setShowColorInput] = useState<number | null>(null);
  const [colorInput, setColorInput] = useState<string>("");

  const fetchUserBlocks = useCallback(async () => {
    try {
      const response = await fetch(`/grid`);
      const data: Block[] = await response.json();
      const filteredBlocks = data
        .filter((block) => block.dugBy === username)
        .sort((a, b) => a.index - b.index); // Sort by index
      setUserBlocks(filteredBlocks);
      setYourDugCount(filteredBlocks.length);
      setTotalDugCount(data.filter((block) => block.dugBy !== null).length);
    } catch (error) {
      console.error("Failed to fetch user blocks:", error);
    }
  }, [username]);

  const fetchUserInfo = useCallback(async () => {
    try {
      const response = await fetch(`/auth/user?username=${username}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      const result = await response.json();
      if (response.ok) {
        setSentTokens(result.sentTokens || 0);
      }
    } catch (error) {
      console.error("Failed to fetch user info:", error);
    }
  }, [username]);

  const handleUpdateVisual = async (index: number) => {
    if (!visualInput || visualInput.length !== 1) {
      alert("Please enter a single letter.");
      return;
    }

    try {
      const response = await fetch(`/update-block-visual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, username, visual: visualInput }),
      });
      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Visual update failed.");
        return;
      }
      await fetchUserBlocks();
      setShowVisualInput(null);
      setVisualInput("");
    } catch (error) {
      console.error("Visual update error:", error);
      alert("Visual update failed.");
    }
  };

  useEffect(() => {
    fetchUserBlocks();
    fetchUserInfo();
  }, [fetchUserBlocks, fetchUserInfo]);

  // Dynamic row count
  const rowCount = Math.ceil(userBlocks.length / BLOCKS_PER_ROW);
  // Fill missing cells as empty for the grid
  const gridBlocks = Array(rowCount * BLOCKS_PER_ROW).fill(null).map((_, i) => {
    const block = userBlocks[i];
    return block ? { ...block, state: "dug" } : { index: i, dugBy: null, color: null, state: "empty" };
  });

  const totalBlocks = userBlocks.length > 0 ? Math.max(...userBlocks.map(b => b.index)) + 1 : 0;
  const totalDugBlocks = totalDugCount;
  const yourBlocks = yourDugCount;
  const earnedTokens = sentTokens;

  return (
    <div className="my-blocks-container">
      <div style={{ fontSize: '14px', marginBottom: '4px', textAlign: 'center', color: '#333' }}>
        <div style={{ marginBottom: '2px' }}>
          <span style={{ marginRight: '16px' }}>Total Blocks: {totalBlocks}</span>
          <span>Total Dug Blocks: {totalDugBlocks}</span>
        </div>
        <div>
          <span style={{ marginRight: '16px' }}>Your Blocks: {yourBlocks}</span>
          <span>Earned Tokens: {earnedTokens} THET</span>
        </div>
      </div>
      <h2>My Blocks</h2>
      <button
        className="settings-button"
        style={{ backgroundColor: "#ff4d4f", margin: "10px auto", display: "block" }}
        onClick={() => setShowMyBlocks(false)}
      >
        Close
      </button>
      <div
        className="grid-container"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${BLOCKS_PER_ROW}, 40px)`,
          gridTemplateRows: `repeat(${rowCount}, 40px)`,
          justifyContent: "center",
        }}
      >
        {gridBlocks.map((block, index) => {
          const bgColor = block.state === "dug" && block.color ? block.color : "transparent";
          return (
            <div
              key={index}
              className={`grid-block ${block.state}`}
              title={block.state === "dug" ? `Block #${block.index}` : ""}
              style={{ backgroundColor: bgColor }}
              onClick={() => {
                if (block.state === "dug" && block.dugBy === username) {
                  setShowColorInput(block.index);
                  setColorInput(block.color || "#2196f3");
                }
              }}
            >
              {/* Karakter/emoji gösterimi kaldırıldı, sadece renk */}
            </div>
          );
        })}
      </div>
      {showColorInput !== null && (
        <div className="form-group" style={{ marginTop: "10px", alignItems: 'center' }}>
          <label style={{ marginBottom: 8 }}>Pick a color for Block #{showColorInput}:</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <label htmlFor="color-picker-input" style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              border: '2px solid #888',
              background: colorInput,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
              position: 'relative',
              transition: 'box-shadow 0.2s',
            }} title="Pick color">
              <span style={{ fontSize: 22, color: '#fff', textShadow: '0 1px 2px #0008' }}>🎨</span>
              <input
                id="color-picker-input"
                type="color"
                value={colorInput}
                onChange={(e) => setColorInput(e.target.value)}
                style={{
                  opacity: 0,
                  width: '100%',
                  height: '100%',
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  cursor: 'pointer',
                }}
              />
            </label>
            <span style={{ fontSize: 15, color: '#555' }}>{colorInput}</span>
          </div>
          <button
            className="settings-button"
            style={{ marginTop: 12 }}
            onClick={async () => {
              try {
                const response = await fetch(`/update-block-color`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Session-Token": localStorage.getItem("session_token") || ""
                  },
                  body: JSON.stringify({ index: showColorInput, username, color: colorInput })
                });
                const result = await response.json();
                if (!response.ok) {
                  alert(result.error || "Color update failed. Please check your session or try again.");
                  return;
                }
                await fetchUserBlocks();
                setShowColorInput(null);
                setColorInput("");
              } catch (error) {
                alert("Color update failed. Please check your connection or session.");
              }
            }}
          >
            Save
          </button>
          <button
            className="settings-button"
            style={{ backgroundColor: "#ff4d4f", marginTop: "5px" }}
            onClick={() => {
              setShowColorInput(null);
              setColorInput("");
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {/* Karakter inputu ve ilgili form kaldırıldı */}
    </div>
  );
};

export default MyBlocks;