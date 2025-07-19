import React from "react";
import { marked } from "marked";
import "./App.css";

type Props = {
  setShowAbout: React.Dispatch<React.SetStateAction<boolean>>;
};

const aboutContent = `
# BlockMiningGame: A Rewarding Blockchain Game

Welcome to BlockMiningGame, a fun web game powered by Solana blockchain! Dig blocks in a 10x10 grid to collect them, reset your blocks to earn THET tokens, and compete to rank on the leaderboard.

## How to Play
1. Sign up at [thisisthecoin.com](https://thisisthecoin.com) and verify your email.
2. Dig empty blocks in the grid to collect them.
3. Reset your dug blocks with the "Reset Blocks" button to earn 1 THET per block. **Important**: Add your Phantom wallet address in settings to earn tokens.
4. Check the "Top Miners" leaderboard to see your rank!

## Solana Devnet Wallet Setup
Use a Solana devnet wallet to receive THET tokens:
1. Install a wallet like [Phantom](https://phantom.app/), [Solflare](https://solflare.com/), or [Backpack](https://backpack.app/).
2. Switch to the Devnet network in your wallet settings.
3. Copy your wallet’s public address and add it in the game’s settings.
4. Earned THET tokens will appear in your devnet wallet. **Note**: Devnet tokens are for testing and have no real-world value.

## Features
- **Fun Gameplay**: Grid expands automatically when full.
- **Solana Integration**: Tokens are sent to your wallet via Solana devnet.
- **Secure System**: Email-verified signup and secure login.
- **Block Reset**: Reset your blocks, keep your tokens in your wallet.
- **Customization**: Personalize your blocks with custom letters.

## Future Vision
- **Community Governance**: THET holders will vote on game updates.
- **Mainnet Launch**: In 2026, THET will gain real value on Solana mainnet.
- **New Features**: Custom colors, avatars, and marketplace.
- **Token Pool**: Ad revenue and sponsorships will boost THET value.

## Timeline
- **Q3 2025**: Devnet testing with core gameplay.
- **Q4 2025**: Community voting beta.
- **Q1 2026**: Mainnet launch, THET becomes official.
- **Q2 2026**: New in-game features.
- **Q3 2026**: Token pool for value growth.

Join BlockMiningGame, dig, and shape the future with our community!
`;

const About: React.FC<Props> = ({ setShowAbout }) => {
  const htmlContent = marked.parse(aboutContent) as string;

  return (
    <div className="app-container">
      <h1>About BlockMiningGame</h1>
      <button
        className="settings-button"
        style={{ backgroundColor: "#ff4d4f", margin: "10px auto", display: "block" }}
        onClick={() => setShowAbout(false)}
      >
        Close
      </button>
      <div
        style={{ maxWidth: "100%", width: "100%", margin: "0 auto", textAlign: "left", padding: "0 10px", boxSizing: "border-box" }}
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </div>
  );
};

export default About;