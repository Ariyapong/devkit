import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../errors.js";
import { parseCookieHeader, parseCookieInput, parseSetCookie } from "./cookie-parse.js";
import { cookiesToJson, parseNetscapeJar, toCookieHeader, toNetscapeJar } from "./cookie-out.js";

const NOW = 1_800_000_000_000;

test("toCookieHeader joins name=value with '; '", () => assert.equal(toCookieHeader(parseCookieHeader("a=1; b=2")), "a=1; b=2"));
test("Netscape jar round trip keeps domain, path, secure, httpOnly, expiry and value", () => {
  const rows = [parseSetCookie("a=1; Domain=.example.com; Path=/p; Secure; HttpOnly; Max-Age=60", { nowMs: NOW }), parseSetCookie("b=2", { nowMs: NOW })];
  const jar = toNetscapeJar(rows, { nowMs: NOW });
  assert.equal(jar.split("\n")[0], "# Netscape HTTP Cookie File");
  assert.equal(jar.split("\n")[1], `#HttpOnly_.example.com\tTRUE\t/p\tTRUE\t${Math.floor((NOW + 60_000) / 1000)}\ta\t1`);
  assert.equal(jar.split("\n")[2], "\tFALSE\t/\tFALSE\t0\tb\t2");
  const back = parseNetscapeJar(jar, { nowMs: NOW });
  assert.deepEqual(back.map((c) => [c.name, c.value, c.attributes!.domain, c.attributes!.httpOnly, c.lifetime!.kind]), [["a", "1", ".example.com", true, "expires"], ["b", "2", null, false, "session"]]);
});
test("parseNetscapeJar: non-numeric expiry is a field error; a huge expiry is far future", () => {
  assert.throws(() => parseNetscapeJar(".x\tTRUE\t/\tFALSE\tsoon\ta\t1"), (e: unknown) => e instanceof InputError && e.message === "Line 1 has a non-numeric expiry.");
  assert.equal(parseNetscapeJar(".x\tTRUE\t/\tFALSE\t4102444800\ta\t1", { nowMs: NOW })[0]!.lifetime!.kind, "expires");
});
test("cookiesToJson has no source field and is pretty", () => {
  const j = JSON.parse(cookiesToJson(parseCookieInput("a=1")));
  assert.equal("source" in j.cookies[0], false); assert.ok(cookiesToJson(parseCookieInput("a=1")).includes("\n  "));
});
test("parseNetscapeJar: a huge numeric expiry is clamped to a far-future expires", () => {
  for (const huge of ["99999999999999999999", "8640000000000", "253402300800"]) {
    const [c] = parseNetscapeJar(`.x\tTRUE\t/\tFALSE\t${huge}\ta\t1`, { nowMs: NOW });
    assert.equal(c!.lifetime!.kind, "expires");
    assert.doesNotThrow(() => parseNetscapeJar(toNetscapeJar([c!], { nowMs: NOW }), { nowMs: NOW }));
  }
});
