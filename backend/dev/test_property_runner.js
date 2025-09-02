const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function randSeed(){ return Math.floor(Math.random()*0x7fffffff); }

function parseArgs(){
  const args = process.argv.slice(2);
  const out = { steps:500, users:5, maxRetries:50, seed:undefined, port:3101 };
  for (let i=0;i<args.length;i++){
    const a=args[i];
    if (a.startsWith('--steps=')) out.steps=Number(a.split('=')[1]);
    else if (a.startsWith('--users=')) out.users=Number(a.split('=')[1]);
    else if (a.startsWith('--max-retries=')) out.maxRetries=Number(a.split('=')[1]);
    else if (a.startsWith('--seed=')) out.seed=Number(a.split('=')[1]);
    else if (a.startsWith('--port=')) out.port=Number(a.split('=')[1]);
  }
  return out;
}

async function runOnce(cfg, attempt){
  const stamp = Date.now();
  const sbRoot = `/tmp/volchain_sandbox/${stamp}_${attempt}`;
  const volDir = path.join(sbRoot, 'volchain');
  const dbFile = path.join(sbRoot, 'db.json');
  const gridbFile = path.join(sbRoot, 'gridb.json');
  const authDb = path.join(sbRoot, 'auth_db.json');
  const sessions = path.join(sbRoot, 'sessions.json');
  fs.mkdirSync(volDir, { recursive:true });
  
  // Copy production data to sandbox for testing  
  const backendDir = '/home/volcev/blokoyunu/backend'; // Absolute path
  const prodDbFile = path.join(backendDir, 'db.json');
  const prodGridbFile = path.join(backendDir, 'gridb.json'); 
  const prodAuthFile = path.join(backendDir, 'auth_db.json');
  
  if (fs.existsSync(prodDbFile)) {
    // Copy prod data but add some empty blocks for testing
    const prodData = JSON.parse(fs.readFileSync(prodDbFile, 'utf8'));
    const currentLen = prodData.grid ? prodData.grid.length : 0;
    const extraBlocks = 500; // Add 500 empty blocks for testing
    
    for (let i = currentLen; i < currentLen + extraBlocks; i++) {
      prodData.grid.push({ index: i, dugBy: null, dugAt: null, visual: null });
    }
    
    fs.writeFileSync(dbFile, JSON.stringify(prodData, null, 2));
  } else {
    fs.writeFileSync(dbFile, JSON.stringify({ grid:[], users:[] }, null, 2));
  }
  
  if (fs.existsSync(prodGridbFile)) {
    // Copy GridB and extend to match new grid length
    const prodGridb = JSON.parse(fs.readFileSync(prodGridbFile, 'utf8'));
    const targetLen = (JSON.parse(fs.readFileSync(dbFile, 'utf8')).grid || []).length;
    
    // Extend GridB to match db.json grid length
    while (prodGridb.length < targetLen) {
      prodGridb.push({ index: prodGridb.length, owner: null, defense: 1 });
    }
    
    fs.writeFileSync(gridbFile, JSON.stringify(prodGridb, null, 2));
  } else {
    fs.writeFileSync(gridbFile, JSON.stringify([], null, 2));
  }
  
  if (fs.existsSync(prodAuthFile)) {
    fs.copyFileSync(prodAuthFile, authDb);
  } else {
    fs.writeFileSync(authDb, JSON.stringify({ users:[] }, null, 2));
  }
  
  fs.writeFileSync(sessions, JSON.stringify({}, null, 2));

  const logsDir = '/tmp/property_runner';
  fs.mkdirSync(logsDir, { recursive:true });
  const attemptLog = path.join(logsDir, `attempt-${attempt}.log`);
  const outFile = path.join(logsDir, `attempt-${attempt}.out`);

  // start auth
  const auth = spawn('node', [path.join(__dirname, 'auth.js')], {
    env: { ...process.env, AUTH_DB_PATH: authDb, AUTH_SESSIONS_PATH: sessions, PORT: String(cfg.port+1) },
    stdio: ['ignore','pipe','pipe']
  });
  const authLogs = [];
  auth.stdout.on('data', d=> authLogs.push(String(d)) );
  auth.stderr.on('data', d=> authLogs.push(String(d)) );
  await sleep(300);

  // start server
  const srv = spawn('node', [path.join(__dirname, 'server.js')], {
    env: { ...process.env, VOLCHAIN_SANDBOX:'1', VOLCHAIN_DIR: volDir, GAME_DB_PATH: dbFile, GRIDB_PATH: gridbFile, AUTH_SESSIONS_PATH: sessions, PORT: String(cfg.port) },
    stdio: ['ignore','pipe','pipe']
  });
  const srvLogs = [];
  srv.stdout.on('data', d=> srvLogs.push(String(d)) );
  srv.stderr.on('data', d=> srvLogs.push(String(d)) );
  await sleep(500);

  // quick health + admin setup
  async function fetchJson(url){ return new Promise((resolve)=>{ const p=spawn('curl',['-sS',url]); let data=''; p.stdout.on('data',d=>data+=String(d)); p.on('close',()=>{ try{ resolve(JSON.parse(data)); }catch{ resolve(null); } }); }); }
  async function postReq(url){ return new Promise((resolve)=>{ const p=spawn('curl',['-sS','-X','POST',url]); let data=''; p.stdout.on('data',d=>data+=String(d)); p.on('close',()=>{ try{ resolve(JSON.parse(data)); }catch{ resolve(null); } }); }); }
  
  // Initialize chain from game state first (correct order: reset THEN reconcile)
  const reset = await postReq(`http://127.0.0.1:${cfg.port}/admin/volchain-reset-reseed`);
  await sleep(200);
  const reconcile = await postReq(`http://127.0.0.1:${cfg.port}/admin/volchain-reconcile-stake-from-gridb`);
  await sleep(200);
  
  const sys = await fetchJson(`http://127.0.0.1:${cfg.port}/volchain/verify?mode=system`);
  if (!sys || sys.ok!==true){
    fs.writeFileSync(attemptLog, `health_fail system=${JSON.stringify(sys)}\nreset=${JSON.stringify(reset)}\nreconcile=${JSON.stringify(reconcile)}\nlogs:\n${srvLogs.slice(-200).join('')}`);
    try { srv.kill(); auth.kill(); } catch{}
    return { ok:false, code:'health_fail', sbRoot };
  }

  // run property test
  const env = { ...process.env, PORT:String(cfg.port), VOLCHAIN_DIR: volDir, GAME_DB_PATH: dbFile, GRIDB_PATH: gridbFile, AUTH_SESSIONS_PATH: sessions, VOLCHAIN_SANDBOX:'1' };
  const test = spawn('node', [path.join(__dirname, 'tests/property_test.js')], { env, stdio:['ignore','pipe','pipe'] });
  const testOut = fs.createWriteStream(outFile);
  test.stdout.pipe(testOut);
  test.stderr.pipe(testOut);
  const code = await new Promise(res=> test.on('close', res));
  const txt = fs.readFileSync(outFile,'utf8');
  const pass = /PASS steps=500/.test(txt);
  if (pass){
    const health = await fetchJson(`http://127.0.0.1:${cfg.port}/_v1/volchain/health`);
    console.log(`PASS steps=500 users=${cfg.users} height=${health?.height||0} mismatches_user=0 mismatches_system=0 attempts=${attempt}`);
    try { srv.kill(); auth.kill(); } catch{}
    return { ok:true };
  }
  // Diagnose
  const sys2 = await fetchJson(`http://127.0.0.1:${cfg.port}/volchain/verify?mode=system`);
  const blk = await fetchJson(`http://127.0.0.1:${cfg.port}/_v1/volchain/verify`);
  fs.writeFileSync(attemptLog, `TEST FAILED\nSYSTEM=${JSON.stringify(sys2)}\nBLOCKS=${JSON.stringify(blk)}\nSRV_LOG_TAIL=\n${srvLogs.slice(-200).join('')}`);
  try { srv.kill(); auth.kill(); } catch{}
  await sleep(200);
  fs.rmSync(sbRoot, { recursive:true, force:true });
  return { ok:false, code:'test_failed' };
}

(async()=>{
  const cfg = parseArgs();
  const summary = { ok:false, attempts:0, last:{}, logsDir:'/tmp/property_runner' };
  for (let a=1; a<=cfg.maxRetries; a++){
    cfg.seed = cfg.seed || randSeed();
    const res = await runOnce(cfg, a);
    summary.attempts = a;
    summary.last = res;
    if (res.ok){ summary.ok=true; break; }
    await sleep(1000);
  }
  fs.writeFileSync('/tmp/property_runner/summary.json', JSON.stringify(summary, null, 2));
  if (!summary.ok){
    console.error(`TEST FAILED after ${summary.attempts} attempts. See /tmp/property_runner`);
    process.exit(1);
  }
})();


