import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHashCheck } from "./hash-render.js";
import { checkHash } from "../codec/index.js";

test("renderHashCheck: a match states the algorithm and the digest", async () => {
  const body = renderHashCheck(await checkHash("abc", "md5", "900150983cd24fb0d6963f7d28e17f72"), "md5");
  assert.match(body, /✅/);
  assert.match(body, /md5/);
  assert.match(body, /900150983cd24fb0d6963f7d28e17f72/);
});

test("renderHashCheck: a mismatch shows both digests", async () => {
  const body = renderHashCheck(await checkHash("abc", "md5", "0".repeat(32)), "md5");
  assert.match(body, /❌/);
  assert.match(body, /900150983cd24fb0d6963f7d28e17f72/); // computed
  assert.match(body, /00000000000000000000000000000000/); // expected
});

test("renderHashCheck: a wrong-length digest gets the algorithm hint", async () => {
  const body = renderHashCheck(
    await checkHash("abc", "sha256", "900150983cd24fb0d6963f7d28e17f72"),
    "sha256",
  );
  assert.match(body, /md5/);
});

test("renderHashCheck: a plain mismatch carries no hint line", async () => {
  const body = renderHashCheck(await checkHash("abc", "md5", "0".repeat(32)), "md5");
  assert.doesNotMatch(body, /-#/);
});

test("renderHashCheck: labels a keyed check as hmac", async () => {
  const HMAC_FOX = "The quick brown fox jumps over the lazy dog";
  const body = renderHashCheck(
    await checkHash(HMAC_FOX, "md5", "80070713463e7749b90c2dc24911e275", "key"),
    "md5",
    true,
  );
  assert.match(body, /hmac-md5/);
});
