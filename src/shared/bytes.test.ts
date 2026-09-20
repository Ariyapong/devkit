import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base64ToBytes, bytesToBase64, utf8ToBase64, utf8ToBase64Url,
  bytesToUtf8Lossy, utf8ToBytes, bytesEqual, bytesToHex,
} from "./bytes.js";

// Expected hex values were produced by Buffer.from(x, "base64") on Node
// 22.23.2 and 24.21.0 (spec §14). They are literals here on purpose: this
// file must also pass in the browserish run, where Buffer does not exist.
const NAMED: [input: string, hex: string][] = [
  ["", ""],
  ["Y", ""],                                   // dangling sextet dropped
  ["aGVsb", "68656c"],                         // 5 chars ≡ 1 mod 4 → last sextet dropped → "hel"
  ["aGVsbA", "68656c6c"],
  ["aGVsbG8", "68656c6c6f"],
  ["aGVsbG8=", "68656c6c6f"],
  ["aGVs!bG8=", "68656c6c6f"],                 // junk skipped
  ["aGVsbG8-_w", "68656c6c6f3eff"],            // url alphabet accepted
  ["!!!!", ""],
  ["=", ""],
  ["====", ""],
  ["hello_world_x", "85e965a3fc28ae577f"],     // 13 chars — the class the atob design crashed on
  ["aGVs=bG8=", "68656c"],                     // stops at the first '='
  ["aGVsbG8=extra", "68656c6c6f"],
  ["SGVsbG8=IQ==", "48656c6c6f"],
  ["aGVs\nbG8=", "68656c6c6f"],
  [" aGVsbG8= ", "68656c6c6f"],
  ["aGVsbG8-_w==", "68656c6c6f3eff"],
  ["77u/aGk=", "efbbbf6869"],                  // BOM bytes preserved
  ["////", "ffffff"],
  ["+/+/", "fbffbf"],
  ["----", "fbefbe"],
  ["____", "ffffff"],
  ["A", ""], ["AB", "00"], ["ABC", "0010"], ["ABCD", "001083"], ["ABCDE", "001083"],
  ["z字6", "cd6e"],                            // U+5B57 & 0xff = 0x57 = 'W' — Node truncates code units
];

for (const [input, hex] of NAMED) {
  test(`base64ToBytes mirrors Buffer: ${JSON.stringify(input)}`, () => {
    assert.equal(bytesToHex(base64ToBytes(input)), hex);
  });
}

test("fuzz against Buffer.from(x, 'base64') when Buffer exists (skipped browserish)", (t) => {
  const B = (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } }).Buffer;
  if (B === undefined) return t.skip("no Buffer in this runtime");
  const POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_==== \n!@#%^&*()é漢字ĽŁīįĭşแก＝";
  for (let i = 0; i < 10_000; i += 1) {
    let s = "";
    const len = Math.floor(Math.random() * 41);
    for (let j = 0; j < len; j += 1) s += POOL[Math.floor(Math.random() * POOL.length)];
    assert.equal(bytesToHex(base64ToBytes(s)), B.from(s, "base64").toString("hex"), JSON.stringify(s));
  }
});

test("utf8 encode/decode round trip keeps a BOM and Thai", () => {
  const text = "﻿สวัสดี hi";
  const bytes = utf8ToBytes(text);
  assert.equal(bytesToUtf8Lossy(bytes), text);
  assert.equal(base64ToBytes(utf8ToBase64(text)).length, bytes.length);
  assert.ok(bytesEqual(base64ToBytes(utf8ToBase64(text)), bytes));
});

test("bytesToUtf8Lossy replaces invalid sequences instead of throwing", () => {
  const out = bytesToUtf8Lossy(Uint8Array.from([0xff, 0x41]));
  assert.equal(out, "�A");
});

test("utf8ToBase64Url is unpadded and url-safe", () => {
  assert.equal(utf8ToBase64Url('{"alg":"HS256","typ":"JWT"}'), "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  assert.doesNotMatch(utf8ToBase64Url("ÿþý"), /[+/=]/);
});

test("bytesToBase64 pads and uses the standard alphabet", () => {
  assert.equal(bytesToBase64(Uint8Array.from([0xfb, 0xff, 0xbf])), "+/+/");
  assert.equal(utf8ToBase64("hello"), "aGVsbG8=");
});
