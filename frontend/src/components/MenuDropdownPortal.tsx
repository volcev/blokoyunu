import React from "react";
import ReactDOM from "react-dom";

interface MenuDropdownPortalProps {
  open: boolean;
  top?: number;
  left?: number;
  onInfo: () => void;
  onSettings: () => void;
  onVolore: () => void;
  onVolchainActivity: () => void;
  // Removed Tokenomics
  onContact: () => void;
  onLogout: () => void;
}

const MenuDropdownPortal: React.FC<MenuDropdownPortalProps> = ({
  open,
  top = 70,
  left = 24,
  onInfo,
  onSettings,
  onVolore,
  onVolchainActivity,
  
  onContact,
  onLogout,
}) => {
  if (!open) return null;
  return ReactDOM.createPortal(
    <div
      className="menu-dropdown"
      style={{
        position: "fixed",
        zIndex: 9999,
        top,
        left,
        right: "auto",
        minWidth: 160,
        maxWidth: "90vw",
        width: "auto",
      }}
    >
      <button onClick={onInfo}>Info</button>
      <button onClick={onSettings}>Settings</button>
      <button onClick={onVolore}>Volore</button>
      <button onClick={onVolchainActivity}>Volchain Activity</button>
      
      <button onClick={onContact}>Contact Us</button>
      <button
        onClick={onLogout}
        style={{ backgroundColor: "#ff4d4f", color: "white", border: "none", borderRadius: 6 }}
      >
        Logout
      </button>
    </div>,
    document.body
  );
};

export default MenuDropdownPortal;