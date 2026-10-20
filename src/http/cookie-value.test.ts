import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCookieValue, cookieLifetime } from "./cookie-value.js";
import type { SetCookieAttributes } from "./cookie-types.js";

const NOW = 1_800_000_000_000;

function attrs(over: Partial<SetCookieAttributes> = {}): SetCookieAttributes {
  return {
    domain: null,
    path: null,
    expires: null,
    maxAge: null,
    secure: false,
    httpOnly: false,
    sameSite: null,
    sameSiteRaw: null,
    partitioned: false,
    priority: null,
    unknown: [],
    duplicates: [],
    ...over,
  };
}

test("describeCookieValue: each kind", () => {
  assert.deepEqual(describeCookieValue(""), { kind: "empty", decoded: null, layers: [], quoted: false });
  assert.deepEqual(describeCookieValue("abc123"), { kind: "plain", decoded: null, layers: [], quoted: false });
  assert.deepEqual(describeCookieValue("\"abc\""), { kind: "plain", decoded: null, layers: [], quoted: true });
  assert.deepEqual(describeCookieValue("a%20b%3Dc"), { kind: "url-encoded", decoded: "a b=c", layers: ["url-encoded"], quoted: false });
  assert.deepEqual(describeCookieValue("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln"), { kind: "jwt", decoded: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln", layers: ["jwt"], quoted: false });
  assert.deepEqual(describeCookieValue("eyJhbGciOiJIUzI1NiJ9%2EeyJzdWIiOiIxIn0%2Ec2ln").layers, ["url-encoded", "jwt"]);
  assert.deepEqual(describeCookieValue("s:abc.def"), { kind: "signed", decoded: "s:abc.def", layers: ["signed"], quoted: false });
  assert.deepEqual(describeCookieValue('{"a":1}'), { kind: "json", decoded: '{\n  "a": 1\n}', layers: ["json"], quoted: false });
  assert.deepEqual(describeCookieValue("eyJhIjoxfQ=="), { kind: "json", decoded: '{\n  "a": 1\n}', layers: ["base64", "json"], quoted: false });
  assert.deepEqual(describeCookieValue("aGVsbG8gd29ybGQ="), { kind: "base64", decoded: "hello world", layers: ["base64"], quoted: false });
  assert.deepEqual(describeCookieValue("a=1&b=x%20y"), { kind: "form", decoded: "a=1\nb=x y", layers: ["form"], quoted: false });
  assert.deepEqual(describeCookieValue("%7B%22a%22%3A1%7D").layers, ["url-encoded", "json"]);
});
test("describeCookieValue: json, jwt and signed values holding & are not forms", () => {
  assert.deepEqual(describeCookieValue('{"u":"https://x.test/?a=1&b=2"}').layers, ["json"]);
  assert.deepEqual(describeCookieValue('["a=1&b=2"]').layers, ["json"]);
  assert.deepEqual(describeCookieValue("s:a=1&b=2.sig").layers, ["signed"]);
});
test("describeCookieValue: a malformed percent sequence is plain, not a throw", () => {
  assert.equal(describeCookieValue("%E0%A4%A").kind, "plain");
});
test("describeCookieValue: short or binary base64 is plain", () => {
  assert.equal(describeCookieValue("YWJj").kind, "plain"); // under 8 chars
  assert.equal(describeCookieValue("AAAAAAAAAAAAAAAA").kind, "plain"); // decodes to NULs
});
test("cookieLifetime", () => {
  assert.deepEqual(cookieLifetime(attrs(), NOW), { kind: "session" });
  assert.deepEqual(cookieLifetime(attrs({ maxAge: 60 }), NOW), { kind: "expires", atMs: NOW + 60_000, remainingMs: 60_000, source: "max-age" });
  assert.deepEqual(cookieLifetime(attrs({ maxAge: 0 }), NOW), { kind: "expired", atMs: NOW, source: "max-age" });
  assert.deepEqual((cookieLifetime(attrs({ maxAge: 60, expires: "Thu, 01 Jan 1970 00:00:00 GMT" }), NOW) as { source: string }).source, "max-age");
  assert.deepEqual(cookieLifetime(attrs({ expires: "Thu, 01 Jan 1970 00:00:00 GMT" }), NOW), { kind: "expired", atMs: 0, source: "expires" });
  assert.deepEqual(cookieLifetime(attrs({ expires: "soon" }), NOW), { kind: "invalid", raw: "soon" });
});
