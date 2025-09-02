#!/usr/bin/env node
// Simple Volchain CLI
// Usage:
//   node tools/volc.js head
//   node tools/volc.js verify
//   node tools/volc.js balance <address|me>
//   node tools/volc.js stake <amount>
//   node tools/volc.js unstake <amount>
//   node tools/volc.js transfer <toAddress> <amount> [--to-wallet <path>]

import fs from 'fs';
import path from 'path';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { bech32 } from 'bech32';

const RPC = process.env.VOL_RPC || 'https://thisisthecoin.com';
const CHAIN_ID = 'volchain-main';
const WALLET = path.resolve(process.env.HOME || '.', '.volc_wallet.json');
const enc = new TextEncoder();

ed.utils.sha512Sync = (msg) => sha512(msg);
if (ed.etc) ed.etc.sha512Sync = (msg) => sha512(msg);

const b64d = (s)=> Buffer.from(s, 'base64');
const b64e = (u)=> Buffer.from(u).toString('base64');

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
  // bech32 address from sha256(pub) first 20 bytes
  const h20 = Buffer.from(await crypto.subtle.digest('SHA-256', pubU8)).subarray(0,20);
  const addr = bech32.encode('v1', bech32.toWords(h20));
  const wallet = { type:'ed25519', publicKey: b64e(pubU8), secretKey: b64e(secU8), address: addr };
  fs.writeFileSync(WALLET, JSON.stringify(wallet,null,2), { mode: 0o600 });
  return { ...wallet, pubU8, secU8 };
}

async function getNonce(addr){
  const r = await fetch(`${RPC}/volchain/state/${addr}`);
  if (!r.ok) return 0;
  const j = await r.json();
  return j?.nonce ?? 0;
}

async function sendTx(tx){
  const res = await fetch(`${RPC}/volchain/tx`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(tx) });
  const j = await res.json().catch(()=>({}));
  if (!res.ok || !j.ok) throw new Error(`TX_REJECTED ${res.status}: ${JSON.stringify(j)}`);
  return j;
}

async function main(){
  const [,, cmd, arg1, arg2, ...rest] = process.argv;
  if (!cmd || ['head','verify','balance','stake','unstake','transfer'].indexOf(cmd) === -1) {
    console.log('Usage:\n  node tools/volc.js head|verify\n  node tools/volc.js balance <address|me>\n  node tools/volc.js stake <amount>\n  node tools/volc.js unstake <amount>\n  node tools/volc.js transfer <toAddress> <amount> [--to-wallet <path>]');
    process.exit(1);
  }
  if (cmd === 'head') {
    const r = await fetch(`${RPC}/volchain/head`);
    const j = await r.json();
    console.log(JSON.stringify(j));
    return;
  }
  if (cmd === 'verify') {
    const r = await fetch(`${RPC}/volchain/verify`);
    const j = await r.json();
    console.log(JSON.stringify(j));
    return;
  }
  if (cmd === 'balance') {
    let addr = arg1;
    if (!addr) { console.error('Need address or "me"'); process.exit(1); }
    if (addr === 'me') {
      const w = JSON.parse(fs.readFileSync(WALLET,'utf8'));
      addr = w.address;
    }
    const r = await fetch(`${RPC}/volchain/state/${addr}`);
    const j = await r.json();
    console.log(JSON.stringify({ address: addr, ...j }));
    return;
  }

  // tx commands
  const wallet = await loadOrCreateWallet();
  const from = wallet.address;
  const pubB64 = b64e(wallet.pubU8);
  let to=null, amount=0, memo=null, type=cmd;
  let toWalletPath=null;
  for (let i=0;i<rest.length;i++) if (rest[i]==='--to-wallet') { toWalletPath = rest[i+1]; i++; }
  if (cmd==='transfer') { to = arg1; amount = parseInt(arg2,10); } else { amount = parseInt(arg1,10); }
  if (!(Number.isInteger(amount) && amount>0)) throw new Error('BAD_AMOUNT');

  const prev = await getNonce(from);
  const tx = { chain_id: CHAIN_ID, type, from, to, amount, nonce: prev+1, memo, pubkey: pubB64, sig: '' };
  if (cmd==='transfer' && toWalletPath) {
    try {
      const w2 = JSON.parse(fs.readFileSync(toWalletPath,'utf8'));
      tx.memo = tx.memo || {};
      tx.memo.toPubkey = w2.publicKey; // base64
    } catch {}
  }
  const payload = canonicalTxPayload(tx);
  const sigU8 = await ed.signAsync(enc.encode(payload), wallet.secU8);
  tx.sig = b64e(sigU8);
  const out = await sendTx(tx);
  console.log(JSON.stringify({ ok:true }));
}

main().catch(e => { console.error(String(e?.message||e)); process.exit(1); });



