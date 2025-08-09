import React from "react";
import { marked } from "marked";
import "./App.css";

type Props = {
  setShowAbout: React.Dispatch<React.SetStateAction<boolean>>;
};

const aboutContent = `
# 🎮 BlockGame: Blockchain Mining Game

**A fun mining game running on Solana blockchain!** Mine blocks to earn tokens and climb the leaderboard.

## 🎯 How to Play

### 🔸 Mining System
- **Dig blocks** in the Digging Grid to claim them
- You have **12 blocks** mining limit per day (daily limit)
- Mined blocks appear in your color

### 🔸 Warzone Battle System  
- **Fight other players** in the Warzone
- **Attack** other players' blocks or **support** your own blocks
- **Defense system**: Blocks have defense values, lost when reduced to zero
- **Neighbor rule**: Must have adjacent block to attack (except first placement)
- **🏰 Castle system**: 10-defense blocks provide special protection and bonuses!

### 🔸 Reset & Token Earning
- **Reset Warzone** to earn **THET tokens** based on your warzone blocks
- Resets **both warzone and equivalent digzone blocks**
- Each warzone block = **1 THET** (Solana devnet) 
- **Example**: 30 warzone blocks → 30 THET + removes 30 warzone + 30 digzone blocks
- Don't forget to add your **wallet address** in settings!

### 🔸 🏰 Castle System (New!)
- **10+ defense block** = **Castle** (black border + golden glow)
- **Auto-mining**: Each castle **automatically mines +1 block per day**!
- **Special protection**: Cannot attack castles on first placement
- **Passive income**: Castles are long-term investment with exponential growth!

## ⚙️ Wallet Setup (Solana Devnet)

1. Install **Phantom**, **Solflare**, or **Backpack** wallet
2. Switch to **Devnet** network in wallet settings
3. Copy your public address and add it to game settings
4. Your earned THET tokens will appear in your devnet wallet

> ⚠️ **Note**: Devnet tokens are for testing purposes and have no real value.
> 
> 🎁 **Mainnet Airdrop**: When the game launches on Solana mainnet, all players will receive a **1:1 airdrop** of their earned testnet THET tokens! Keep playing and accumulating tokens during the test phase.

## 🎨 Game Features

- ✅ **Real-time Combat**: Instant PvP in Warzone
- ✅ **Daily Mining Limit**: Fair gameplay experience
- ✅ **Defense System**: Block protection mechanics
- ✅ **🏰 Castle System**: Auto-mining for 10-defense blocks
- ✅ **Token Rewards**: THET token for each block
- ✅ **Leaderboard**: View top miners
- ✅ **Neighbor Rules**: Strategic battle positioning
- ✅ **Responsive Design**: Mobile and desktop compatible
- ✅ **Secure System**: Email verification and session management

## 🚀 Latest Features (2025)

- **🏰 NEW**: Castle system - 10-defense blocks auto-mine daily!
- **🛡️ NEW**: Castle protection rules - no castle attacks on first placement
- **✨ NEW**: Enhanced Block Info Modal - castle info and strategic guidance
- **⚔️ NEW**: Neighbor rules - strategic battle positions
- **🎨 NEW**: Castle visual effects - black border + golden glow
- **🔧 Improvement**: Wallet integration and automatic token transfer
- **🔧 Improvement**: Enhanced mobile compatibility and zoom protection

## 📊 Statistics

- **Grid Size**: Dynamic expansion (grows when full)
- **Token Type**: THET (Solana SPL Token)
- **Network**: Solana Devnet
- **Daily Limit**: 12 blocks/user (+ castle bonus)
- **Defense Range**: 1-∞ (10+ defense = Castle)
- **🏰 Castle Bonus**: Each castle auto-mines +1 block per day
- **Battle Cost**: Each attack = both sides lose 1 block

## 🎯 Strategic Game Guide

### 🏰 Castle Strategies
- **Early Game**: Mine first 10 blocks, build 1 castle immediately (10-day ROI)
- **Long-term**: Each castle provides exponential growth - compound effect!
- **Defense vs Expansion**: Many low-defense blocks vs few castles

### ⚔️ Battle Tactics
- **Neighbors**: Expand territory first, then target castles
- **Castle Hunting**: Destroying 10-defense blocks cuts enemy passive income
- **First Placement**: Cannot attack castles directly, take neighbor block first

### 💰 Resource Management
- **Stock Formula**: (Mined blocks) - (Total defense usage)
- **Balance**: Too much defense = cannot make new attacks
- **Reset Timing**: Reset when you need tokens

---

**🎮 Start mining now!** Dig blocks, earn tokens, and grow with the community!
`;

const About: React.FC<Props> = ({ setShowAbout }) => {
  const htmlContent = marked.parse(aboutContent) as string;

  return (
    <div className="settings-modal">
      <div className="settings-content">
        <div className="modal-header">
          <h3 className="modal-title">🎮 BlockGame Info</h3>
          <button 
            className="modal-close-x" 
            onClick={() => setShowAbout(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <div 
            dangerouslySetInnerHTML={{ __html: htmlContent }}
            style={{
              textAlign: 'left',
              lineHeight: '1.6',
              color: '#333',
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default About;