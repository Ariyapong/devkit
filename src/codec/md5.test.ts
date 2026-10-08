import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { md5 } from "./md5.js";
import { bytesToHex, utf8ToBytes } from "../shared/bytes.js";

const hex = (b: Uint8Array) => bytesToHex(md5(b));

test("md5: RFC 1321 appendix A.5 vectors", () => {
  const vectors: [string, string][] = [
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "d174ab98d277d9f5a5611c2c9f419d9f"],
    ["12345678901234567890123456789012345678901234567890123456789012345678901234567890", "57edf4a22be3c955ac49da2e2107b67a"],
  ];
  for (const [input, want] of vectors) assert.equal(hex(utf8ToBytes(input)), want, JSON.stringify(input));
});

test("md5: every length 0..130 matches node:crypto (padding boundaries 55/56/63/64/65/119/120)", () => {
  for (let n = 0; n <= 130; n++) {
    const b = new Uint8Array(n).map((_, i) => (i * 7 + 3) & 0xff);
    assert.equal(hex(b), createHash("md5").update(b).digest("hex"), `length ${n}`);
  }
});

test("md5: 20,000 random inputs up to 4 KB match node:crypto", () => {
  for (let i = 0; i < 20_000; i++) {
    const b = new Uint8Array(randomBytes(Math.floor(Math.random() * 4096)));
    assert.equal(hex(b), createHash("md5").update(b).digest("hex"));
  }
});
