import React, { useEffect, useState } from "react";
import "./Grid.css";

function getGridDimensions(totalBlocks: number, aspectRatio: number = 16 / 9) {
  // Find the closest row and column count to total block count while preserving 16/9 ratio
  // Adjust again to preserve the ratio
  let cols = Math.ceil(Math.sqrt(totalBlocks * aspectRatio));
  let rows = Math.ceil(totalBlocks / cols);
  // Oranı korumak için tekrar ayarla
  while (cols / rows > aspectRatio + 0.01) {
    cols--;
    rows = Math.ceil(totalBlocks / cols);
  }
  while (cols / rows < aspectRatio - 0.01) {
    cols++;
    rows = Math.ceil(totalBlocks / cols);
  }
  return { cols, rows };
}

type Props = {
  totalBlocks: number;
  userBlocks: { index: number; color?: string | null; visual?: string | null; }[];
  username: string;
};

const GridB: React.FC<Props> = ({ totalBlocks, userBlocks, username }) => {
  const { cols, rows } = getGridDimensions(totalBlocks);
  const blocks = Array.from({ length: totalBlocks }, (_, i) => i);
  const [gridB, setGridB] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Calculate block size according to screen size
  const maxGridWidth = 0.9 * window.innerWidth;
  const maxGridHeight = 0.9 * window.innerHeight;
  const blockWidth = Math.floor(Math.min(maxGridWidth / cols, maxGridHeight / rows));

  // Fetch GridB from backend
  const fetchGridB = async () => {
    setLoading(true);
    const res = await fetch('/gridb');
    const data = await res.json();
    setGridB(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchGridB();
    // eslint-disable-next-line
  }, [totalBlocks]);

  // Find the next unused user block
  const userBlocksSorted = [...userBlocks].sort((a, b) => a.index - b.index);
  const usedUserBlockIndexes = gridB.filter(b => b.owner === username).map(b => b.userBlockIndex);
  const nextUserBlock = userBlocksSorted.find(b => !usedUserBlockIndexes.includes(b.index));

  const handleBlockClick = async (index: number) => {
    if (loading) return;
    const filled = gridB[index];
    // If the block is filled and owner is the user: remove
    if (filled && filled.owner === username) {
      setLoading(true);
      const res = await fetch(`/gridb/${index}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': localStorage.getItem('session_token') || ''
        }
      });
      if (res.ok) {
        const data = await res.json();
        setGridB(data);
      } else {
        const err = await res.json();
        alert(err.error || 'Block remove failed');
      }
      setLoading(false);
      return;
    }
    // If the block is filled and owner is someone else: do nothing
    if (filled && filled.owner && filled.owner !== username) return;
    // If the block is empty and there is a next user block: add
    if (!nextUserBlock) return;
    setLoading(true);
    const res = await fetch(`/gridb/${index}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': localStorage.getItem('session_token') || ''
      }
    });
    if (res.ok) {
      const data = await res.json();
      setGridB(data);
    } else {
      const err = await res.json();
      alert(err.error || 'Block fill failed');
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      <h3 style={{ margin: "12px 0 8px 0", fontWeight: 400, fontSize: 18 }}>
        Building Grid ({cols}x{rows}, {totalBlocks} blocks)
      </h3>
      <div
        className="grid-container"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${blockWidth}px)`,
          gridTemplateRows: `repeat(${rows}, ${blockWidth}px)`,
          gap: "2px",
          justifyContent: "center",
          alignItems: "center",
          maxWidth: `${blockWidth * cols}px`,
          maxHeight: `${blockWidth * rows}px`,
          width: "100%",
          height: "auto",
        }}
      >
        {blocks.map((index) => {
          const filled = gridB[index];
          return (
            <div
              key={index}
              className="grid-block"
              style={{
                backgroundColor: filled && filled.owner ? filled.color : "#f5f5f5",
                border: "1px solid #ddd",
                color: filled && filled.owner ? "#222" : "#aaa",
                fontSize: Math.max(Math.floor(blockWidth * 0.6), 10),
                lineHeight: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: `${blockWidth}px`,
                width: `${blockWidth}px`,
                userSelect: "none",
                boxSizing: "border-box",
                cursor:
                  filled && filled.owner
                    ? filled.owner === username
                      ? loading ? "wait" : "pointer"
                      : "not-allowed"
                    : loading ? "wait" : "pointer",
                fontWeight: filled && filled.owner ? 600 : 400,
                opacity: loading && !filled?.owner ? 0.7 : 1,
              }}
              title={
                filled && filled.owner
                  ? `Block #${index} - Owner: ${filled.owner}`
                  : `Block #${index}`
              }
              onClick={() => handleBlockClick(index)}
            >
              {filled && filled.owner === username && filled.defense ? filled.defense : filled && filled.owner ? filled.defense || 1 : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GridB; 