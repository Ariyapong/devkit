import { test } from "node:test";
import assert from "node:assert/strict";
import { renderJwt } from "./jwt-render.js";
import { decodeJwt } from "../codec/codec.js";
import { utf8ToBase64Url } from "../shared/bytes.js";

test("renderJwt: contains header, payload, timestamps, warning", () => {
  const b64url = (obj: unknown) => utf8ToBase64Url(JSON.stringify(obj));
  const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub: "1",
    exp: 1000000000,
  })}.sig`;
  const body = renderJwt(decodeJwt(token));
  assert.ok(body.includes("**Header**"));
  assert.ok(body.includes('"alg": "HS256"'));
  assert.ok(body.includes('"sub": "1"'));
  assert.ok(body.includes("`exp` — <t:1000000000:f>"));
  assert.ok(body.includes("⛔ Expired"));
  assert.ok(body.includes("⚠️ Signature NOT verified — decode only."));
});

test("renderJwt: no exp claim", () => {
  const b64url = (obj: unknown) => utf8ToBase64Url(JSON.stringify(obj));
  const token = `${b64url({ alg: "none" })}.${b64url({ sub: "2" })}.sig`;
  const body = renderJwt(decodeJwt(token));
  assert.ok(body.includes("ℹ️ No `exp` claim."));
});

test("renderJwt: valid token (future exp) shows the valid line", () => {
  const b64url = (obj: unknown) => utf8ToBase64Url(JSON.stringify(obj));
  const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub: "1",
    exp: 9999999999, // year 2286 — comfortably in the future
  })}.sig`;
  const body = renderJwt(decodeJwt(token));
  assert.ok(body.includes("✅ Valid — expires in"));
});
