import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUrl } from "./urltools.js";

const FULL = "https://api.example.com:8080/users?id=123&name=John%20Doe#section1";

test("parseUrl: full URL fields", () => {
  const p = parseUrl(FULL);
  assert.ok(p);
  assert.equal(p.scheme, "https");
  assert.equal(p.host, "api.example.com");
  assert.equal(p.port, "8080");
  assert.equal(p.path, "/users");
  assert.equal(p.fragment, "section1");
  assert.equal(p.hasQuery, true);
  assert.equal(p.hasPassword, false);
  assert.equal(p.href, FULL);
});

test("parseUrl: null on garbage and missing scheme", () => {
  assert.equal(parseUrl("not a url"), null);
  assert.equal(parseUrl("example.com/path"), null);
});

test("parseUrl: scheme-default port never appears (WHATWG drops it)", () => {
  assert.equal(parseUrl("https://x.example:443/")?.port, undefined);
});

test("parseUrl: Thai IDN host gains a Unicode companion", () => {
  // xn--o3cw4h is the punycode of "ไทย" — verify: node -e 'console.log(require("url").domainToUnicode("xn--o3cw4h.example"))'
  assert.equal(parseUrl("https://xn--o3cw4h.example/")?.hostUnicode, "ไทย.example");
  assert.equal(parseUrl("https://api.example.com/")?.hostUnicode, undefined);
});

test("parseUrl: percent-encoded Thai path gains a decoded companion", () => {
  const p = parseUrl("https://x.example/%E0%B8%81");
  assert.equal(p?.path, "/%E0%B8%81");
  assert.equal(p?.pathDecoded, "/ก");
  assert.equal(parseUrl("https://x.example/users")?.pathDecoded, undefined);
});

test("parseUrl: malformed percent-sequence leaves raw form only", () => {
  assert.equal(parseUrl("https://x.example/%E0%B8")?.pathDecoded, undefined);
});

test("parseUrl: fragment decodes like the path", () => {
  const p = parseUrl("https://x.example/#%E0%B8%81");
  assert.equal(p?.fragment, "%E0%B8%81");
  assert.equal(p?.fragmentDecoded, "ก");
});

test("parseUrl: control characters in a decoded form leave raw only (no forged lines)", () => {
  const p = parseUrl("https://x.example/%0AHost%3A%20fake");
  assert.equal(p?.pathDecoded, undefined);
  const f = parseUrl("https://x.example/#a%0Db");
  assert.equal(f?.fragmentDecoded, undefined);
});

test("parseUrl: userinfo — user kept, password stripped from href", () => {
  const p = parseUrl("https://alice:secret@x.example/");
  assert.ok(p);
  assert.equal(p.user, "alice");
  assert.equal(p.hasPassword, true);
  assert.ok(!p.href.includes("secret"));
  assert.equal(p.href, "https://alice@x.example/");
});

test("parseUrl decodes punycode hosts to Unicode without node:url", () => {
  assert.equal(parseUrl("https://xn--12c1bik6bbd8ab6hd1b5jc6jta.com/x")?.hostUnicode, "เราเที่ยวด้วยกัน.com");
  assert.equal(parseUrl("https://xn--e1afmkfd.xn--p1ai/")?.hostUnicode, "пример.рф");
  assert.equal(parseUrl("https://EXAMPLE.com/")?.hostUnicode, undefined); // WHATWG already lowercases; no difference to report
});

// Generated once with a throwaway node -e script outside both repos, comparing
// punycode's toUnicode against node:url's domainToUnicode over ten hosts (see
// the task report for the script + full output). This test itself imports no
// node:url — the literals below are the recorded results. undefined means the
// Unicode form equalled the ASCII form, so parseUrl reports no hostUnicode.
test("parseUrl hostUnicode agrees with node:url.domainToUnicode on a ten-host table", () => {
  const cases: [url: string, expected: string | undefined][] = [
    ["https://xn--12c1bik6bbd8ab6hd1b5jc6jta.com/", "เราเที่ยวด้วยกัน.com"], // Thai + ASCII TLD
    ["https://xn--e1afmkfd.xn--p1ai/", "пример.рф"], // Cyrillic host + Cyrillic TLD
    ["https://example.com/", undefined], // plain ASCII host
    ["https://EXAMPLE.COM/", undefined], // uppercase ASCII host — WHATWG lowercases before either function sees it
    ["https://xn--o3cw4h.example/", "ไทย.example"], // mixed xn-- label + ASCII label
    ["https://xn--wgv71a119e.jp/", "日本語.jp"], // Japanese
    ["https://xn--mgbh0fb.xn--kgbechtv/", "مثال.إختبار"], // Arabic
    ["https://xn--ls8h.example/", "💩.example"], // emoji-ish xn-- label
    ["https://xn--o3cw4h.example./", "ไทย.example."], // trailing dot
    ["https://192.168.1.1/", undefined], // IPv4 literal
  ];
  for (const [url, expected] of cases) {
    assert.equal(parseUrl(url)?.hostUnicode, expected, url);
  }
});

test("parseUrl never throws on an undecodable xn-- label in a non-special scheme", () => {
  const parts = parseUrl("git://xn--0/");
  assert.ok(parts);
  assert.equal(parts.hostUnicode, undefined);
  assert.equal(parseUrl("https://xn--a.com/"), null); // special scheme: WHATWG rejects it first
});
