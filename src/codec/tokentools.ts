import { InputError } from "../errors.js";
import { cryptoRandomInt, type Rng } from "./random.js";

export type TokenType = "hex" | "base64" | "base64url" | "alphanumeric" | "password";

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const ALPHANUM = UPPER + LOWER + DIGITS;

const ALPHABETS: Record<TokenType, string> = {
  hex: "0123456789abcdef",
  base64: UPPER + LOWER + DIGITS + "+/",
  base64url: UPPER + LOWER + DIGITS + "-_",
  alphanumeric: ALPHANUM,
  password: ALPHANUM + "!@#$%^&*-_=+?",
};

export const TOKEN_TYPES: readonly TokenType[] = Object.freeze(Object.keys(ALPHABETS) as TokenType[]);

// Look-alike characters removed in `unambiguous` mode.
const AMBIGUOUS = new Set(["0", "O", "1", "l", "I"]);

export const TOKEN_MIN_LENGTH = 8;
export const TOKEN_MAX_LENGTH = 128;
export const TOKEN_MAX_COUNT = 10;

export interface TokenOptions {
  type: TokenType;
  length: number;
  count: number;
  unambiguous: boolean;
}

/** Alphabet for a type. `unambiguous` only affects alphanumeric/password. */
export function alphabetFor(type: TokenType, unambiguous: boolean): string {
  const base = ALPHABETS[type];
  if (!unambiguous || (type !== "alphanumeric" && type !== "password")) return base;
  return [...base].filter((c) => !AMBIGUOUS.has(c)).join("");
}

export interface TokenResult {
  tokens: string[];
  /** Entropy per token in bits (length × log2(alphabetSize)), rounded to 1 dp. */
  bits: number;
}

/**
 * Generate `count` random tokens of `length` characters. Each character is
 * drawn with an unbiased index via `rng` (Web Crypto `getRandomValues`, via `cryptoRandomInt`) — never
 * `randomBytes % n`, which biases when the alphabet doesn't divide 256.
 */
export function generateTokens(opts: TokenOptions, rng: Rng = cryptoRandomInt): TokenResult {
  if (!Object.hasOwn(ALPHABETS, opts.type)) {
    throw new InputError(`type must be one of ${TOKEN_TYPES.join(", ")}.`);
  }
  if (
    !Number.isInteger(opts.length) ||
    opts.length < TOKEN_MIN_LENGTH ||
    opts.length > TOKEN_MAX_LENGTH
  ) {
    throw new InputError(`length must be ${TOKEN_MIN_LENGTH}–${TOKEN_MAX_LENGTH} characters.`);
  }
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > TOKEN_MAX_COUNT) {
    throw new InputError(`count must be 1–${TOKEN_MAX_COUNT}.`);
  }
  const alphabet = alphabetFor(opts.type, opts.unambiguous);
  const tokens = Array.from({ length: opts.count }, () => {
    let out = "";
    for (let i = 0; i < opts.length; i++) out += alphabet[rng(alphabet.length)];
    return out;
  });
  const bits = Math.round(opts.length * Math.log2(alphabet.length) * 10) / 10;
  return { tokens, bits };
}
