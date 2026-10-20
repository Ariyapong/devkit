import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCookieHeader, parseSetCookie, splitSetCookieHeaders } from "./cookie-parse.js";

const NOW = 1_800_000_000_000;

test("parseCookieHeader: pairs, first-= split, nameless, empty segments", () => {
  const rows = parseCookieHeader("Cookie: sid=abc==; theme=dark;; raw; =v");
  assert.deepEqual(rows.map((c) => [c.name, c.value]), [["sid", "abc=="], ["theme", "dark"], ["", "raw"], ["", "v"]]);
  assert.equal(rows[0]!.attributes, null); assert.equal(rows[0]!.lifetime, null);
  assert.equal(rows[0]!.bytes, 9);
});
test("parseSetCookie: attributes, canonical casing, duplicates, unknown, header-name stripping", () => {
  const c = parseSetCookie("set-cookie: sid=1; Path=/; path=/x; samesite=lax; Max-Age=60; Secure; HttpOnly; Partitioned; Priority=high; Foo=bar; Bare", { nowMs: NOW });
  assert.deepEqual(c.attributes, { domain: null, path: "/x", expires: null, maxAge: 60, secure: true, httpOnly: true, sameSite: "Lax", sameSiteRaw: null, partitioned: true, priority: "High", unknown: [["Foo", "bar"], ["Bare", null]], duplicates: ["path"] });
  assert.deepEqual(c.lifetime, { kind: "expires", atMs: NOW + 60_000, remainingMs: 60_000, source: "max-age" });
  assert.ok(c.audit.some((f) => f.code === "duplicate-attribute"));
});
test("parseSetCookie: SameSite=Foo keeps the raw value; Max-Age=abc is unknown", () => {
  const c = parseSetCookie("a=1; SameSite=Foo; Max-Age=abc");
  assert.equal(c.attributes!.sameSite, null); assert.equal(c.attributes!.sameSiteRaw, "Foo");
  assert.deepEqual(c.attributes!.unknown, [["Max-Age", "abc"]]);
});
test("splitSetCookieHeaders: comma inside Expires does not split; comma before name= does", () => {
  assert.deepEqual(splitSetCookieHeaders("a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT, __Host-b=2; Secure, c=3"), ["a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT", "__Host-b=2; Secure", "c=3"]);
  assert.deepEqual(splitSetCookieHeaders("a=1"), ["a=1"]);
});
test("parseSetCookie: an invalid Priority goes to unknown and is audited as priority-invalid", () => {
  const c = parseSetCookie("a=1; priority=urgent", { nowMs: NOW });
  assert.equal(c.attributes!.priority, null);
  assert.deepEqual(c.attributes!.unknown, [["priority", "urgent"]]);
  assert.ok(c.audit.some((f) => f.code === "priority-invalid"));
  assert.ok(!c.audit.some((f) => f.code === "unknown-attribute"));
});
test("parseSetCookie: wrapping quotes are stripped from value but recorded in valueInfo", () => {
  const c = parseSetCookie('a="x"', { nowMs: NOW });
  assert.equal(c.value, "x");
  assert.equal(c.valueInfo.quoted, true);
});
test("parseSetCookie: a valueless Domain, Path or Expires reads as empty, not unknown", () => {
  const c = parseSetCookie("a=1; Domain; Path; Expires", { nowMs: NOW });
  assert.equal(c.attributes!.domain, ""); assert.equal(c.attributes!.path, ""); assert.equal(c.attributes!.expires, "");
  assert.deepEqual(c.attributes!.unknown, []);
  assert.ok(!c.audit.some((f) => f.code === "unknown-attribute"));
});
