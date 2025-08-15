async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(d);
}
function hexToBytes(hex) {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return arr;
}
function concat(...arrs) {
  let len = 0; arrs.forEach(a => len += a.length);
  const out = new Uint8Array(len);
  let off = 0; for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}
function u64le(n) {
  const b = new Uint8Array(8);
  const v = BigInt(n);
  for (let i = 0; i < 8; i++) b[i] = Number((v >> BigInt(8 * i)) & 255n);
  return b;
}
function hexToBigInt(h) { return BigInt('0x' + h); }
function bytesToHex(b) { return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }

self.onmessage = async (e) => {
  const { target, salt, prevHash, height, pubkey, apiBase } = e.data;
  try {
    const saltB = hexToBytes(salt);
    const prevB = hexToBytes(prevHash);
    const pubB = hexToBytes(pubkey);
    const tgt = hexToBigInt(target);

    let nonce = 0;
    while (true) {
      const pre = concat(saltB, pubB, u64le(height), prevB, u64le(nonce));
      const h = bytesToHex(await sha256(pre));
      if (hexToBigInt(h) < tgt) {
        await fetch(`${apiBase}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pubkey, nonce, height })
        });
        self.postMessage({ ok: true, nonce, hash: h });
        break;
      }
      nonce++;
      if (nonce % 5000 === 0) await new Promise(r => setTimeout(r, 0));
    }
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
