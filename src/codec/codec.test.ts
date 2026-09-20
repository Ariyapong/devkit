import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base64Encode,
  base64Decode,
  urlEncode,
  urlDecode,
  decodeJwt,
  makeUuids,
} from "./codec.js";
import { InputError } from "../errors.js";
import { utf8ToBase64Url } from "../shared/bytes.js";

test("base64 round trip", () => {
  assert.equal(base64Encode("hello"), "aGVsbG8=");
  assert.deepEqual(base64Decode("aGVsbG8="), { ok: true, text: "hello" });
});

test("base64Decode: binary shows hex preview", () => {
  const result = base64Decode("////");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.hexPreview, "ffffff");
});

test("base64Decode: garbage throws InputError", () => {
  assert.throws(() => base64Decode("!!!"), InputError);
});

test("url encode/decode", () => {
  assert.equal(urlEncode("a b&c"), "a%20b%26c");
  assert.equal(urlDecode("a%20b%26c"), "a b&c");
  assert.throws(() => urlDecode("%"), InputError);
});

test("decodeJwt: expired token", () => {
  const b64url = (obj: unknown) => utf8ToBase64Url(JSON.stringify(obj));
  const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub: "1",
    exp: 1000000000,
  })}.sig`;
  const info = decodeJwt(token);
  assert.equal((info.payload as { sub?: string }).sub, "1");
  assert.ok(info.expiresInMs !== null && info.expiresInMs < 0);
  assert.equal(info.times.length, 1);
  assert.equal(info.times[0]!.claim, "exp");
});

test("decodeJwt: not 3 parts throws", () => {
  assert.throws(() => decodeJwt("abc.def"), InputError);
});

test("makeUuids", () => {
  const ids = makeUuids(3);
  assert.equal(ids.length, 3);
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});

test("base64Decode is Buffer-lenient: junk skipped, url alphabet accepted, garbage → InputError", () => {
  assert.deepEqual(base64Decode("aGVs!bG8="), { ok: true, text: "hello" });
  assert.deepEqual(base64Decode("aGVs=bG8="), { ok: true, text: "hel" });
  assert.deepEqual(base64Decode("aGVsbG8=extra"), { ok: true, text: "hello" });
  assert.equal(base64Decode("hello_world_x").ok, false);      // 13 chars — decodes to non-UTF-8 bytes, hex preview
  assert.throws(() => base64Decode("!!!!"), InputError);
  assert.throws(() => base64Decode("Y"), InputError);
});

test("base64Decode keeps a BOM the way Buffer#toString does", () => {
  assert.deepEqual(base64Decode("77u/aGk="), { ok: true, text: "﻿hi" });
});

test("decodeJwt takes an injected now for expiresInMs", () => {
  const exp = 1_800_000_000;
  const token = `${utf8ToBase64Url('{"alg":"HS256","typ":"JWT"}')}.${utf8ToBase64Url(JSON.stringify({ sub: "1", exp }))}.c2ln`;
  assert.equal(decodeJwt(token, exp * 1000 - 5000).expiresInMs, 5000);
});

test("makeUuids yields RFC-4122 v4 strings", () => {
  for (const id of makeUuids(3)) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("urlEncode rejects a lone surrogate with an InputError, never a URIError", () => {
  assert.throws(() => urlEncode("\uD800"), InputError);
  assert.equal(urlEncode("a b/ค"), "a%20b%2F%E0%B8%84");
});
