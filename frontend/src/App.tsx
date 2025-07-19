import React, { useState, useEffect } from "react";
import Grid from "./Grid";
import Login from "./Login";
import About from "./About";
import MyBlocks from "./MyBlocks";
import GridB from "./GridB";
import "./App.css";

const App: React.FC = () => {
  const [username, setUsername] = useState<string | null>(null);
  const [userColor, setUserColor] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showAbout, setShowAbout] = useState<boolean>(false);
  const [showMyBlocks, setShowMyBlocks] = useState<boolean>(false);
  const [showMenu, setShowMenu] = useState<boolean>(false);
  const [showTopMiners, setShowTopMiners] = useState<boolean>(false);
  const [showGridB, setShowGridB] = useState<boolean>(false);
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [blockData, setBlockData] = useState<any[]>([]);
  const [userBlocks, setUserBlocks] = useState<any[]>([]);
  const [filledBlocks, setFilledBlocks] = useState<{[key:number]: {color: string, visual: string, owner: string}} >({});
  const [topMinersData, setTopMinersData] = useState<any[]>([]);
  const [userEmail, setUserEmail] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [selectedColor, setSelectedColor] = useState<string | null>(userColor);
  const [newUsername, setNewUsername] = useState<string>("");

  useEffect(() => {
    const storedName = localStorage.getItem("username");
    if (storedName) {
      setUsername(storedName);
      const savedColor = localStorage.getItem(`color_${storedName}`);
      if (savedColor) setUserColor(savedColor);
    }
  }, []);

  // When the user logs in or the username changes, fetch walletAddress from backend and save to localStorage
  useEffect(() => {
    if (username) {
      fetch(`/auth/user?username=${username}`)
        .then(res => res.json())
        .then(user => {
          if (user.walletAddress) {
            localStorage.setItem(`wallet_${username}`, user.walletAddress);
          }
        });
    }
  }, [username]);

  useEffect(() => {
    // When blockData changes, update userBlocks
    setUserBlocks(blockData.filter(b => b.dugBy === username));
  }, [blockData, username]);

  useEffect(() => {
    if (showTopMiners) {
      fetch("/top-miners")
        .then(res => res.json())
        .then(data => setTopMinersData(data));
    }
  }, [showTopMiners]);

  useEffect(() => {
    if (showSettings && username) {
      fetch(`/auth/user?username=${username}`)
        .then(res => res.json())
        .then(user => {
          setUserEmail(user.email);
          setSelectedColor(user.color);
        });
    }
  }, [showSettings, username]);

  const handleLogin = (name: string, color: string) => {
    localStorage.setItem("username", name);
    localStorage.setItem(`color_${name}`, color);
    setUsername(name);
    setUserColor(color);
  };

  const handleLogout = () => {
    if (username) {
      localStorage.removeItem("username");
      localStorage.removeItem(`color_${username}`);
      setUsername(null);
      setUserColor(null);
      setShowSettings(false);
      setShowAbout(false);
      setShowMyBlocks(false);
      setShowMenu(false);
      setShowTopMiners(false);
      setShowGridB(false);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, currentPassword, newPassword }),
      });
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

  const colorOptions = [
    "#FFCDD2", "#F8BBD0", "#E1BEE7", "#D1C4E9", "#C5CAE9",
    "#BBDEFB", "#B2EBF2", "#C8E6C9", "#DCEDC8", "#FFF9C4"
  ];

  const handleUpdateColor = async () => {
    if (!selectedColor) {
      alert("Please select a color");
      return;
    }
    try {
      const response = await fetch(`/auth/update-color`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, color: selectedColor }),
      });
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

  const handleUpdateUsername = async () => {
    if (!newUsername || newUsername.length < 3) {
      alert("New username must be at least 3 characters");
      return;
    }
    try {
      const response = await fetch(`/api/update-username`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentUsername: username, newUsername }),
      });
      if (!response.ok) {
        const text = await response.text();
        console.error("Username update failed, response:", text);
        alert("Username update failed: " + text);
        return;
      }
      const result = await response.json();
      setUsername(result.newUsername);
      localStorage.setItem("username", result.newUsername);
      localStorage.removeItem(`color_${username}`);
      localStorage.setItem(`color_${result.newUsername}`, userColor || '');
      alert("Username updated successfully");
      setNewUsername("");
    } catch (error: any) {
      console.error("Username update error:", error);
      alert(`Username update error: ${error.message}`);
    }
  };

  return (
    <div className="app-container">
      <div className="fixed-header-bg" />
      <header className="top-bar">
        <div className="button-container">
          <button
            className="menu-button"
            onClick={() => setShowMenu(!showMenu)}
            aria-label="Toggle Menu"
          >
            ☰
          </button>
          {showMenu && (
            <div className="menu-dropdown">
              <button onClick={() => { setShowAbout(true); setShowMenu(false); }}>
                Info
              </button>
              <button onClick={() => { setShowSettings(true); setShowMenu(false); }}>
                Settings
              </button>
              <button onClick={() => { setShowGridB(true); setShowMenu(false); }}>
                Building Grid
              </button>
              <button onClick={() => { setShowGridB(false); setShowMenu(false); }}>
                Digging Grid
              </button>
            </div>
          )}
        </div>
        <h1 className="title">⛏ BlockMiningGame</h1>
        {username && userColor && (
          <div className="welcome-header">Welcome {username}</div>
        )}
      </header>
      <div className="header-overlay"></div>
      <div className="scrollable-content">
        <div className="content-container">
          <div className="banner-placeholder">
            <div className="banner-content">Ad Placeholder (728x90)</div>
          </div>
          {username && userColor && !showAbout && !showMyBlocks && (
            <>
              <div className="button-group">
                <button
                  onClick={async () => {
                    if (!window.confirm("Are you sure you want to reset all your dug blocks?")) return;
                    try {
                      const response = await fetch(`${process.env.REACT_APP_API_BASE || ""}/reset-tokens`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        username,
                        walletAddress: localStorage.getItem(`wallet_${username}`) || "",
                        blockCount: tokenBalance,
                      }),
                      });
                      const result = await response.json();
                      if (!response.ok || result.error) {
                        alert(result.error || "Block reset or token transfer failed");
                      } else {
                        alert(`${tokenBalance} blocks reset, ${tokenBalance} THET earned!\nTransaction: ${result.rewardSignature || "-"}`);
                        window.location.reload();
                      }
                    } catch (error) {
                      alert("An error occurred: " + error);
                    }
                  }}
                  className="action-button"
                  aria-label="Reset Blocks"
                >
                  Reset Blocks
                </button>
                <button
                  onClick={() => setShowTopMiners(!showTopMiners)}
                  className="action-button"
                  aria-label="Top Miners"
                >
                  Top Miners
                </button>
                <button
                  onClick={() => setShowMyBlocks(true)}
                  className="action-button my-blocks-button"
                  aria-label="My Blocks"
                >
                  My Blocks
                </button>
              </div>
            </>
          )}
        </div>
        {username && userColor ? (
          showAbout ? (
            <About setShowAbout={setShowAbout} />
          ) : showMyBlocks ? (
            <MyBlocks
              username={username}
              userColor={userColor}
              setShowMyBlocks={setShowMyBlocks}
              handleLogout={handleLogout}
              setUsername={setUsername}
            />
          ) : (
            <>
              {showGridB ? (
                <GridB
                  totalBlocks={blockData.length}
                  userBlocks={userBlocks}
                  username={username}
                />
              ) : (
                <Grid
                  username={username}
                  userColor={userColor}
                  showSettings={showSettings}
                  setShowSettings={setShowSettings}
                  handleLogout={handleLogout}
                  setShowMyBlocks={setShowMyBlocks}
                  setUsername={setUsername}
                  showTopMiners={showTopMiners}
                  setShowTopMiners={setShowTopMiners}
                  tokenBalance={tokenBalance}
                  setTokenBalance={setTokenBalance}
                  blockData={blockData}
                  setBlockData={setBlockData}
                />
              )}
              {showSettings && (
                <div className="settings-modal">
                  <div className="settings-content">
                    <h3>Settings</h3>
                    <p><strong>Email:</strong> {userEmail}</p>
                    <p><strong>Username:</strong> {username}</p>
                    <div className="form-group">
                      <label>Color Selection:</label>
                      <div className="color-picker">
                        {colorOptions.map((color) => (
                          <div
                            key={color}
                            onClick={() => setSelectedColor(color)}
                            style={{
                              width: "40px",
                              height: "40px",
                              backgroundColor: color,
                              border: selectedColor === color ? "3px solid black" : "1px solid #888",
                              cursor: "pointer",
                              borderRadius: "4px",
                              display: "inline-block",
                              marginRight: "4px",
                            }}
                            title={color}
                          />
                        ))}
                      </div>
                      <button className="settings-button" onClick={handleUpdateColor}>
                        Update Color
                      </button>
                    </div>
                    <form onSubmit={handleChangePassword}>
                      <div className="form-group">
                        <label>Current Password:</label>
                        <input
                          className="settings-input"
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>New Password:</label>
                        <input
                          className="settings-input"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Confirm New Password:</label>
                        <input
                          className="settings-input"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                        />
                      </div>
                      <button className="settings-button" type="submit">
                        Change Password
                      </button>
                    </form>
                    <div className="form-group">
                      <label>New Username:</label>
                      <input
                        className="settings-input"
                        type="text"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        placeholder="Enter new username"
                      />
                      <button className="settings-button" onClick={handleUpdateUsername}>
                        Update Username
                      </button>
                    </div>
                    <button className="settings-button close" onClick={() => setShowSettings(false)}>
                      Close
                    </button>
                  </div>
                </div>
              )}
              {showTopMiners && (
                <div className="top-miners-modal">
                  <div className="top-miners-content">
                    <h3>Top Miners</h3>
                    <table style={{ margin: "0 auto", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ padding: "6px 12px", border: "1px solid #ccc" }}>Name</th>
                          <th style={{ padding: "6px 12px", border: "1px solid #ccc" }}>Tokens</th>
                          <th style={{ padding: "6px 12px", border: "1px solid #ccc" }}>Color</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topMinersData.map((miner, i) => (
                          <tr key={i}>
                            <td style={{ padding: "6px 12px", border: "1px solid #ccc" }}>{miner.name}</td>
                            <td style={{ padding: "6px 12px", border: "1px solid #ccc" }}>{miner.count}</td>
                            <td style={{ padding: "6px 12px", border: "1px solid #ccc" }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  width: "16px",
                                  height: "16px",
                                  backgroundColor: miner.color,
                                  borderRadius: "50%",
                                  border: "1px solid #000",
                                }}
                              ></span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button className="settings-button" onClick={() => setShowTopMiners(false)}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </>
          )
        ) : (
          <Login onLogin={handleLogin} />
        )}
      </div>
    </div>
  );
};

export default App;