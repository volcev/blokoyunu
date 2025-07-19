import React, { useEffect, useState, useCallback, Dispatch, SetStateAction, useRef } from "react";
import "./Grid.css";

type Props = {
  username: string;
  userColor: string;
  showSettings: boolean;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  handleLogout: () => void;
  setShowMyBlocks: Dispatch<SetStateAction<boolean>>;
  setUsername: Dispatch<SetStateAction<string | null>>;
  showTopMiners: boolean;
  setShowTopMiners: Dispatch<SetStateAction<boolean>>;
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

type Miner = {
  name: string;
  count: number;
  color: string;
};

const BLOCKS_PER_ROW = 10;
const API_BASE = "";

const colorOptions = [
  "#FFCDD2", "#F8BBD0", "#E1BEE7", "#D1C4E9", "#C5CAE9",
  "#BBDEFB", "#B2EBF2", "#C8E6C9", "#DCEDC8", "#FFF9C4"
];

const Grid: React.FC<Props> = ({ username, userColor, showSettings, setShowSettings, handleLogout, setShowMyBlocks, setUsername, showTopMiners, setShowTopMiners, tokenBalance, setTokenBalance, blockData, setBlockData }) => {
  const [blockStates, setBlockStates] = useState<BlockState[]>([]);
  const [isMining, setIsMining] = useState<boolean>(false);
  const [sentTokens, setSentTokens] = useState<number>(0);
  const [topMiners, setTopMiners] = useState<Miner[]>([]);
  const [userEmail, setUserEmail] = useState<string>('');
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState<string | null>(userColor);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [newUsername, setNewUsername] = useState<string>('');
  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);
  const tooltipTimeout = useRef<NodeJS.Timeout | null>(null);

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
  }, [username]);

  const fetchUserInfo = useCallback(async (user: string) => {
    try {
      const response = await fetch(`/auth/user?username=${user}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      if (response.ok) {
        setUserEmail(result.email);
        setSelectedColor(result.color);
        setWalletAddress(result.walletAddress || '');
        setSentTokens(result.sentTokens || 0);
      } else {
        alert(result.error || "Failed to fetch user info");
      }
    } catch (error) {
      console.error("Failed to fetch user info:", error);
    }
  }, []);

  const fetchTopMiners = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/top-miners`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: Miner[] = await response.json();
      setTopMiners(data);
    } catch (error) {
      console.error("Failed to fetch top miners data:", error);
    }
  }, []);

  useEffect(() => {
    fetchGrid();
    fetchUserInfo(username);
    if (showTopMiners) fetchTopMiners();
  }, [fetchGrid, fetchUserInfo, fetchTopMiners, username, showTopMiners]);

  // Also update tokenBalance when blockData changes
  useEffect(() => {
    setTokenBalance(blockData.filter((block) => block.dugBy === username).length);
  }, [blockData, username, setTokenBalance]);

  const handleClick = async (index: number) => {
    if (blockStates[index] !== "idle" || isMining) return;

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
        await fetchGrid(); // Başarılı kazı sonrası da grid yenile
        await fetchUserInfo(username);
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

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      alert("New passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      alert("New password must be at least 8 characters");
      return;
    }

    try {
      const response = await fetch(`/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          currentPassword,
          newPassword,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Password change failed");
        return;
      }

      alert("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      alert("Password change error: " + error.message);
    }
  };

  const handleUpdateColor = async () => {
    if (!selectedColor) {
      alert("Please select a color");
      return;
    }

    try {
      const response = await fetch(`/auth/update-color`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          color: selectedColor,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Color update failed");
        return;
      }

      alert("Color updated successfully");
      window.location.reload();
    } catch (error: any) {
      alert("Color update error: " + error.message);
    }
  };

  const handleUpdateWallet = async () => {
    if (!walletAddress) {
      alert("Please enter a wallet address");
      return;
    }

    try {
      const response = await fetch(`/auth/update-wallet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          walletAddress,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Wallet address update failed");
        return;
      }

      alert(result.message);
      await fetchGrid();
      await fetchUserInfo(username);
    } catch (error: any) {
      alert("Wallet address update error: " + error.message);
    }
  };

  const handleUpdateUsername = async () => {
    if (!newUsername || newUsername.length < 3) {
      alert("New username must be at least 3 characters");
      return;
    }

    try {
      const response = await fetch(`/api/update-username`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          currentUsername: username,
          newUsername,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("Username update failed, response:", text);
        throw new Error(`HTTP error! status: ${response.status}, response: ${text}`);
      }
      const result = await response.json();
      setUsername(result.newUsername);
      localStorage.setItem("username", result.newUsername);
      localStorage.removeItem(`color_${username}`);
      localStorage.setItem(`color_${result.newUsername}`, userColor || '');
      await fetchGrid();
      await fetchUserInfo(result.newUsername);
      alert("Username updated successfully");
      setNewUsername("");
    } catch (error: any) {
      console.error("Username update error:", error);
      alert(`Username update error: ${error.message}`);
    }
  };

  // Mobile detection function
  const isMobile = () => window.innerWidth <= 800;

  const showTooltip = (index: number) => {
    setActiveTooltip(index);
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    tooltipTimeout.current = setTimeout(() => {
      setActiveTooltip(null);
    }, 1500);
  };

  useEffect(() => {
    return () => {
      if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    };
  }, []);

  const handleBlockClick = (index: number) => {
    if (isMobile()) {
      showTooltip(index);
    }
    handleClick(index);
  };

  return (
    <>
      {/* Remove all settings-modal and top-miners-modal rendering and related state/logic from this file. */}

      <div
        className="grid-container"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${BLOCKS_PER_ROW}, 40px)`,
          gridTemplateRows: `repeat(${Math.floor(blockData.length / BLOCKS_PER_ROW) || 1}, 40px)`,
          justifyContent: "center",
        }}
      >
        {blockStates.map((state, index) => {
          const block = blockData[index];
          const bgColor = state === "dug" && block?.color ? block.color : "transparent";
          const visualContent = state === "digging" ? "⏳" : "";
          return (
            <div
              key={index}
              className={`grid-block ${state}`}
              title={
                state === "dug"
                  ? `Block #${block?.index} - Dug by: ${block?.dugBy || "Unknown"}`
                  : `Block #${block?.index}`
              }
              style={{ backgroundColor: bgColor }}
              onClick={() => handleBlockClick(index)}
            >
              {visualContent}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default Grid;