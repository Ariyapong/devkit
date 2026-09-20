import { test } from "node:test";
import assert from "node:assert/strict";
import { findJwt } from "./find-jwt.js";
import { utf8ToBase64Url } from "../shared/bytes.js";

const b64url = (obj: unknown) => utf8ToBase64Url(JSON.stringify(obj));
const TOKEN = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "1" })}.c2ln`;

test("findJwt: token inside prose", () => {
  assert.equal(findJwt(`here is the token ${TOKEN} thanks`), TOKEN);
});

test("findJwt: token inside a code fence", () => {
  assert.equal(findJwt("```\n" + TOKEN + "\n```"), TOKEN);
});

test("findJwt: first of two tokens wins", () => {
  const second = `${b64url({ alg: "none" })}.${b64url({ sub: "2" })}.b3Ro`;
  assert.equal(findJwt(`${TOKEN} and ${second}`), TOKEN);
});

test("findJwt: no token", () => {
  assert.equal(findJwt("nothing to see here"), null);
});

test("findJwt: empty signature part is not matched", () => {
  assert.equal(findJwt(`${b64url({ alg: "none" })}.${b64url({ sub: "3" })}.`), null);
});
