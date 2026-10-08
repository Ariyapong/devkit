import { InputError } from "../errors.js";
import { bytesToHex, utf8ToBytes } from "../shared/bytes.js";
import { md5 } from "./md5.js";

export type HashAlgorithm = "md5" | "sha1" | "sha256" | "sha384" | "sha512";
export const HASH_ALGORITHMS: readonly HashAlgorithm[] = ["md5", "sha1", "sha256", "sha384", "sha512"];

const SUBTLE_NAME: Record<Exclude<HashAlgorithm, "md5">, string> = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
};

/** Hex length is unique per algorithm, so it identifies the one that produced it. */
const DIGEST_LENGTHS: Record<number, HashAlgorithm> = {
  32: "md5",
  40: "sha1",
  64: "sha256",
  96: "sha384",
  128: "sha512",
};

/** On the web the algorithm can arrive from a URL parameter: user input, not a programmer error. */
function assertAlgorithm(algorithm: string): asserts algorithm is HashAlgorithm {
  if (!(HASH_ALGORITHMS as readonly string[]).includes(algorithm)) {
    throw new InputError("Unknown hash algorithm.");
  }
}

async function digestBytes(bytes: Uint8Array, algorithm: HashAlgorithm): Promise<Uint8Array> {
  if (algorithm === "md5") return md5(bytes);
  return new Uint8Array(await globalThis.crypto.subtle.digest(SUBTLE_NAME[algorithm], bytes));
}

export async function hashBytes(bytes: Uint8Array, algorithm: HashAlgorithm): Promise<string> {
  assertAlgorithm(algorithm);
  return bytesToHex(await digestBytes(bytes, algorithm));
}

export async function hashText(text: string, algorithm: HashAlgorithm): Promise<string> {
  assertAlgorithm(algorithm);
  return hashBytes(utf8ToBytes(text), algorithm);
}

/** RFC 2104 over the vendored MD5; Web Crypto has no HMAC-MD5. Block size 64. */
function hmacMd5(key: Uint8Array, data: Uint8Array): Uint8Array {
  const k = new Uint8Array(64);
  k.set(key.length > 64 ? md5(key) : key);
  const inner = new Uint8Array(64 + data.length);
  const outer = new Uint8Array(64 + 16);
  for (let i = 0; i < 64; i++) {
    inner[i] = k[i]! ^ 0x36;
    outer[i] = k[i]! ^ 0x5c;
  }
  inner.set(data, 64);
  outer.set(md5(inner), 64);
  return md5(outer);
}

/**
 * Keyed digest (HMAC). Deliberately a separate function rather than an
 * `if (key)` inside hashText: the unkeyed path is the hot one and must stay
 * impossible to alter by accident. Empty/whitespace keys are legal HMAC but
 * always a mistake here: the digest comes back looking perfectly valid, so
 * nothing signals the error.
 */
export async function hmacText(text: string, key: string, algorithm: HashAlgorithm): Promise<string> {
  assertAlgorithm(algorithm);
  if (key.trim() === "") {
    throw new InputError("An HMAC key cannot be blank.");
  }
  const keyBytes = utf8ToBytes(key);
  const data = utf8ToBytes(text);
  if (algorithm === "md5") return bytesToHex(hmacMd5(keyBytes, data));
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: SUBTLE_NAME[algorithm] },
    false,
    ["sign"],
  );
  return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", cryptoKey, data)));
}

export interface HashCheck {
  digest: string;
  /** The expected value after trim + lowercase — what was actually compared. */
  expected: string;
  match: boolean;
  /**
   * The algorithm the expected value's length points at, when that is NOT the
   * one selected — the "you pasted an md5 with sha256 still selected" case.
   * Null when the length fits, so a genuine mismatch stays quiet.
   */
  lengthHint: HashAlgorithm | null;
}

/**
 * Compare a computed digest against a pasted one. Passing `key` verifies an
 * HMAC instead of a plain hash; length-hint logic is unaffected, since HMAC
 * output is the same width as the underlying hash. Error order: hex form of
 * `expected` (the bot's first check), then the algorithm, then the blank key
 * raised inside hmacText.
 */
export async function checkHash(
  text: string,
  algorithm: HashAlgorithm,
  expected: string,
  key?: string,
): Promise<HashCheck> {
  // Hex is case-insensitive and pasted digests arrive with stray whitespace;
  // `digest` is always lowercase hex, so normalizing the user's side suffices.
  const wanted = expected.trim().toLowerCase();
  // Fixed string, never an echo of the input — same rule as the rest of codec.
  if (!/^[0-9a-f]+$/.test(wanted)) {
    throw new InputError("The expected value must be a hex digest (0-9, a-f).");
  }
  assertAlgorithm(algorithm);
  const digest = key === undefined ? await hashText(text, algorithm) : await hmacText(text, key, algorithm);
  const points = DIGEST_LENGTHS[wanted.length] ?? null;
  return {
    digest,
    expected: wanted,
    match: digest === wanted,
    lengthHint: points === algorithm ? null : points,
  };
}
