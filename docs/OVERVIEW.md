# BlockMiningGame System Overview

## What the system does
- Digzone: Users mine blocks on a grid. Each mined block equals 1 Volore (soft currency tied to on-chain snapshot).
- Warzone (GridB): Users place/support (stake) and attack blocks; each own block has a defense value. Defense >= 10 is a Castle.
- Volchain: A lightweight event chain logs mint/burn/transfer/stake/unstake; a snapshot.json maintains balances and staked amounts.
- Invariants: Volore = number of mined blocks (Digzone). Warzone consumes “Used” = sum(defense) from mined supply; Available = Mined − Used.

## Key mechanics
- Daily mining limit: 12 manual digs per day per user.
- Castle bonus: On the first dig of the day, each owned Castle (defense ≥ 10) auto-mines +1 block.
  - NEW: If not enough empty Digzone slots exist, the grid auto-expands (100s) before applying the full bonus.
- Warzone rules:
  - First placement can be anywhere; after that placements/attacks must be adjacent to user’s existing Warzone blocks.
  - Attacking reduces defender’s defense by 1 and costs both attacker and defender 1 mined block (burn events recorded).

## Services and files
- Backend server: Node/Express on port 3001 — file: `backend/server.js`
- Volchain engine: `backend/volchain_chain.js` with files in `backend/volchain/`
  - chain.log (JSONL), snapshot.json (balances/staked), blocks.log (sealed blocks)
- Frontend (React): `frontend/src/*` — key screens: `App.tsx`, `GridB.tsx`, `BlockchainStats.tsx`

## Today’s changes (stability + correctness)
- Castle bonus fix:
  - Implemented pre-bonus grid auto-expansion to guarantee full castle bonus payout on first daily dig.
- Volchain robustness:
  - Made event and snapshot writes strict (throw on failure) to avoid silent loss.
  - Existing server retry loop enqueues failed events to a pending queue and retries every 5s.
- Top Holders refresh (UI):
  - `BlockchainStats` Refresh now re-fetches holders along with stats to reflect transfers promptly.
- Full reset & reseed capability:
  - Added admin endpoint `POST /admin/volchain-reset-reseed` to hard reset the Volchain store and reseed balances from current Digzone and staked from Warzone (GridB).
  - Executed once; holders now match Digzone counts (e.g., Vol 357, Vacatay 209 at time of reset).

## Admin endpoints
- POST `/admin/volchain-reset-reseed`: Hard reset Volchain from current grid and GridB.
- POST `/admin/volchain-seed`: Reconcile snapshot balances with current Digzone counts.
- POST `/admin/grid-sync-from-volchain`: Reconcile Digzone to match snapshot (use with caution).
- POST `/admin/assign-pubkeys`: Assign missing Volchain addresses to users.
- POST `/admin/volchain-backfill-stakes`: Sync staked from GridB → Volchain.

## Runtime notes
- Background retry: pending Volchain events are retried every 5 seconds.
- Holders source: snapshot.json (`/volchain/holders`); UI displays names/colors mapping from users.
- Stats modal: shows grid stats and top holders; refresh updates both.

## Quick checks
- Verify chain: `GET /volchain/verify`
- Holders list: `GET /volchain/holders?limit=10`
- Grid: `GET /grid` and `GET /gridb`

## Future suggestions
- Add audit endpoint to diff Digzone vs snapshot per user.
- Protect admin endpoints with auth/role checks.
- Add metrics for pending queue depth and last append error.
