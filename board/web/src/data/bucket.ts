// Flagsmith's identity bucketing, as integrity/verify_assignment.py recomputes it: md5 over the
// comma-joined ids, read as an integer, mod 9999, scaled to [0, 100). The same ids always land on
// the same value, so a task's lane never changes while the split stays the same.

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** md5 of a UTF-8 string, as lowercase hex. */
export function md5(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const n = (((bytes.length + 8) >>> 6) + 1) * 16;
  const w = new Uint32Array(n);
  bytes.forEach((b, i) => (w[i >> 2]! |= b << ((i % 4) * 8)));
  w[bytes.length >> 2]! |= 0x80 << ((bytes.length % 4) * 8);
  const bits = bytes.length * 8;
  w[n - 2] = bits >>> 0;
  w[n - 1] = Math.floor(bits / 2 ** 32);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let off = 0; off < n; off += 16) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const x = (a + f + K[i]! + w[off + g]!) >>> 0;
      const s = S[(i >> 4) * 4 + (i % 4)]!;
      b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((v) => Array.from({ length: 4 }, (_, i) => ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, "0")).join(""))
    .join("");
}

/** int(hex, 16) % m for a long hex string, without BigInt. */
function hexMod(hex: string, m: number): number {
  let r = 0;
  for (const ch of hex) r = (r * 16 + parseInt(ch, 16)) % m;
  return r;
}

/** A value in [0, 100) for these ids, as Flagsmith buckets identities. */
export function hashedPercentage(ids: string[], iterations = 1): number {
  const joined = Array.from({ length: iterations }, () => ids.join(",")).join(",");
  const value = (hexMod(md5(joined), 9999) / 9998) * 100;
  return value === 100 ? hashedPercentage(ids, iterations + 1) : value;
}
