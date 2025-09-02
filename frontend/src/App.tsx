import React, { useState, useEffect } from "react";
import Grid from "./Grid";
import Login from "./Login";
import About from "./About";
import GridB from "./GridB";
import BlockchainStats from "./BlockchainStats";
import MenuDropdownPortal from "./components/MenuDropdownPortal";
import VolchainActivity from './components/VolchainActivity';
import "./App.css";
import "./Mobile.css";
import "./Modal.css";
import nacl from 'tweetnacl';
import { encode, decode as hexDecode } from '@stablelib/hex';
import VolorePanel from './components/VolorePanel';
import { withRetry } from './components/request';

// Keystore helpers (AES-GCM PBKDF2)
function toHex(bytes: Uint8Array): string { return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join(''); }
function fromHex(hex: string): Uint8Array { const out=new Uint8Array(hex.length/2); for(let i=0;i<hex.length;i+=2) out[i/2]=parseInt(hex.slice(i,i+2),16); return out; }
async function deriveKeyFromPassword(password: string, salt: Uint8Array) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name:'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:100000, hash:'SHA-256' }, keyMaterial, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
}
async function encryptKeystore(privHex: string, password: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKeyFromPassword(password, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(privHex)));
  return JSON.stringify({ kdf:'pbkdf2-sha256', c:'aes-256-gcm', iv: toHex(iv), salt: toHex(salt), ct: toHex(ct) });
}
async function decryptKeystore(keystore: string, password: string) {
  const data = JSON.parse(keystore);
  const key = await deriveKeyFromPassword(password, fromHex(data.salt));
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv: fromHex(data.iv) }, key, fromHex(data.ct));
  return new TextDecoder().decode(plain);
}

// Keypair üret (yalnızca ilk kayıt/keystore yoksa)
function generateKeypair() {
  const kp = nacl.sign.keyPair();
  const pubHex = encode(kp.publicKey);
  const privHex = encode(kp.secretKey);
  localStorage.setItem('user_pubkey', pubHex);
  localStorage.setItem('user_privkey', privHex);
  return { pubHex, privHex };
}

