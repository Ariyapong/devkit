/**
 * Byte helpers with NO Node dependency. `base64ToBytes` mirrors
 * `Buffer.from(x, "base64")` exactly (fuzzed to 0 mismatches on 100k inputs,
 * Node 22 + 24 — see the design doc §14) and cannot throw. Do not "simplify"
 * it to atob: atob implements WHATWG forgiving-base64, a different spec, and
 * throws a DOMException on input Buffer accepts.
 *
 * Node's rules, all six load-bearing:
 *  1. each UTF-16 code unit is truncated to its low byte before lookup;
 *  2. decoding stops at the first '=' (after truncation);
 *  3. '-' and '_' are the url alphabet (62, 63);
 *  4. every other byte is skipped;
 *  5. a sextet count ≡ 1 (mod 4) drops its last sextet;
 *  6. sextets pack 4→3, a partial final group yields 1 or 2 bytes.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Int16Array(256).fill(-1);
for (let i = 0; i < 64; i += 1) LOOKUP[ALPHABET.charCodeAt(i)] = i;
LOOKUP["-".charCodeAt(0)] = 62;
LOOKUP["_".charCodeAt(0)] = 63;

export function base64ToBytes(input: string): Uint8Array {
  const sextets: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i) & 0xff;
    if (c === 61) break; // '='
    const v = LOOKUP[c] ?? -1;
    if (v >= 0) sextets.push(v);
  }
  const n = sextets.length - (sextets.length % 4 === 1 ? 1 : 0);
  const out = new Uint8Array(Math.floor((n * 6) / 8));
  let o = 0;
  for (let i = 0; i + 1 < n; i += 4) {
    const a = sextets[i]!;
    const b = sextets[i + 1]!;
    const c = i + 2 < n ? sextets[i + 2]! : 0;
    const d = i + 3 < n ? sextets[i + 3]! : 0;
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < n) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < n) out[o++] = ((c & 3) << 6) | d;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin); // encoding has no lenient-input problem; btoa never throws on a binary string
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(utf8ToBytes(text));
}

/** Unpadded url-safe form — what Buffer's "base64url" produces. */
export function utf8ToBase64Url(text: string): string {
  return utf8ToBase64(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Lossy decode: invalid sequences become U+FFFD, exactly like
 * Buffer#toString("utf8"). ignoreBOM is load-bearing — without it a leading
 * BOM is consumed, and today's round-trip check would then fail on
 * BOM-prefixed input where the bot succeeds.
 */
export function bytesToUtf8Lossy(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
