/** Injectable RNG: returns an integer in [0, max). */
export type Rng = (max: number) => number;

/**
 * Uniform integer in [0, max) from Web Crypto, bias-free by rejection
 * sampling (Node ≥ 19 and every browser expose globalThis.crypto).
 */
function cryptoRandomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0x1_0000_0000) {
    throw new RangeError(`max must be an integer in (0, 2^32], got ${max}`);
  }
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % max);
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    const v = buf[0]!;
    if (v < limit) return v % max;
  }
}

export function randomIndex(n: number, rng: Rng = cryptoRandomInt): number {
  return rng(n);
}