const App: React.FC = () => {
  const [username, setUsername] = useState<string | null>(null);
  const [userColor, setUserColor] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showAbout, setShowAbout] = useState<boolean>(false);
  const [showContactUs, setShowContactUs] = useState<boolean>(false);

  const [showMenu, setShowMenu] = useState<boolean>(false);
  const [showGridB, setShowGridB] = useState<boolean>(false);
  const [showBlockchainStats, setShowBlockchainStats] = useState<boolean>(false);
  const [showVolore, setShowVolore] = useState<boolean>(false);
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [showVolchainActivity, setShowVolchainActivity] = useState<boolean>(false);
  const [serverPowPub, setServerPowPub] = useState<string>('');
  const [blockData, setBlockData] = useState<any[]>([]);




  const [userEmail, setUserEmail] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [selectedColor, setSelectedColor] = useState<string | null>(userColor);
  const [newUsername, setNewUsername] = useState<string>("");
  
  // Contact Us form states
  const [contactName, setContactName] = useState<string>("");
  const [contactEmail, setContactEmail] = useState<string>("");
  const [contactMessage, setContactMessage] = useState<string>("");

  useEffect(() => {
    try {
      const hasPub = !!localStorage.getItem('user_pubkey');
      const hasPriv = !!localStorage.getItem('user_privkey');
      if (!hasPub || !hasPriv) {
        generateKeypair();
      }
    } catch {}
  }, []);
  
  // Warm up chain id for request wrapper early
  useEffect(() => {
    try { withRetry('/chain/info', { method: 'GET' }, 1).catch(()=>{}); } catch {}
  }, []);

  useEffect(() => {
    const storedName = localStorage.getItem("username");
    if (storedName) {
      setUsername(storedName);
      const savedColor = localStorage.getItem(`color_${storedName}`);
      if (savedColor) setUserColor(savedColor);
      // legacy wallet storage ignored
    }
  }, []);

  // When the user logs in: restore or save keystore (silent with login password)
  useEffect(() => {
    if (username) {
      const sessionToken = localStorage.getItem('session_token');
      if (sessionToken) {
        withRetry('/auth/keystore', { method: 'GET', headers: { 'X-Session-Token': sessionToken } }, 1)
          .then(res => res.json())
          .then(async (resp) => {
            const serverKeystore = resp?.powKeystore as string | null;
            const serverPub = resp?.powPubkey as string | null;
            if (serverPub) setServerPowPub(serverPub);
            const localPub = localStorage.getItem('user_pubkey');
            const localPriv = localStorage.getItem('user_privkey');

            // If server has keystore and local is missing wallet: restore using login password silently
            if (serverKeystore && (!localPub || !localPriv)) {
              const pw = sessionStorage.getItem('login_password') || '';
              if (pw) {
                try {
                  const privHex = await decryptKeystore(serverKeystore, pw);
                  const sk = hexDecode(privHex);
                  const pubBytes = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(sk)).publicKey;
                  const pubHex = encode(pubBytes);
                  if (!serverPub || serverPub === pubHex) {
                    localStorage.setItem('user_pubkey', pubHex);
                    localStorage.setItem('user_privkey', privHex);
                    console.log('Wallet restored on this device.');
                  } else {
                    // Prefer server side key: adopt server pub and decrypted priv
                    localStorage.setItem('user_pubkey', serverPub);
                    localStorage.setItem('user_privkey', privHex);
                    console.warn('Local wallet mismatched; adopted server wallet.');
                  }
                } catch {
                  console.warn('Failed to decrypt wallet with login password.');
                }
              }
            }

            // If both exist but differ: prefer server version when we can verify by decrypting
            if (serverKeystore && serverPub && localPub && localPriv && localPub !== serverPub) {
              try {
                const pw = sessionStorage.getItem('login_password') || '';
                if (pw) {
                  const privHex = await decryptKeystore(serverKeystore, pw);
                  const sk = hexDecode(privHex);
                  const derivedPub = encode(nacl.sign.keyPair.fromSecretKey(Uint8Array.from(sk)).publicKey);
                  if (derivedPub === serverPub) {
                    localStorage.setItem('user_pubkey', serverPub);
                    localStorage.setItem('user_privkey', privHex);
                    console.warn('Local wallet updated to match server.');
                  }
                }
              } catch {}
            }

            // First-time: no keystore on server (encrypt with login password silently)
            if (!serverKeystore) {
              let pub = localStorage.getItem('user_pubkey');
              let priv = localStorage.getItem('user_privkey');
              if (!pub || !priv) {
                const kp = generateKeypair();
                pub = kp.pubHex; priv = kp.privHex;
                try {
                  await withRetry('/auth/associate-pow-key', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken }, body: { powPubkey: pub } }, 1);
                } catch {}
              }
              const setPw = sessionStorage.getItem('login_password') || '';
              if (setPw) {
                try {
                  const ks = await encryptKeystore(priv!, setPw);
                  await withRetry('/auth/save-keystore', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken }, body: { powKeystore: ks, powPubkey: pub } }, 1);
                } catch {}
              }
            }

            // If serverPub missing or invalid (placeholder/dummy) but we have a valid local pub, associate it now
            const isPlaceholder = (hex: string) => !!hex && (/^0{64}$/.test(hex) || /^([0-9a-fA-F]{16})\1\1\1$/.test(hex));
            if ((!serverPub || !/^[0-9a-fA-F]{64}$/.test(serverPub) || isPlaceholder(serverPub)) && localPub && /^[0-9a-fA-F]{64}$/.test(localPub)) {
              try {
                await withRetry('/auth/associate-pow-key', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken }, body: { powPubkey: localPub } }, 1);
                setServerPowPub(localPub);
              } catch {}
            }

            // If both server and local pubkeys are invalid/placeholder: generate new locally and associate
            if ((!serverPub || isPlaceholder(serverPub) || !/^[0-9a-fA-F]{64}$/.test(serverPub)) && (!localPub || isPlaceholder(localPub) || !/^[0-9a-fA-F]{64}$/.test(localPub))) {
              try {
                const kp = generateKeypair();
                await withRetry('/auth/associate-pow-key', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken }, body: { powPubkey: kp.pubHex } }, 1);
                setServerPowPub(kp.pubHex);
                const setPw = sessionStorage.getItem('login_password') || '';
                if (setPw) {
                  const ks = await encryptKeystore(kp.privHex, setPw);
                  await withRetry('/auth/save-keystore', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken }, body: { powKeystore: ks, powPubkey: kp.pubHex } }, 1);
                }
              } catch {}
            }
          })
          .catch(() => {});
      }

      withRetry(`/auth/user?username=${username}`, { method: 'GET' }, 1).catch(() => {});
      try { sessionStorage.removeItem('login_password'); } catch {}
    }
  }, [username]);



  useEffect(() => {
    if (showSettings && username) {
      withRetry(`/auth/user?username=${username}`, { method: 'GET' }, 1)
        .then(res => res.json())
        .then(user => {
          setUserEmail(user.email);
          setSelectedColor(user.color);
        });
      withRetry(`/stats/volchain?username=${encodeURIComponent(username)}`, { method: 'GET' }, 1)
        .then(res => res.json())
        .then(v => {
          const serverPubFromStats = v?.volchain?.currentUser?.pubkey || '';
          if (/^[0-9a-fA-F]{64}$/.test(serverPubFromStats)) {
            setServerPowPub(serverPubFromStats);
          }
        })
        .catch(() => {});
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
      setShowContactUs(false);

      setShowMenu(false);
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
      const _result = await response.json();
      if (!response.ok) {
        alert(_result.error || "Password change failed");
        return;
      }
      // After password change, re-encrypt keystore with new password and save
      try {
        const sessionToken = localStorage.getItem('session_token');
        if (sessionToken) {
          let pubHex = localStorage.getItem('user_pubkey') || '';
          let privHex = localStorage.getItem('user_privkey') || '';
          if (!privHex) {
            // Try get server keystore and decrypt with OLD password
            const ksResp = await fetch('/auth/keystore', { headers: { 'X-Session-Token': sessionToken } });
            const ksJson = await ksResp.json();
            const serverKeystore = ksJson?.powKeystore as string | null;
            const serverPub = ksJson?.powPubkey as string | null;
            if (serverKeystore) {
              try {
                const decrypted = await decryptKeystore(serverKeystore, currentPassword);
                privHex = decrypted;
                const sk = hexDecode(privHex);
                const pubBytes = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(sk)).publicKey;
                const derivedPub = encode(pubBytes);
                if (!pubHex) pubHex = derivedPub;
                if (!serverPub || serverPub === derivedPub) {
                  localStorage.setItem('user_pubkey', derivedPub);
                  localStorage.setItem('user_privkey', privHex);
                }
              } catch {
                console.warn('Keystore decrypt with old password failed; skipping re-encrypt');
              }
            }
          }
          if (privHex && pubHex) {
            try {
              const newKs = await encryptKeystore(privHex, newPassword);
              await fetch('/auth/save-keystore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
                body: JSON.stringify({ powKeystore: newKs, powPubkey: pubHex })
              });
            } catch (e) {
              console.warn('Failed to save re-encrypted keystore:', e);
            }
          }
        }
      } catch (e) {
        console.warn('Post-change keystore update failed:', e);
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
    "#BBDEFB", "#B2EBF2", "#C8E6C9", "#DCEDC8", "#FFF9C4",
    "#FFE0B2", "#FFCCBC", "#D7CCC8", "#26A69A", "#CFD8DC",
    "#F44336", "#E91E63", "#9C27B0", "#673AB7", "#3F51B5",
    "#2196F3", "#03A9F4", "#00BCD4", "#009688", "#4CAF50",
    "#8BC34A", "#CDDC39", "#FFEB3B", "#FFC107", "#FF9800",
    "#FF5722", "#795548", "#607D8B"
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
      const json = await response.json();
      if (!response.ok) {
        alert(json?.error || "Color update failed");
        return;
      }
      alert("Color updated successfully");
      window.location.reload();
    } catch (error: any) {
      alert("Color update error: " + error.message);
    }
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName || !contactEmail || !contactMessage) {
      alert("Please fill in all fields");
      return;
    }
    try {
      const sessionToken = localStorage.getItem("session_token");
      if (!sessionToken) {
        alert("Please log in again to send a message.");
        return;
      }
      
      const response = await fetch(`/api/contact`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          name: contactName,
          email: contactEmail,
          message: contactMessage,
          username: username
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Failed to send message");
        return;
      }
      alert("Your message has been sent successfully! We'll get back to you soon.");
      setContactName("");
      setContactEmail("");
      setContactMessage("");
      setShowContactUs(false);
    } catch (error: any) {
      alert("Error sending message: " + error.message);
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
      await response.json();
      // Oturumu sıfırla ve kullanıcıyı logout et
      localStorage.removeItem("username");
      localStorage.removeItem(`color_${username}`);
      localStorage.removeItem("session_token");
      setUsername(null);
      setUserColor(null);
      setShowSettings(false);
      setShowAbout(false);
      setShowContactUs(false);
      setShowMenu(false);
      setShowGridB(false);
      setNewUsername("");
      alert("Username updated successfully! Please log in again with your new username.");
      // Sayfayı yenile (isteğe bağlı)
      window.location.reload();
    } catch (error: any) {
      console.error("Username update error:", error);
      alert(`Username update error: ${error.message}`);
    }
  };

  // Volchain Live page removed

  return (
    <div className="app-container">
      <div className="fixed-header-bg" />
      <header className="top-bar">
        {username && userColor && (
          <div className="button-container">
            <button
              className="menu-button"
              onClick={() => setShowMenu(!showMenu)}
              aria-label="Toggle Menu"
            >
              ☰
            </button>
          </div>
        )}
        <h1 className="title">⛏ BlockMiningGame</h1>
        {username && userColor && (
          <div className="welcome-header">Welcome {username}</div>
        )}
      </header>
      <MenuDropdownPortal
        open={showMenu}
        onInfo={() => { setShowAbout(true); setShowMenu(false); }}
        onSettings={() => { setShowSettings(true); setShowMenu(false); }}
        onVolore={() => { setShowVolore(true); setShowMenu(false); }}
        onVolchainActivity={() => { setShowVolchainActivity(true); setShowMenu(false); }}
        onContact={() => { setShowContactUs(true); setShowMenu(false); }}
        onLogout={() => { handleLogout(); setShowMenu(false); }}
      />
      <div className="header-overlay"></div>
      <div className="scrollable-content">
        <div className="content-container">
          <div className="banner-placeholder">
            <div className="banner-content">
              <img 
                src="/ads/banner.jpg" 
                alt="Advertisement" 
                className="banner-image"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  if (e.currentTarget.parentElement) {
                    e.currentTarget.parentElement.innerHTML = 'Ad Banner (728x90)';
                  }
                }}
              />
            </div>
          </div>
          {username && userColor && !showAbout && (
            <>
              <div className="button-group">
                {/* Reset Blocks button removed */}
                <button
                  onClick={() => setShowGridB(!showGridB)}
                  className="action-button my-blocks-button"
                  aria-label={showGridB ? "Digzone" : "Warzone"}
                >
                  {showGridB ? "Digzone" : "Warzone"}
                </button>

                <button
                  onClick={() => setShowBlockchainStats(true)}
                  className="action-button blockchain-stats-button"
                  aria-label="Volchain Stats"
                  style={{
                    background: 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)',
                    color: 'white',
                    border: 'none',
                    fontWeight: 'bold',
                  }}
                >
                  🔗 Volchain Stats
                </button>
                {/* Volchain Live link removed */}
              </div>
            </>
          )}
          
          {username && userColor ? (
            showAbout ? (
              <About setShowAbout={setShowAbout} />
            ) : showGridB ? (
              <GridB
                totalBlocks={blockData.length}
                username={username}
                userColor={userColor}
                tokenBalance={tokenBalance}
                setTokenBalance={setTokenBalance}
                setBlockData={setBlockData}
              />
            ) : (
              <Grid
                username={username}
                userColor={userColor}
                showSettings={showSettings}
                setShowSettings={setShowSettings}
                handleLogout={handleLogout}

                setUsername={setUsername}
                tokenBalance={tokenBalance}
                setTokenBalance={setTokenBalance}
                blockData={blockData}
                setBlockData={setBlockData}
              />
            )
          ) : (
            <Login onLogin={handleLogin} />
          )}
        </div>
        {showSettings && (
          <div className="settings-modal">
            <div className="settings-content">
              <div className="modal-header">
                <h3 className="modal-title">⚙️ Settings</h3>
                <button 
                  className="modal-close-x" 
                  onClick={() => setShowSettings(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
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
                <div className="form-group">
                  <label>Volchain Address (Server):</label>
                  <input
                    className="settings-input"
                    type="text"
                    value={serverPowPub || localStorage.getItem('user_pubkey') || ''}
                    readOnly
                    placeholder="Your Volchain address will appear here"
                  />
                  <button
                    type="button"
                    className="settings-button"
                    style={{ marginTop: 8 }}
                    onClick={async () => {
                      const v = serverPowPub || localStorage.getItem('user_pubkey') || '';
                      if (!v) return;
                      try { await navigator.clipboard.writeText(v); alert('Address copied'); } catch {}
                    }}
                    aria-label="Copy Volchain address"
                    title="Copy Volchain address"
                  >
                    ⧉ Copy
                  </button>
                </div>
                

              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Tokenomics removed */}
      {false && (
        <div className="settings-modal">
          <div className="settings-content">
            <div className="modal-header">
              <h3 className="modal-title">💰 Volore Tokenomics</h3>
              <button 
                className="modal-close-x" 
                onClick={() => {}}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ color: '#4CAF50', marginBottom: '12px' }}>🔸 Token Basics</h4>
                <p><strong>Name:</strong> Volore Token</p>
                <p><strong>Symbol:</strong> VOLORE</p>
                <p><strong>Network:</strong> Solana Devnet</p>
                <p><strong>Decimals:</strong> 9</p>
                <p><strong>Type:</strong> SPL Token</p>
                <p><strong>Contract:</strong> <span style={{ fontSize: '12px', fontFamily: 'monospace', backgroundColor: '#e8e8e8', padding: '2px 4px', borderRadius: '3px' }}>7gryqXLucgivS9NHgnA22WFZqLG8jU317pBJYeWkGynH</span></p>
                <p><strong>Explorer:</strong> <a href="https://explorer.solana.com/address/7gryqXLucgivS9NHgnA22WFZqLG8jU317pBJYeWkGynH?cluster=devnet" target="_blank" rel="noopener noreferrer" style={{ color: '#2196F3', textDecoration: 'none' }}>View on Solana Explorer ↗</a></p>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ color: '#E91E63', marginBottom: '12px' }}>🔸 Supply Info</h4>
                <p><strong>Total Supply:</strong> Unlimited (minted on-demand)</p>
                <p><strong>Circulating Supply:</strong> Based on player activity</p>
                <p><strong>Max Daily Supply:</strong> Limited by mining mechanics</p>
                <p><strong>Market Cap:</strong> N/A (Devnet token)</p>
                <p><strong>Initial Price:</strong> N/A (No monetary value)</p>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ color: '#2196F3', marginBottom: '12px' }}>🔸 How to Earn Volore</h4>
                <ul style={{ paddingLeft: '20px', lineHeight: '1.6' }}>
                  <li><strong>Mining:</strong> Dig blocks in Digzone</li>
                  <li><strong>PvP Combat:</strong> Battle in Warzone</li>
                  <li><strong>Castle Bonuses:</strong> Auto-mining from 10+ defense blocks</li>
                  <li><strong>Reset Warzone:</strong> Convert warzone blocks to Volore</li>
                </ul>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ color: '#FF9800', marginBottom: '12px' }}>🔸 Token Economics</h4>
                <ul style={{ paddingLeft: '20px', lineHeight: '1.6' }}>
                  <li><strong>Exchange Rate:</strong> 1 Block = 1 Volore</li>
                  <li><strong>Reset System:</strong> Warzone blocks → Volore tokens</li>
                  <li><strong>Supply Control:</strong> Earned through gameplay only</li>
                  <li><strong>Deflationary:</strong> Limited by game mechanics</li>
                </ul>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ color: '#795548', marginBottom: '12px' }}>🔸 Token Utility</h4>
                <ul style={{ paddingLeft: '20px', lineHeight: '1.6' }}>
                  <li><strong>Proof of Mining:</strong> Verifiable gaming achievement</li>
                  <li><strong>Leaderboard Status:</strong> Tracks player performance</li>
                  <li><strong>Portfolio Token:</strong> Add to wallet collection</li>
                  <li><strong>Future Features:</strong> Potential staking, governance</li>
                  <li><strong>Developer Testing:</strong> Blockchain gaming mechanics</li>
                </ul>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ color: '#9C27B0', marginBottom: '12px' }}>🔸 Wallet Setup</h4>
                <ol style={{ paddingLeft: '20px', lineHeight: '1.6' }}>
                  <li>Install Phantom/Solflare wallet</li>
                  <li>Switch to <strong>Devnet</strong> network</li>
                  <li>Copy your wallet address</li>
                  <li>Add address in Settings</li>
                  <li>Reset warzone to earn Volore!</li>
                </ol>
              </div>

              <div style={{ padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '8px', border: '1px solid #ddd' }}>
                <p style={{ margin: '0', fontSize: '14px', color: '#666' }}>
                  <strong>⚠️ Important:</strong> Volore is on Solana <em>Devnet</em> for testing purposes. 
                  This is not a real cryptocurrency and has no monetary value.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Contact Us Modal */}
      {showContactUs && (
        <div className="settings-modal">
          <div className="settings-content">
            <div className="modal-header">
              <h3 className="modal-title">📧 Contact Us</h3>
              <button 
                className="modal-close-x" 
                onClick={() => setShowContactUs(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '16px', color: '#666' }}>
                Have a question, suggestion, or found a bug? We'd love to hear from you!
              </p>
              <form onSubmit={handleContactSubmit}>
                <div className="form-group">
                  <label>Your Name:</label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Enter your name"
                    className="form-input"
                    required
                    title="Please enter your name"
                    onInvalid={(e) => e.currentTarget.setCustomValidity('Please enter your name')}
                    onInput={(e) => e.currentTarget.setCustomValidity('')}
                  />
                </div>
                <div className="form-group">
                  <label>Email Address:</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="Enter your email"
                    className="form-input"
                    required
                    title="Please enter a valid email address"
                    onInvalid={(e) => e.currentTarget.setCustomValidity('Please enter a valid email address')}
                    onInput={(e) => e.currentTarget.setCustomValidity('')}
                  />
                </div>
                <div className="form-group">
                  <label>Message:</label>
                  <textarea
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                    placeholder="Tell us about your issue, suggestion, or feedback..."
                    className="form-textarea"
                    rows={6}
                    required
                    title="Please enter your message"
                    onInvalid={(e) => e.currentTarget.setCustomValidity('Please enter your message')}
                    onInput={(e) => e.currentTarget.setCustomValidity('')}
                  />
                </div>
                <div className="form-group">
                  <button type="submit" className="settings-button">
                    Send Message
                  </button>
                  <button 
                    type="button" 
                    className="settings-button cancel-button" 
                    onClick={() => setShowContactUs(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      
      {/* Blockchain Stats Modal */}
      <BlockchainStats 
        isVisible={showBlockchainStats}
        onClose={() => setShowBlockchainStats(false)}
        username={username}
      />
      {/* Volore Modal */}
      {showVolore && (
        <div className="settings-modal" onClick={() => setShowVolore(false)}>
          <div className="settings-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">💰 Volore</h3>
              <button className="modal-close-x" onClick={() => setShowVolore(false)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <VolorePanel username={username} />
            </div>
          </div>
        </div>
      )}

      {/* Volchain Activity Modal */}
      {showVolchainActivity && (
        <div className="settings-modal" onClick={() => setShowVolchainActivity(false)}>
          <div className="settings-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">🧾 Volchain Activity</h3>
              <button className="modal-close-x" onClick={() => setShowVolchainActivity(false)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <VolchainActivity autoRefreshMs={30000} />
            </div>
          </div>
        </div>
      )}
      

    </div>
  );
};

export default App;