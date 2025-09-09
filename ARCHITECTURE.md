# ARCHITECTURE

## Modules and Responsibilities
- backend/server.js: Main API server (Express, port 3001). Boots app, common middleware, mounts route modules.
- backend/auth.js: Auth microservice (Express, port 3002). Signup/login/email, sessions, user profile endpoints.
- backend/volchain_chain.js: Lightweight chain engine: append events, maintain snapshot, get holders/blocks, verify.
- backend/volchain_guard.js: Invariant guard and system verification (DB/GridB/VolChain cross-checks).
- backend/routes/
  - contact.js: Contact form endpoints.
  - volchain.js: Volchain read/write endpoints (health, blocks, tx, canonicalize, holders, events, verify, seal). Enriches events with usernames (pubkey/addr/gridIndex resolution).
  - gridb.js: GridB read endpoint (others remain in server until migrated).
  - auth.js: Proxy endpoints for auth service (login, signup, verify, forgot, reset).
  - stats.js: Stats and top-miners endpoints.
  - admin.js: Admin operations (faucet, export snapshot, invariants check/correct, align-from-digzone).
- backend/lib/
  - db.js: readDB/writeDB helpers.
  - gridb.js: readGridB/writeGridB helpers.
  - session.js: validateSession helper.
  - utils.js: genOpId/resolveOpId.
  - stats.js: computeLocalStats.
  - admin.js: getAdminSecret.

## REST Endpoints (method, path, brief schema)
- Digzone
  - GET /grid → [Block]
  - PATCH /grid/:index { visual? } → mines one block (daily limit, castle bonus, mint)
  - POST /expand → expands grid by 100
- Warzone (GridB)
  - GET /gridb → [GridBBlock]
  - PATCH /gridb/:index → place/support/attack
  - POST /gridb/:index/unstake → defense -1
  - DELETE /gridb/:index → full removal
- Stats / Holders / Volchain
  - GET /stats/volchain[?username] → { grid, volchain }
  - GET /volchain/holders?limit=N → holders
  - GET /volchain/events?limit=N[&cursor] → { events, nextCursor }
  - GET /volchain/health → snapshot health info
  - GET /volchain/blocks?limit=N[&cursor] → blocks list
  - GET /volchain/verify → verification result; use mode=system for cross-invariant report
  - POST/GET /volchain/seal → seal pending events into a block
- Admin / Maintenance
  - POST /admin/volchain-seed → reconcile balances from Digzone
  - POST /admin/volchain-backfill-stakes → stake/unstake to match GridB
  - POST /admin/volchain-align-from-digzone → rebuild snapshot/staked from DB/GridB
  - POST /admin/grid-sync-from-volchain → expand/allocate grid to match snapshot
  - POST /admin/normalize-grid-length → ensure grid length multiple of 100 and sync GridB
  - POST /admin/volchain-reset-reseed → hard reset and reseed from Digzone + GridB
  - POST /admin/volchain-faucet → faucet (routes/admin.js)
  - GET /admin/export-snapshot → snapshot download (routes/admin.js)
- User / Auth (proxied to 3002)
  - POST /login, /signup, /forgot-password, /reset-password; GET /verify-email
- Contact
  - POST /api/contact, GET /api/admin/contacts

## Data Directory and Files
- backend/volchain/
  - chain.log: event stream (append-only)
  - snapshot.json: balances/staked state, updated at append
  - blocks.log: sealed block headers produced by seal
  - blocks/: sealed block payloads (JSON per height)
  - mempool.jsonl: queued transactions awaiting seal
- backend/db.json: Digzone grid + users
- backend/gridb.json: Warzone (GridB) state

## Game Flows
- Digzone mint (mine block): PATCH /grid/:index checks session, limit, castle bonus, marks block, writes DB, appends mint bundle (ledger-first + barrier). Daily limit: 20.
- Castle bonus: On the first dig of the day, each owned castle (defense ≥ 10) auto-mines +1 block. Grid auto-expands if needed. Bonus is minted as a single aggregated MINT (amount = number of owned castles) with reason 'castle_bonus'.
- Warzone stake/unstake/attack: PATCH /gridb/:index with neighbor checks; POST /gridb/:index/unstake; DELETE /gridb/:index
- Transfer: POST /volchain/transfer computes available and appends transfer

## VolChain Core Events (Only These Are Persisted)
- mint (reason: 'dig' | 'castle_bonus') → Volore balance increases
- burn (reason: 'attack_burn_attacker' | 'attack_burn_defender') → Volore balance decreases  
- transfer → Volore moves between users
- stake/unstake operations are NOT written to VolChain; they're managed locally in GridB/JSON only

## Block Producer & Mempool
- Background producer seals mempool.jsonl → blocks every 1-2 seconds
- Core event filter: drops non-core txs (stake/unstake/remove_block) during mempool load
- Oversized tx skip: if a tx doesn't fit in current block, skip it and try next txs
- Salvage mode: if batch application fails, apply txs one-by-one and drop permanently invalid ones
- mempool.jsonl stores only core events; pending queue (volchain_pending.json) handles retry logic

## Security / Headers
- X-Session-Token required for user mutations.
- X-Chain-Id must match 'volchain-main' for write paths.
- X-Op-Id (UUID v4) required for idempotency on critical writes.

## Ports / Deployment Notes
- Backend API server: 0.0.0.0:3001
- Auth service: 0.0.0.0:3002
- Nginx/PM2 recommended; routes exposed via Nginx host
  - Public domain: thisisthecoin.com

## Persistence & Storage
- JSON Files: db.json (Digzone + users), gridb.json (Warzone), accounts.json (derived balances)
- PostgreSQL: Dual-write to dig_blocks, gridb_blocks, users, accounts, vol_events tables
- VolChain: snapshot.json (balances/staked), chain.log (events), blocks/ (sealed), mempool.jsonl (pending)

## Schemas (brief)
- Grid block: { index: number, dugBy: string|null, owner: string|null, status: 'dug'|null, mined_seq: number, color?: string|null, visual?: any|null }
- GridB block: { index: number, owner: string|null, defense: number, color?: string|null, visual?: any|null, userBlockIndex?: number }
- VolChain core events (only these persist to chain):
  - mint { type:'mint', from:'SYSTEM', amount, memo: { reason:'dig'|'castle_bonus', toPubkey, dig_id?, op_id } }
  - burn { type:'burn', from: addr, amount, memo: { reason:'attack_burn_attacker'|'attack_burn_defender', op_id } }
  - transfer { type:'transfer', from: addr, to: addr, amount, memo: { op_id } }
- Non-core events (GridB/JSON only): stake, unstake, support, remove_block, manual_unstake

