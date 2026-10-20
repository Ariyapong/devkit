import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../errors.js";
import { detectCookieInput, parseCookieHeader, parseCookieInput, parseSetCookie, splitSetCookieHeaders } from "./cookie-parse.js";
import { parseNetscapeJar } from "./cookie-out.js";
import { MAX_COOKIE_INPUT_CHARS } from "./cookie-types.js";

const NOW = 1_800_000_000_000;

const RESPONSE_BLOCK = [
  "HTTP/1.1 200 OK",
  "Content-Type: text/html",
  "Set-Cookie: a=1; Path=/",
  "X-Foo: bar",
  "Set-Cookie: b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT, c=3; Secure",
  "Cookie: d=4",
].join("\n");
const HEADER_BLOCK = ["GET / HTTP/1.1", "Host: x", "Cookie: a=1; b=2", "Accept: */*"].join("\n");
const NGINX_JSON_LINE = '{"ts":"2026-10-20T09:00:00Z","set_cookie":"Set-Cookie: a=1; Secure","status":200}';
const DEVTOOLS_ROWS = [
  "sid\tabc\t.example.com\t/\tSession\t6\t\t✓\tLax\t\tMedium",
  "theme\tdark\texample.com\t/\t2026-10-21T07:28:00.000Z\t9\t✓\t✓\tStrict\t\tMedium",
].join("\n");
const DEVTOOLS_ROWS_HEADER = "Name\tValue\tDomain\tPath\tExpires / Max-Age\tSize\tHttpOnly\tSecure\tSameSite\tPartition Key\tPriority\n" + DEVTOOLS_ROWS;
const JAR = ["# Netscape HTTP Cookie File", "# https://curl.se/docs/http-cookies.html", "", "#HttpOnly_.example.com\tTRUE\t/\tTRUE\t0\tsid\tabc"].join("\n");

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
test("detect: empty / cookie-header / set-cookie / header-block / devtools-table / netscape", () => {
  assert.equal(detectCookieInput("  \n"), "empty");
  assert.equal(detectCookieInput("a=1; b=2"), "cookie-header");
  assert.equal(detectCookieInput("Set-Cookie: a=1"), "set-cookie");
  assert.equal(detectCookieInput("a=1; Path=/; Secure\nb=2; HttpOnly"), "set-cookie");
  assert.equal(detectCookieInput(HEADER_BLOCK), "header-block");           // GET line, Host, Cookie, Accept
  assert.equal(detectCookieInput(NGINX_JSON_LINE), "header-block");        // {"ts":…,"set_cookie":"Set-Cookie: a=1; Secure","status":200}
  assert.equal(detectCookieInput(DEVTOOLS_ROWS), "devtools-table");        // 2 rows, no header, Chromium column order
  assert.equal(detectCookieInput(DEVTOOLS_ROWS_HEADER.replace(/\n/g, "\r\n") + "\t"), "devtools-table"); // CRLF + trailing tab
  assert.equal(detectCookieInput(JAR), "netscape");
});
test("parseCookieInput: notes, counts, set-level audit, line numbers", () => {
  const r = parseCookieInput(RESPONSE_BLOCK, { nowMs: NOW });
  assert.equal(r.kind, "header-block");
  assert.deepEqual(r.notes, ["Read 3 Set-Cookie headers and 1 Cookie header out of a pasted header block.", "Split one comma-joined Set-Cookie value into 2 headers."]);
  assert.deepEqual(r.cookies.map((c) => c.source.line), [3, 5, 5, 6]);
  assert.equal(r.totalBytes, r.cookies.reduce((n, c) => n + c.bytes, 0));
});
test("parseCookieInput: duplicate names and total size are set-level findings", () => {
  const r = parseCookieInput("a=1; a=2; a=3");
  assert.deepEqual(r.audit, [{ code: "duplicate-name", level: "warn", message: "\"a\" appears 3 times. The last one wins in a Cookie header; browsers keep the one whose Domain and Path match best." }]);
  assert.ok(parseCookieInput("a=" + "x".repeat(9000)).audit.some((f) => f.code === "total-size"));
});
test("parseCookieInput: devtools table maps columns, Session, ✓, and recomputes size", () => {
  const r = parseCookieInput(DEVTOOLS_ROWS_HEADER);
  assert.equal(r.notes[0], "Read as a devtools cookie table (2 rows).");
  assert.deepEqual(r.cookies[0]!.lifetime, { kind: "session" });
  assert.equal(r.cookies[1]!.attributes!.httpOnly, true);
});
test("parseCookieInput: too long", () => {
  assert.throws(() => parseCookieInput("a".repeat(MAX_COOKIE_INPUT_CHARS + 1)), (e: unknown) => e instanceof InputError && e.message === "Too long — the input is over 1000000 characters.");
});
test("parseCookieInput: the remaining first notes, singular forms and source lines", () => {
  assert.deepEqual(parseCookieInput(" \n").notes, ["Nothing to read."]);
  assert.deepEqual(parseCookieInput("Cookie: a=1").notes, ["Read as a Cookie request header."]);
  const one = parseCookieInput("Set-Cookie: a=1", { nowMs: NOW });
  assert.deepEqual(one.notes, ["Read as 1 Set-Cookie header."]);
  const two = parseCookieInput("a=1; Secure\n\nb=2; HttpOnly", { nowMs: NOW });
  assert.equal(two.notes[0], "Read as 2 Set-Cookie headers.");
  assert.deepEqual(two.cookies.map((c) => c.source.line), [1, 3]);
  const block = parseCookieInput(HEADER_BLOCK);
  assert.equal(block.notes[0], "Read 0 Set-Cookie headers and 1 Cookie header out of a pasted header block.");
  assert.deepEqual(block.cookies.map((c) => [c.name, c.source.line]), [["a", 3], ["b", 3]]);
  const log = parseCookieInput(NGINX_JSON_LINE, { nowMs: NOW });
  assert.equal(log.notes[0], "Read 1 Set-Cookie header out of a pasted header block.");
  assert.deepEqual([log.cookies[0]!.name, log.cookies[0]!.value, log.cookies[0]!.attributes!.secure], ["a", "1", true]);
});
test("parseCookieInput: further notes for quotes, double URL encoding and empty lines", () => {
  assert.deepEqual(parseCookieInput('a="x"; b="y"').notes, ["Read as a Cookie request header.", "Stripped a wrapping quote from 2 values."]);
  assert.deepEqual(parseCookieInput("a=%2541").notes, ["Read as a Cookie request header.", "Removed one extra layer of URL encoding from 1 value."]);
  assert.deepEqual(parseCookieInput("Set-Cookie: a=1\nSet-Cookie:", { nowMs: NOW }).notes, ["Read as 1 Set-Cookie header.", "Skipped 1 line that held no cookie."]);
});
test("parseCookieInput: a Netscape jar reads #HttpOnly_ and 0 as session", () => {
  const r = parseCookieInput(JAR, { nowMs: NOW });
  assert.equal(r.notes[0], "Read as a Netscape cookies.txt jar (1 cookie).");
  const c = r.cookies[0]!;
  assert.deepEqual([c.name, c.value, c.attributes!.domain, c.attributes!.httpOnly, c.attributes!.secure, c.lifetime], ["sid", "abc", ".example.com", true, true, { kind: "session" }]);
  assert.equal(c.source.line, 4);
});
test("parseNetscapeJar: Unix-seconds expiry and the field-count error", () => {
  const [c] = parseNetscapeJar("x.test\tFALSE\t/p\tFALSE\t1900000000\ta\t1", { nowMs: NOW });
  assert.deepEqual(c!.lifetime, { kind: "expires", atMs: 1_900_000_000_000, remainingMs: 100_000_000_000, source: "expires" });
  assert.equal(c!.attributes!.path, "/p");
  assert.throws(() => parseNetscapeJar("# c\na\tb"), (e: unknown) => e instanceof InputError && e.message === "Line 2 has 2 fields, not 7.");
});
