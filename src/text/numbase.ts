import { InputError } from "../errors.js";

export type Base = "dec" | "hex" | "oct" | "bin";

/** Canonical prefix per base (decimal has none). Shared by input + output. */
export const PREFIX: Record<Base, string> = { dec: "", hex: "0x", oct: "0o", bin: "0b" };

/** Allowed digit set per base (input is lower-cased before testing). */
const DIGITS: Record<Base, RegExp> = {
  dec: /^[0-9]+$/,
  hex: /^[0-9a-f]+$/,
  oct: /^[0-7]+$/,
  bin: /^[01]+$/,
};

/** Max bit-length; keeps the rendered result under Discord's 2000-char cap. */
const MAX_BITS = 512;

/** Left-pad to a full nibble and group in 4s: "11111111" → "1111 1111", "101" → "0101". */
function groupBits(bits: string): string {
  const padded = bits.padStart(Math.ceil(bits.length / 4) * 4, "0");
  return padded.replace(/(.{4})(?=.)/g, "$1 ");
}

export function formatBases(value: bigint): {
  dec: string;
  hex: string;
  oct: string;
  bin: string;
} {
  return {
    dec: PREFIX.dec + value.toString(10),
    hex: PREFIX.hex + value.toString(16),
    oct: PREFIX.oct + value.toString(8),
    bin: PREFIX.bin + groupBits(value.toString(2)),
  };
}

export function parseToBigInt(input: string, from?: Base): bigint {
  const trimmed = input.trim();
  if (trimmed.startsWith("-")) {
    throw new InputError("Negative numbers aren't supported.");
  }

  let base: Base;
  let rest: string;
  if (from) {
    base = from;
    const prefix = PREFIX[base];
    rest =
      prefix && trimmed.slice(0, 2).toLowerCase() === prefix
        ? trimmed.slice(2)
        : trimmed;
  } else {
    const head = trimmed.slice(0, 2).toLowerCase();
    if (head === "0x") { base = "hex"; rest = trimmed.slice(2); }
    else if (head === "0o") { base = "oct"; rest = trimmed.slice(2); }
    else if (head === "0b") { base = "bin"; rest = trimmed.slice(2); }
    else { base = "dec"; rest = trimmed; }
  }

  const digits = rest.replace(/[_\s]/g, "").toLowerCase();
  if (digits === "") {
    throw new InputError("No digits to convert.");
  }
  if (!DIGITS[base].test(digits)) {
    throw new InputError(`"${input}" is not a valid ${base} number.`);
  }

  const value = BigInt(PREFIX[base] + digits);
  if (value.toString(2).length > MAX_BITS) {
    throw new InputError(`Number too large — up to ${MAX_BITS} bits.`);
  }
  return value;
}
