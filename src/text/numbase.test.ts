import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBases, parseToBigInt } from "./numbase.js";
import { InputError } from "../errors.js";

test("formatBases: 255 in all bases, nibble-grouped binary", () => {
  assert.deepEqual(formatBases(255n), {
    dec: "255",
    hex: "0xff",
    oct: "0o377",
    bin: "0b1111 1111",
  });
});

test("formatBases: pads to a full nibble", () => {
  assert.equal(formatBases(5n).bin, "0b0101");
  assert.equal(formatBases(0n).bin, "0b0000");
});

test("formatBases: groups longer binary in 4s", () => {
  // 0b111100001010 === 3850
  assert.equal(formatBases(3850n).bin, "0b1111 0000 1010");
});

test("formatBases: lowercase hex, exact past 2^53", () => {
  const big = 9007199254740993n; // 2^53 + 1, not representable as a JS number
  assert.equal(formatBases(big).dec, "9007199254740993");
  assert.equal(formatBases(big).hex, "0x20000000000001");
});

test("parseToBigInt: prefix auto-detect", () => {
  assert.equal(parseToBigInt("0xFF"), 255n);
  assert.equal(parseToBigInt("0o377"), 255n);
  assert.equal(parseToBigInt("0b1111"), 15n);
  assert.equal(parseToBigInt("255"), 255n);
});

test("parseToBigInt: bare leading zero is decimal (no octal footgun)", () => {
  assert.equal(parseToBigInt("0377"), 377n);
});

test("parseToBigInt: explicit from overrides, strips only its own prefix", () => {
  assert.equal(parseToBigInt("FF", "hex"), 255n);
  assert.equal(parseToBigInt("0xFF", "hex"), 255n);
  // "0b" is NOT hex's prefix, so it is treated as hex digits: 0x0b11
  assert.equal(parseToBigInt("0b11", "hex"), 0x0b11n);
});

test("parseToBigInt: strips underscores and spaces", () => {
  assert.equal(parseToBigInt("0xFF_FF"), 0xffffn);
  assert.equal(parseToBigInt("1_000"), 1000n);
  assert.equal(parseToBigInt("1 000"), 1000n);
});

test("parseToBigInt: invalid digit throws InputError", () => {
  assert.throws(() => parseToBigInt("FG", "hex"), InputError);
  assert.throws(() => parseToBigInt("0b12"), InputError);
  assert.throws(() => parseToBigInt("0o8"), InputError);
});

test("parseToBigInt: empty / negative throw InputError", () => {
  assert.throws(() => parseToBigInt(""), InputError);
  assert.throws(() => parseToBigInt("0x"), InputError);
  assert.throws(() => parseToBigInt("-5"), InputError);
});

test("parseToBigInt: 512-bit cap boundary", () => {
  const max = (1n << 512n) - 1n; // exactly 512 bits (all ones)
  assert.equal(parseToBigInt("0x" + max.toString(16)), max);
  assert.throws(() => parseToBigInt("0x" + (1n << 512n).toString(16)), InputError);
});
