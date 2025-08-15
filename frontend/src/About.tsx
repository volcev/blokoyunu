import React from "react";
import { marked } from "marked";
import "./App.css";

type Props = {
  setShowAbout: React.Dispatch<React.SetStateAction<boolean>>;
};

const aboutContent = `
# 🎮 BlockMiningGame

Mine blocks, battle in Warzone, and grow your territory. Your Volore balance is always equal to your mined blocks.

## 🎯 Core Rules

- **1 Block = 1 Volore**. Your total Volore always matches your total mined blocks in Digzone.
- **Daily Mining Limit**: You can dig up to **12 blocks/day**. On your first dig of the day, your castles auto-mine.
- **Dynamic Grid**: The grid expands automatically when it fills up.

## ⛏️ Digzone (Mining)

- Tap/click to mine empty blocks and claim them in your color.
- Each successful dig increases your mined block count by 1 (and thus your Volore by 1).

## ⚔️ Warzone (PvP)

- **First Placement**: Your first Warzone block can be placed anywhere.
- **Neighbor Rule**: After your first placement, new placements/attacks must be adjacent to your existing Warzone blocks.
- **Support (Defend)**: Supporting your own block increases its defense by +1. This consumes your stock but does not change your total mined blocks.
- **Attack**: Attacking an opponent's block reduces its defense by 1. When defense reaches 0, the block becomes ownerless.
- **Attack Cost (Invariant)**: Each attack causes both attacker and defender to lose 1 mined block (most recent). This keeps the rule (Volore = Mined Blocks) always true.

## 🏰 Castles

- A block with **defense ≥ 10** becomes a **Castle** (black border + golden glow).
- **Auto-Mining**: Each Castle auto-mines **+1 block/day**, applied on your first dig of the day.
- **First-Placement Protection**: Castles cannot be attacked on a player's very first placement.

## 💼 Transfers

- You can send Volore to another registered user by entering their Volchain address.
- Sending N Volore moves your last N mined Digzone blocks to the receiver. Both balances remain equal to their mined blocks.

## 📦 Stock, Used, Available

- **Used Volore** (Warzone): Sum of the defense values of your Warzone blocks.
- **Available Volore**: (Mined Blocks − Used). This is how many new Warzone actions (placements/supports) you can perform.

## 📊 Stats & Activity

- **Top Volore Miners**: Leaderboard based on mined blocks.
- **Volchain Activity**: Shows mint/burn/transfer events. (Support actions are not listed.)
- **Local Source**: Stats are computed on the server from the current grid state and reconciled after each action.

## 🔐 Accounts & Wallet

- No external wallet needed. Your **Volchain address** is managed in Settings and used for in-game transfers.
- Email verification and session-based login are supported.

---

Start mining, build castles, and dominate the Warzone!
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