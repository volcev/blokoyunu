/*
  Property-based test: Ledger-first + Guard invariants
  - Runs 500 random operations across 3–5 users
  - After each op: verify /volchain/verify?mode=system ok:true
  - At end: verify blocks and system ok:true
  - Backs up and restores original backend/db.json, backend/gridb.json, backend/volchain/*, sessions.json
*/

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BACKEND_DIR = path.join(__dirname, '..');
const SANDBOX_ROOT = path.join(BACKEND_DIR, '_sandbox');
const DB_FILE = process.env.GAME_DB_PATH || path.join(SANDBOX_ROOT, 'db.json');
const GRIDB_FILE = process.env.GRIDB_PATH || path.join(SANDBOX_ROOT, 'gridb.json');
const VOLCHAIN_DIR = process.env.VOLCHAIN_DIR || path.join(SANDBOX_ROOT, 'volchain');
const SESSIONS_FILE = path.join(SANDBOX_ROOT, 'sessions.json');
const PORT = Number(process.env.PORT || 3001);
const API = `http://127.0.0.1:${PORT}`;

function readJSON(p, def){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); } catch{ return def; } }
function writeJSON(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
function copyDir(src, dst){ if (!fs.existsSync(src)) return; fs.mkdirSync(dst, { recursive:true }); for (const e of fs.readdirSync(src)) { const s=path.join(src,e), d=path.join(dst,e); const st=fs.statSync(s); if (st.isDirectory()) copyDir(s,d); else fs.copyFileSync(s,d); } }
function rimraf(p){ try{ fs.rmSync(p, { recursive:true, force:true }); } catch{} }

function mulberry32(a){ return function(){ let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; } }
function pickWeighted(rng, items){ const total = items.reduce((s,i)=>s+i.w,0); let x=rng()*total; for (const i of items){ if ((x-=i.w) <= 0) return i.v; } return items[items.length-1].v; }
function randomInt(rng, a, b){ return a + Math.floor(rng() * (b - a + 1)); }
function randomChoice(rng, arr){ return arr[Math.floor(rng()*arr.length)]; }

async function http(method, url, data, headers){ return axios({ method, url: API + url, data, headers: headers||{} }); }

function ensureGridLength(n){ const db = readJSON(DB_FILE,{grid:[],users:[]}); if (db.grid.length < n){ const add = n - db.grid.length; for (let i=0;i<add;i++){ db.grid.push({ index: db.grid.length+i, dugBy: null, color: null, visual: null }); } writeJSON(DB_FILE, db); }
  // also ensure GridB length matches
  const gridb = readJSON(GRIDB_FILE, []); if (gridb.length < n){ const copy = gridb.slice(); for (let i=gridb.length;i<n;i++) copy.push({ index:i, owner:null, color:null, visual:null, userBlockIndex:null }); writeJSON(GRIDB_FILE, copy); }
}

function genHex64(rng){ const hex='0123456789abcdef'; let s=''; for (let i=0;i<64;i++) s+=hex[Math.floor(rng()*16)]; return s; }

function backupAll(){ const stamp = Date.now().toString(); const tmp = path.join(BACKEND_DIR, `.testbak_${stamp}`); fs.mkdirSync(tmp, { recursive:true }); fs.copyFileSync(DB_FILE, path.join(tmp,'db.json.bak')); if (fs.existsSync(GRIDB_FILE)) fs.copyFileSync(GRIDB_FILE, path.join(tmp,'gridb.json.bak')); if (fs.existsSync(SESSIONS_FILE)) fs.copyFileSync(SESSIONS_FILE, path.join(tmp, 'sessions.json.bak')); const vdst = path.join(tmp,'volchain'); copyDir(VOLCHAIN_DIR, vdst); return tmp; }
function restoreAll(tmp){ try{ const dbb=path.join(tmp,'db.json.bak'); if (fs.existsSync(dbb)) fs.copyFileSync(dbb, DB_FILE); const gb=path.join(tmp,'gridb.json.bak'); if (fs.existsSync(gb)) fs.copyFileSync(gb, GRIDB_FILE); const ss=path.join(tmp,'sessions.json.bak'); if (fs.existsSync(ss)) fs.copyFileSync(ss, SESSIONS_FILE); rimraf(VOLCHAIN_DIR); copyDir(path.join(tmp,'volchain'), VOLCHAIN_DIR); } finally { rimraf(tmp); } }

function addSessions(users){ const sessions = readJSON(SESSIONS_FILE, {}); const out = {}; for (const u of users){ const tok = `test:${u.username}:${Date.now()}`; sessions[tok] = { username: u.username, createdAt: Date.now() }; out[u.username] = tok; } writeJSON(SESSIONS_FILE, sessions); return out; }

let __backupDir = null;
async function main(){
  const seed = Number(process.env.SEED || 123456);
  const steps = Number(process.env.STEPS || 500);
  const rng = mulberry32(seed >>> 0);
  console.log(`seed=${seed} steps=${steps}`);

  // Sandbox init
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  writeJSON(DB_FILE, { grid: [], users: [] });
  writeJSON(GRIDB_FILE, []);
  writeJSON(SESSIONS_FILE, {});
  __backupDir = backupAll();
  let db = readJSON(DB_FILE, { grid:[], users:[] });
  // Re-seed Volchain from current Digzone + GridB to start consistent
  try { await http('post','/admin/volchain-reset-reseed'); } catch(e){ /* ignore if unavailable */ }
  // Force seal pending mempool after reseed
  try {
    for (let i=0;i<5;i++) { try { await http('get','/volchain/seal'); } catch{} }
  } catch{}
  // Emergency: ensure staked equals GridB exactly (chain snapshot direct reconcile)
  try { await http('post','/admin/volchain-reconcile-stake-from-gridb'); } catch{}
  // Select existing users (3-5) with pubkeys and at least 1 mined block
  const minedByUser = {}; for (const b of db.grid){ if (b && b.dugBy) minedByUser[b.dugBy]=(minedByUser[b.dugBy]||0)+1; }
  let candidates = db.users.filter(u=>u && u.powPubkey && (minedByUser[u.username]||0) > 0);
  let testUsers = [];
  if (candidates.length < 3) {
    // Create fresh test users if not enough candidates
    const count = 3 + Math.floor(rng()*3); // 3..5
    const existingNames = new Set(db.users.map(u=>u.username));
    for (let i=0;i<count;i++){
      let name; do { name = `ptest_${Math.floor(rng()*1e6)}`; } while(existingNames.has(name));
      const pub = genHex64(rng);
      const color = '#'+genHex64(rng).slice(0,6);
      db.users.push({ email:`${name}@test.local`, username:name, color, powPubkey: pub, meta:{ test:true } });
      testUsers.push({ username:name, pubkey: pub });
    }
    writeJSON(DB_FILE, db);
  } else {
    const pickCount = Math.max(3, Math.min(5, candidates.length));
    const shuffled = candidates.sort(()=>rng()-0.5);
    const chosen = shuffled.slice(0, pickCount);
    testUsers = chosen.map(u=>({ username:u.username, pubkey:String(u.powPubkey) }));
  }

  // Sessions for each test user
  const userToSess = addSessions(testUsers);

  // Ensure grid large enough
  ensureGridLength(1000);

  // Bootstrap: give each test user 1 mined block to ensure available > 0
  for (const tu of testUsers) {
    try {
      const idx = randomEmptyGridIndex();
      const hdr = { 'x-session-token': userToSess[tu.username], 'X-Op-Id': `${Date.now()}-${Math.random()}` };
      await http('patch', `/grid/${idx}`, { visual:null }, hdr);
    } catch {}
  }
  // Seal after bootstrap
  try { await http('get','/volchain/seal'); } catch{}
  // Second bootstrap dig to ensure available>=2
  for (const tu of testUsers) {
    try {
      const idx = randomEmptyGridIndex();
      const hdr = { 'x-session-token': userToSess[tu.username], 'X-Op-Id': `${Date.now()}-${Math.random()}` };
      await http('patch', `/grid/${idx}`, { visual:null }, hdr);
    } catch {}
  }
  try { await http('get','/volchain/seal'); } catch{}

  // Weighted ops
  const weights = [
    { v:'dig', w:0.30 },
    { v:'stake', w:0.25 },
    { v:'unstake', w:0.20 },
    { v:'transfer', w:0.15 },
    { v:'attack', w:0.10 },
  ];

  function sessionHeader(user){ return { 'x-session-token': userToSess[user], 'X-Op-Id': (rng()<0.05 ? 'DUPLICATE-OP' : `${Date.now()}-${Math.random()}`) }; }

  // Helpers to compute availability and defense from files
  function recomputeFor(user){ const d = readJSON(DB_FILE,{grid:[],users:[]}); const g = readJSON(GRIDB_FILE, []); const mined = d.grid.reduce((a,b)=>a + (b.dugBy===user?1:0),0); const used = g.reduce((a,b)=> a + (b.owner===user ? (Number(b.defense||1)||1) : 0), 0); return { mined, used, available: Math.max(0, mined - used) }; }
  async function chainStateFor(user){ try{ const r = await http('get', `/volchain/user/${encodeURIComponent(user)}`); const d=r.data||{}; return { balance:Number(d.balance||0), staked:Number(d.staked||0), available:Number(d.available||0) }; } catch { return { balance:0, staked:0, available:0 }; } }

  function randomEmptyGridIndex(){ const d=readJSON(DB_FILE,{grid:[],users:[]}); const empties = d.grid.filter(b=>!b.dugBy).map(b=>b.index); if (empties.length===0){ ensureGridLength(d.grid.length+100); return randomEmptyGridIndex(); } return empties[Math.floor(rng()*empties.length)]; }
  function randomGridBEmpty(){ const d=readJSON(GRIDB_FILE,[]); const empties = d.filter(b=>!b.owner).map(b=>b.index); if (empties.length===0) return 0; return empties[Math.floor(rng()*empties.length)]; }
  function neighbors(idx, total, cols=50){ const list=[]; const col = idx % cols; if (idx>=cols) list.push(idx-cols); const b=idx+cols; if (b<total) list.push(b); if (col>0) list.push(idx-1); if (col<cols-1 && idx+1<total) list.push(idx+1); return list; }
  function pickAttackTarget(attacker){ const total = readJSON(DB_FILE,{grid:[]}).grid.length; const gridb = readJSON(GRIDB_FILE, []); const own = new Set(gridb.filter(b=>b.owner===attacker).map(b=>b.index)); const candidates=[]; for (const i of own){ for (const n of neighbors(i, total, 50)){ const b = gridb[n]; if (b && b.owner && b.owner!==attacker) candidates.push(n); } } return candidates.length? candidates[Math.floor(rng()*candidates.length)] : null; }

  async function sealMaybe(step){ try{ await http('get','/volchain/seal'); } catch{} }
  async function guardCheck(){ const r = await http('get','/volchain/verify?mode=system'); if (!r.data || r.data.ok!==true){ console.error('GUARD_RESPONSE', JSON.stringify(r.data)); throw new Error('GUARD_FAIL'); } }

  for (let i=1;i<=steps;i++){
    await sealMaybe(i); // flush pending mints before next op to align snapshot
    const user = randomChoice(rng, testUsers).username;
    let op = pickWeighted(rng, weights);
    // If availability constraints fail, fall back to a dig to make progress
    const cs = await chainStateFor(user);
    if ((op==='stake' || op==='transfer' || op==='attack') && cs.available<=0) op='dig';
    try {
      if (op==='dig'){
        const idx = randomEmptyGridIndex();
        const hdr = sessionHeader(user);
        // Try duplicate op_id occasionally
        await http('patch', `/grid/${idx}`, { visual:null }, hdr);
      } else if (op==='stake'){
        const cs2 = await chainStateFor(user);
        if (cs2.available<=0) { op='dig'; }
        if (op==='dig') {
          const idx = randomEmptyGridIndex();
          const hdr = sessionHeader(user);
          await http('patch', `/grid/${idx}`, { visual:null }, hdr);
        } else {
        const idx = randomGridBEmpty();
        const hdr = sessionHeader(user);
        await http('patch', `/gridb/${idx}`, {}, hdr);
        }
      } else if (op==='unstake'){
        const gridb = readJSON(GRIDB_FILE, []);
        const own = gridb.filter(b=>b.owner===user && Number(b.defense||1)>1);
        if (own.length===0) { i--; continue; }
        const idx = randomChoice(rng, own).index;
        const hdr = sessionHeader(user);
        await http('post', `/gridb/${idx}/unstake`, {}, hdr);
      } else if (op==='transfer'){
        const cs3 = await chainStateFor(user);
        if (cs3.available<=0) { op='dig'; }
        const others = testUsers.filter(u=>u.username!==user);
        if (others.length===0){ i--; continue; }
        const to = randomChoice(rng, others).pubkey;
        if (op==='dig') {
          const idx = randomEmptyGridIndex();
          const hdr = sessionHeader(user);
          await http('patch', `/grid/${idx}`, { visual:null }, hdr);
        } else {
          const amt = Math.max(1, Math.min(cs3.available, randomInt(rng,1,3)));
          const hdr = sessionHeader(user);
          await http('post', `/volchain/transfer`, { toPubkey: to, amount: amt }, hdr);
        }
      } else if (op==='attack'){
        const cs4 = await chainStateFor(user);
        if (cs4.available<=0) { op='dig'; }
        const target = pickAttackTarget(user);
        if (target===null){ i--; continue; }
        const hdr = sessionHeader(user);
        if (op==='dig') {
          const idx = randomEmptyGridIndex();
          await http('patch', `/grid/${idx}`, { visual:null }, hdr);
        } else {
          await http('patch', `/gridb/${target}`, {}, hdr);
        }
      }
      await guardCheck();
      await sealMaybe(i);
      if (i%50===0){ const h = await http('get','/_v1/volchain/health'); process.stdout.write(`.`); if (h.data && typeof h.data.mempoolSize==='number') { /* noop */ } }
    } catch (e) {
      console.error(`FAIL at step=${i}, seed=${seed}, op=${op}, user=${user}`, e.response?.data || e.message);
      throw e;
    }
  }

  // Final verifies
  const v1 = await http('get','/_v1/volchain/verify');
  const v2 = await http('get','/volchain/verify?mode=system');
  console.log('\nverify blocks ok=', v1.data?.ok, 'system ok=', v2.data?.ok);
  if (!v1.data?.ok || !v2.data?.ok) throw new Error('FINAL_VERIFY_FAIL');
}

main()
  .then(()=>{
    console.log('PASS steps complete');
  })
  .catch((err)=>{
    console.error('TEST FAILED:', err?.message || err);
  })
  .finally(()=>{
    try { if (__backupDir) restoreAll(__backupDir); } catch{}
  });


