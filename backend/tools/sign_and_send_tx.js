// tools/sign_and_send_tx.js (Node 18+, ESM)
import fs from 'fs';
import path from 'path';
import { bech32 } from 'bech32';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { createHash } from 'crypto';

const RPC = process.env.VOL_RPC || 'https://thisisthecoin.com';
const CHAIN_ID = 'volchain-main';
const WALLET = path.resolve(process.env.HOME || '.', '.volc_wallet.json');
const PREFIX = 'v1';
const enc = new TextEncoder();

const b64d = (s)=> Buffer.from(s, 'base64');
const b64e = (u)=> Buffer.from(u).toString('base64');
const BLAKE = (b)=> createHash('sha256').update(b).digest().subarray(0,20); // fallback

// Provide SHA-512 for noble-ed25519 (cover both utils & etc)
ed.utils.sha512Sync = (msg) => sha512(msg);
if (ed.etc) ed.etc.sha512Sync = (msg) => sha512(msg);

function pubkeyToAddress(pubU8){
  const h20 = BLAKE(pubU8);
  const words = bech32.toWords(h20);
  return bech32.encode(PREFIX, words);
}

function sortedObject(obj){
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  Object.keys(obj).sort().forEach(k => { out[k] = obj[k]; });
  return out;
}

function canonicalTxPayload(tx){
  const obj = {
    chain_id: CHAIN_ID,
    type: tx.type ?? null,
    from: tx.from ?? null,
    to: (typeof tx.to === 'undefined') ? null : tx.to,
    amount: Number(tx.amount),
    nonce: Number(tx.nonce),
    memo: tx.memo ? sortedObject(tx.memo) : null,
    pubkey: tx.pubkey ?? null
  };
  return JSON.stringify(obj);
}

async function loadOrCreateWallet(){
  if (fs.existsSync(WALLET)) {
    const w = JSON.parse(fs.readFileSync(WALLET,'utf8'));
    return { ...w, pubU8: b64d(w.publicKey), secU8: b64d(w.secretKey) };
  }
  const secU8 = ed.utils.randomPrivateKey();
  const pubU8 = await ed.getPublicKey(secU8);
  const wallet = {
    type: 'ed25519',
    publicKey: b64e(pubU8),
    secretKey: b64e(secU8),
    address: pubkeyToAddress(pubU8)
  };
  fs.writeFileSync(WALLET, JSON.stringify(wallet,null,2), { mode: 0o600 });
  return { ...wallet, pubU8, secU8 };
}

async function getNonce(addr){
  try {
    const r = await fetch(`${RPC}/volchain/state/${addr}`);
    if (r.ok) { const j = await r.json(); return j?.nonce ?? 0; }
  } catch {}
  return 0;
}

async function sendTx(tx){
  const res = await fetch(`${RPC}/volchain/tx`, {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify(tx)
  });
  const j = await res.json().catch(()=>({}));
  if(!res.ok || !j.ok){
    // Try canonicalize for debug
    try {
      const r2 = await fetch(`${RPC}/volchain/canonicalize`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(tx) });
      const j2 = await r2.json().catch(()=>({}));
      console.error('Server canonical:', j2);
    } catch {}
    throw new Error(`TX_REJECTED ${res.status}: ${JSON.stringify(j)}`);
  }
  return j;
}

const [,, cmd, arg1, arg2, ...rest] = process.argv;
let toWalletPath = null;
for (let i=0;i<rest.length;i++) {
  if (rest[i] === '--to-wallet') { toWalletPath = rest[i+1]; i++; }
}
if (!['stake','unstake','transfer'].includes(cmd)) {
  console.log('Usage:\n  node tools/sign_and_send_tx.js stake <amount>\n  node tools/sign_and_send_tx.js unstake <amount>\n  node tools/sign_and_send_tx.js transfer <toAddress> <amount>');
  process.exit(1);
}
const wallet = await loadOrCreateWallet();
const from = wallet.address;
const pubB64 = b64e(wallet.pubU8);

let to=null, amount=0, memo=null, type=cmd;
if (cmd==='transfer') { to = arg1; amount = parseInt(arg2,10); }
else { amount = parseInt(arg1,10); }
if (!(Number.isInteger(amount) && amount>0)) throw new Error('BAD_AMOUNT');

const prev = await getNonce(from);
const tx = { type, from, to, amount, nonce: prev+1, memo, pubkey: pubB64, sig: '' };
if (cmd==='transfer' && toWalletPath) {
  try {
    const w2 = JSON.parse(fs.readFileSync(toWalletPath,'utf8'));
    tx.memo = tx.memo || {};
    tx.memo.toPubkey = w2.publicKey; // base64
  } catch {}
}
const payload = canonicalTxPayload(tx);
console.error('Client canonical:', payload);
{
  const msg = enc.encode(payload);
  let sigU8;
  if (typeof ed.signAsync === 'function') {
    sigU8 = await ed.signAsync(msg, wallet.secU8);
  } else {
    sigU8 = await ed.sign(msg, wallet.secU8);
  }
  tx.sig = b64e(sigU8);
}

console.log('TX →', tx);
const out = await sendTx(tx);
console.log('OK:', out);


