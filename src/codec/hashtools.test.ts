import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { HASH_ALGORITHMS, checkHash, hashBytes, hashText, hmacText } from "./hashtools.js";
import type { HashAlgorithm } from "./hashtools.js";
import { InputError } from "../errors.js";

const NODE_NAME: Record<HashAlgorithm, string> = { md5: "md5", sha1: "sha1", sha256: "sha256", sha384: "sha384", sha512: "sha512" };

test("HASH_ALGORITHMS lists the five supported names", () => {
  assert.deepEqual([...HASH_ALGORITHMS], ["md5", "sha1", "sha256", "sha384", "sha512"]);
});

test("hashText matches node:crypto for every algorithm over 5,000 random strings", async () => {
  for (let i = 0; i < 5_000; i++) {
    const text = randomBytes(1 + Math.floor(Math.random() * 64)).toString("latin1") + "สวัสดี😀".slice(0, i % 7);
    const algo = HASH_ALGORITHMS[i % HASH_ALGORITHMS.length]!;
    assert.equal(await hashText(text, algo), createHash(NODE_NAME[algo]).update(text, "utf8").digest("hex"), `${algo} ${JSON.stringify(text)}`);
  }
});

test("hashBytes matches node:crypto, including the empty input", async () => {
  assert.equal(await hashBytes(new Uint8Array(), "md5"), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(await hashBytes(new Uint8Array(), "sha256"), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  for (let i = 0; i < 500; i++) {
    const b = new Uint8Array(randomBytes(Math.floor(Math.random() * 2048)));
    const algo = HASH_ALGORITHMS[i % HASH_ALGORITHMS.length]!;
    assert.equal(await hashBytes(b, algo), createHash(NODE_NAME[algo]).update(b).digest("hex"));
  }
});

test("hmacText: RFC 2202 (MD5, SHA-1) and RFC 4231 (SHA-2) vectors", async () => {
  // RFC 2202 test case 2: key "Jefe", data "what do ya want for nothing?"
  assert.equal(await hmacText("what do ya want for nothing?", "Jefe", "md5"), "750c783e6ab0b503eaa86e310a5db738");
  assert.equal(await hmacText("what do ya want for nothing?", "Jefe", "sha1"), "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79");
  // RFC 4231 test case 2 (same key and data)
  assert.equal(await hmacText("what do ya want for nothing?", "Jefe", "sha256"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  assert.equal(await hmacText("what do ya want for nothing?", "Jefe", "sha384"), "af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649");
  assert.equal(await hmacText("what do ya want for nothing?", "Jefe", "sha512"), "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737");
  // RFC 4231's long-key case (131 × 0xaa) cannot be written through a string
  // key (UTF-8 makes 0xaa two bytes); keys longer than the block are covered
  // by the random pairs below, whose keys reach 150 latin1 chars (up to 300 bytes).
});

test("hmacText matches node:crypto over 5,000 random text/key pairs", async () => {
  for (let i = 0; i < 5_000; i++) {
    const text = randomBytes(Math.floor(Math.random() * 64)).toString("latin1");
    const key = randomBytes(1 + Math.floor(Math.random() * 150)).toString("latin1");
    if (key.trim() === "") continue; // a whitespace-only key is (rightly) rejected as blank
    const algo = HASH_ALGORITHMS[i % HASH_ALGORITHMS.length]!;
    assert.equal(await hmacText(text, key, algo), createHmac(NODE_NAME[algo], Buffer.from(key, "utf8")).update(text, "utf8").digest("hex"));
  }
});

test("hmacText: a blank key is rejected with the bot's message", async () => {
  await assert.rejects(hmacText("x", "   ", "sha256"), (e) => e instanceof InputError && e.message === "An HMAC key cannot be blank.");
  // A key with surrounding spaces is used verbatim.
  assert.equal(await hmacText("x", " k ", "sha256"), createHmac("sha256", " k ").update("x").digest("hex"));
});

test("unknown algorithm rejects with an InputError on every entry point", async () => {
  const bad = "sha3" as unknown as HashAlgorithm;
  for (const p of [hashText("x", bad), hashBytes(new Uint8Array(), bad), hmacText("x", "k", bad), checkHash("x", bad, "00")]) {
    await assert.rejects(p, (e) => e instanceof InputError && e.message === "Unknown hash algorithm.");
  }
});

test("checkHash: match, case/whitespace normalisation, mismatch, lengthHint", async () => {
  const md5abc = "900150983cd24fb0d6963f7d28e17f72";
  const ok = await checkHash("abc", "md5", `  ${md5abc.toUpperCase()}  `);
  assert.deepEqual(ok, { digest: md5abc, expected: md5abc, match: true, lengthHint: null });
  const miss = await checkHash("abc", "md5", "0".repeat(32));
  assert.equal(miss.match, false);
  assert.equal(miss.lengthHint, null); // same length ⇒ a real mismatch, no hint
  const wrongAlgo = await checkHash("abc", "sha256", md5abc);
  assert.equal(wrongAlgo.lengthHint, "md5");
  // Keyed verification uses hmacText; HMAC output has the hash's width.
  const keyed = await checkHash("abc", "sha256", createHmac("sha256", "k").update("abc").digest("hex"), "k");
  assert.equal(keyed.match, true);
});

test("checkHash: every algorithm's own digest length yields lengthHint null (length table complete)", async () => {
  for (const algo of HASH_ALGORITHMS) {
    const digest = await hashText("abc", algo);
    assert.equal((await checkHash("abc", algo, digest)).lengthHint, null, algo);
  }
});

test("checkHash: error precedence is hex, then algorithm, then blank key", async () => {
  await assert.rejects(checkHash("x", "md5", "zz"), (e) => e instanceof InputError && e.message === "The expected value must be a hex digest (0-9, a-f).");
  await assert.rejects(checkHash("x", "md5", "zz", "   "), (e) => e instanceof InputError && e.message === "The expected value must be a hex digest (0-9, a-f).");
  await assert.rejects(checkHash("x", "sha3" as unknown as HashAlgorithm, "00", "   "), (e) => e instanceof InputError && e.message === "Unknown hash algorithm.");
  await assert.rejects(checkHash("x", "md5", "00", "   "), (e) => e instanceof InputError && e.message === "An HMAC key cannot be blank.");
});

test("hash functions never throw synchronously", () => {
  const p = hmacText("x", "", "md5"); // would throw before the first await if not `async function`
  assert.ok(p instanceof Promise);
  return assert.rejects(p, InputError);
});
